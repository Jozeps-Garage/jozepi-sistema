import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPPLIER_SELECT_FIELDS =
  "id, workshop_id, name, trade_name, contact_name, phone, email, document, city_state, address, zip_code, category, notes, created_at, updated_at";
/** Sem a migration 043 as colunas novas não existem; a consulta cai para esta. */
export const SUPPLIER_SELECT_LEGACY =
  "id, workshop_id, name, contact_name, phone, email, document, city_state, category, notes, created_at, updated_at";

export function isMissingSupplierColumn(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("trade_name") ||
    message.includes("address") ||
    message.includes("zip_code")
  );
}

/**
 * Grava o fornecedor tolerando um banco sem a 043: se as colunas novas não
 * existirem, repete sem elas em vez de devolver erro. Com `supplierId` é
 * edição; sem ele, cadastro. Vive aqui porque Produtos e Financeiro cadastram
 * fornecedor pelos dois lados e o fallback precisa ser o mesmo nos dois.
 */
export async function saveSupplierRow(
  supabase: SupabaseClient,
  workshopId: string,
  payload: Record<string, unknown>,
  supplierId?: string | null
) {
  const run = (data: Record<string, unknown>, fields: string) =>
    supplierId
      ? supabase
          .from("suppliers")
          .update(data)
          .eq("id", supplierId)
          .eq("workshop_id", workshopId)
          .select(fields)
          .single()
      : supabase.from("suppliers").insert(data).select(fields).single();

  const result = await run(payload, SUPPLIER_SELECT_FIELDS);
  if (!isMissingSupplierColumn(result.error)) return result;

  // Sem a 043: grava o que a tabela aceita e perde fantasia e endereço.
  const {
    trade_name: _tradeName,
    address: _address,
    zip_code: _zipCode,
    ...legacy
  } = payload;
  return run(legacy, SUPPLIER_SELECT_LEGACY);
}
