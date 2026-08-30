import type { SupabaseClient } from "@supabase/supabase-js";

export type TransactionType = "receita" | "despesa";

export interface QuickTransactionInput {
  type: TransactionType;
  description: string;
  amount: number;
  category: string;
  date: string;
}

function isMissingColumnError(message: string, column: string) {
  const normalized = message.toLowerCase();
  if (!normalized.includes(column.toLowerCase())) return false;
  if (
    normalized.includes("foreign key") ||
    normalized.includes("violates") ||
    normalized.includes("invalid input syntax")
  ) {
    return false;
  }
  return (
    normalized.includes("could not find") ||
    normalized.includes("schema cache") ||
    normalized.includes("does not exist")
  );
}

/**
 * Insere uma transação (receita/despesa) na tabela financial_transactions.
 * Tolera bancos legados sem a coluna `payment_status` (mesma estratégia do finance-page).
 */
export async function createTransaction(
  supabase: SupabaseClient,
  workshopId: string,
  input: QuickTransactionInput
): Promise<void> {
  const base = {
    workshop_id: workshopId,
    type: input.type,
    description: input.description.trim(),
    amount: input.amount,
    category: input.category,
    transaction_date: input.date,
  };

  const withStatus = await supabase
    .from("financial_transactions")
    .insert({ ...base, payment_status: "pago" })
    .select("id")
    .single();

  if (!withStatus.error) return;

  if (isMissingColumnError(withStatus.error.message, "payment_status")) {
    const legacy = await supabase
      .from("financial_transactions")
      .insert(base)
      .select("id")
      .single();

    if (legacy.error) throw new Error(legacy.error.message);
    return;
  }

  throw new Error(withStatus.error.message);
}
