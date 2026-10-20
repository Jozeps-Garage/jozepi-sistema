import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NotaasError, cancelNfse } from "@/lib/nfse/notaas";

/** A prefeitura exige justificativa; a faixa é a da própria API da Notaas. */
const MOTIVO_MIN = 15;
const MOTIVO_MAX = 255;

/**
 * Pede o cancelamento de uma nota já emitida.
 *
 * O cancelamento também é assíncrono e pode ser recusado pela prefeitura, por
 * isso a nota não vira "cancelled" aqui: só registramos o pedido e o motivo. O
 * status real vem na próxima consulta.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let payload: { invoiceId?: string; motivo?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const invoiceId = payload.invoiceId;
  const motivo = payload.motivo?.trim() ?? "";

  if (!invoiceId) {
    return NextResponse.json({ error: "Informe a nota." }, { status: 400 });
  }

  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    return NextResponse.json(
      {
        error: `A justificativa precisa ter entre ${MOTIVO_MIN} e ${MOTIVO_MAX} caracteres.`,
      },
      { status: 422 }
    );
  }

  const { data: invoice } = await supabase
    .from("nfse_invoices")
    .select("id, status")
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  }

  if (invoice.status !== "issued") {
    return NextResponse.json(
      { error: "Só nota emitida pode ser cancelada." },
      { status: 409 }
    );
  }

  try {
    await cancelNfse(invoiceId, motivo);

    await supabase
      .from("nfse_invoices")
      .update({ cancel_reason: motivo, updated_at: new Date().toISOString() })
      .eq("id", invoice.id);

    return NextResponse.json({ requested: true });
  } catch (err) {
    if (err instanceof NotaasError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Não foi possível pedir o cancelamento." },
      { status: 500 }
    );
  }
}
