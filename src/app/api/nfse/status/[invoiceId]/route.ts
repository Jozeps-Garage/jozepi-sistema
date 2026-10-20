import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NotaasError, getNfseStatus } from "@/lib/nfse/notaas";

/**
 * Consulta o andamento de uma nota e guarda o resultado.
 *
 * A emissão é assíncrona, então a tela chama isto de alguns em alguns segundos
 * enquanto a nota está em queued/processing. Quando sai desse estado, o que
 * voltou fica gravado e a tela para de perguntar.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  // Só consulta nota que é da oficina do usuário: sem isto, qualquer um
  // logado poderia ler o status de uma nota de outra pessoa pelo id.
  const { data: invoice } = await supabase
    .from("nfse_invoices")
    .select("id, workshop_id, status")
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  }

  try {
    const result = await getNfseStatus(invoiceId);

    const patch: Record<string, unknown> = {
      status: result.status,
      updated_at: new Date().toISOString(),
    };
    if (result.numeroNfe) patch.numero_nfse = result.numeroNfe;
    if (result.chNFSe) patch.chave_nfse = result.chNFSe;
    if (result.pdfUrl) patch.pdf_url = result.pdfUrl;
    if (result.xmlUrl) patch.xml_url = result.xmlUrl;
    if (result.ambiente) patch.ambiente = result.ambiente;
    if (result.emittedAt) patch.emitted_at = result.emittedAt;
    if (result.cancelledAt) patch.cancelled_at = result.cancelledAt;
    if (result.status === "error") {
      patch.error_code = result.errorCode ?? null;
      patch.error_message = result.errorMessage ?? null;
    }

    await supabase.from("nfse_invoices").update(patch).eq("id", invoice.id);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotaasError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Não foi possível consultar a nota." },
      { status: 500 }
    );
  }
}
