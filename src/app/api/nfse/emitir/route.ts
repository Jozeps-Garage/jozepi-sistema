import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NotaasError, emitNfse } from "@/lib/nfse/notaas";

/** O que a nota precisa saber do cliente. */
interface Tomador {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Emite a NFS-e de um lançamento de receita.
 *
 * O navegador manda só o id do lançamento. Tudo que vai na nota — tomador,
 * valor, descrição, alíquota — é lido aqui do banco, com a sessão do próprio
 * usuário, para que ninguém consiga emitir nota com dados inventados mexendo
 * na requisição.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let payload: { transactionId?: string; descricao?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const transactionId = payload.transactionId;
  if (!transactionId) {
    return NextResponse.json(
      { error: "Informe o lançamento que vai virar nota." },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("workshop_id")
    .eq("id", user.id)
    .single();

  const workshopId = profile?.workshop_id as string | undefined;
  if (!workshopId) {
    return NextResponse.json({ error: "Oficina não encontrada." }, { status: 403 });
  }

  // A RLS já restringe à oficina do usuário; o filtro explícito evita depender
  // só dela se alguma política mudar.
  const { data: transaction, error: transactionError } = await supabase
    .from("financial_transactions")
    .select("id, type, description, amount, service_order_id, workshop_id")
    .eq("id", transactionId)
    .eq("workshop_id", workshopId)
    .single();

  if (transactionError || !transaction) {
    return NextResponse.json(
      { error: "Lançamento não encontrado." },
      { status: 404 }
    );
  }

  if (transaction.type !== "receita") {
    return NextResponse.json(
      { error: "Só receita vira nota de serviço." },
      { status: 422 }
    );
  }

  const amount = Number(transaction.amount) || 0;
  if (amount <= 0) {
    return NextResponse.json(
      { error: "O lançamento precisa de um valor maior que zero." },
      { status: 422 }
    );
  }

  const { data: workshop, error: workshopError } = await supabase
    .from("workshops")
    .select("nfse_service_code, nfse_iss_rate, nfse_service_description")
    .eq("id", workshopId)
    .single();

  // Sem a 046 as colunas não existem. Dizer "falta a alíquota" aqui mandaria
  // você preencher um campo que ainda não tem onde ser salvo.
  if (workshopError?.message?.toLowerCase().includes("nfse_")) {
    return NextResponse.json(
      {
        error:
          "A emissão de nota ainda não foi instalada no banco. Aplique a migration 046 no Supabase.",
      },
      { status: 503 }
    );
  }

  const issRate = Number(workshop?.nfse_iss_rate);
  if (!Number.isFinite(issRate)) {
    return NextResponse.json(
      {
        error:
          "Falta a alíquota do ISS. Preencha em Configurações → Nota fiscal antes de emitir.",
      },
      { status: 422 }
    );
  }

  // O tomador sai da OS quando a receita veio de uma; senão o cliente é
  // escolhido na hora e chega pelo corpo da requisição.
  let client: Tomador | null = null;

  if (transaction.service_order_id) {
    const { data: order } = await supabase
      .from("service_orders")
      .select("client_id, clients(id, name, document, email, phone)")
      .eq("id", transaction.service_order_id)
      .eq("workshop_id", workshopId)
      .single();
    const joined = (order as { clients?: unknown } | null)?.clients;
    client = (Array.isArray(joined) ? joined[0] : joined) as Tomador | null;
  }

  if (!client) {
    const clientId = (payload as { clientId?: string }).clientId;
    if (clientId) {
      const { data } = await supabase
        .from("clients")
        .select("id, name, document, email, phone")
        .eq("id", clientId)
        .eq("workshop_id", workshopId)
        .single();
      client = data as Tomador | null;
    }
  }

  if (!client) {
    return NextResponse.json(
      { error: "Escolha o cliente que é o tomador da nota." },
      { status: 422 }
    );
  }

  const document = (client.document ?? "").replace(/\D/g, "");
  if (document.length !== 11 && document.length !== 14) {
    return NextResponse.json(
      {
        error: `${client.name} está sem CPF/CNPJ. A prefeitura exige o documento do tomador — complete o cadastro do cliente.`,
      },
      { status: 422 }
    );
  }

  const descricao =
    payload.descricao?.trim() ||
    transaction.description?.trim() ||
    workshop?.nfse_service_description?.trim() ||
    "Serviço de estética automotiva";

  // Referência estável: reemitir o mesmo lançamento esbarra no índice único
  // em vez de gerar nota duplicada na prefeitura.
  const referencia = `tx-${transaction.id}`;

  const { data: existing } = await supabase
    .from("nfse_invoices")
    .select("id, status, invoice_id")
    .eq("workshop_id", workshopId)
    .eq("referencia", referencia)
    .maybeSingle();

  if (existing && existing.status !== "error") {
    return NextResponse.json(
      {
        error: "Este lançamento já tem nota.",
        invoiceId: existing.invoice_id,
        status: existing.status,
      },
      { status: 409 }
    );
  }

  try {
    const result = await emitNfse({
      referencia,
      tomador: {
        nome: client.name,
        ...(document.length === 14 ? { cnpj: document } : { cpf: document }),
        ...(client.email ? { email: client.email } : {}),
        ...(client.phone ? { telefone: client.phone } : {}),
      },
      servico: {
        descricao,
        ...(workshop?.nfse_service_code
          ? { codigo: workshop.nfse_service_code }
          : {}),
      },
      valores: { total: amount, aliquotaIss: issRate },
    });

    const row = {
      workshop_id: workshopId,
      transaction_id: transaction.id,
      client_id: client.id,
      invoice_id: result.invoiceId,
      referencia,
      status: result.status,
      amount,
      tomador_nome: client.name,
      tomador_document: document,
      servico_descricao: descricao,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    };

    // Retentativa depois de um erro reaproveita a linha: a referência é única.
    const { data: saved, error: saveError } = existing
      ? await supabase
          .from("nfse_invoices")
          .update(row)
          .eq("id", existing.id)
          .select("id, invoice_id, status")
          .single()
      : await supabase
          .from("nfse_invoices")
          .insert(row)
          .select("id, invoice_id, status")
          .single();

    if (saveError) {
      // A nota foi para a fila da prefeitura; perder o registro aqui é pior
      // que falhar, então devolvemos o invoiceId junto do aviso.
      return NextResponse.json(
        {
          error: `A nota foi enfileirada (${result.invoiceId}), mas não consegui registrá-la: ${saveError.message}`,
          invoiceId: result.invoiceId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { id: saved.id, invoiceId: saved.invoice_id, status: saved.status },
      { status: 202 }
    );
  } catch (err) {
    if (err instanceof NotaasError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Não foi possível emitir a nota." },
      { status: 500 }
    );
  }
}
