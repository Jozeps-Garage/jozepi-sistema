import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultAccountId, loadFinancialAccounts } from "@/lib/finance/accounts";
import {
  categoriesOfType,
  loadFinancialCategories,
  matchCategoryId,
} from "@/lib/finance/categories";
import type { PaymentStatus, TransactionType } from "@/lib/finance/types";

export type { TransactionType } from "@/lib/finance/types";

export interface QuickTransactionInput {
  type: TransactionType;
  description: string;
  amount: number;
  category: string;
  categoryId?: string | null;
  accountId: string;
  date: string;
  effectiveDate?: string | null;
  dueDate?: string | null;
  paymentStatus?: PaymentStatus;
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

function paidEffectiveDate(
  status: PaymentStatus | undefined,
  date: string,
  effectiveDate?: string | null
) {
  const paymentStatus = status ?? "pago";
  if (paymentStatus !== "pago") return null;
  return effectiveDate || date;
}

/**
 * Insere uma transação (receita/despesa) na tabela financial_transactions.
 * Novos lançamentos devem sempre informar a conta.
 */
export async function createTransaction(
  supabase: SupabaseClient,
  workshopId: string,
  input: QuickTransactionInput
): Promise<void> {
  if (!input.accountId) {
    throw new Error("Selecione a conta do lançamento.");
  }

  const paymentStatus = input.paymentStatus ?? "pago";
  const dueDate =
    paymentStatus === "pago" ? input.dueDate || null : input.dueDate || input.date;
  const base = {
    workshop_id: workshopId,
    type: input.type,
    description: input.description.trim(),
    amount: input.amount,
    category: input.category,
    transaction_date: input.date,
  };

  const cashflow = {
    ...base,
    account_id: input.accountId,
    category_id: input.categoryId || null,
    payment_status: paymentStatus,
    effective_date: paidEffectiveDate(paymentStatus, input.date, input.effectiveDate),
    due_date: dueDate,
  };

  const attempts = [
    cashflow,
    {
      ...base,
      account_id: input.accountId,
      category_id: input.categoryId || null,
      payment_status: paymentStatus,
      effective_date: paidEffectiveDate(paymentStatus, input.date, input.effectiveDate),
    },
    {
      ...base,
      account_id: input.accountId,
      category_id: input.categoryId || null,
      payment_status: paymentStatus,
    },
    { ...base, account_id: input.accountId, payment_status: paymentStatus },
    { ...base, payment_status: paymentStatus },
    base,
  ];

  let lastError: { message: string } | null = null;
  for (const payload of attempts) {
    const result = await supabase
      .from("financial_transactions")
      .insert(payload)
      .select("id")
      .single();
    if (!result.error) return;
    lastError = result.error;
    const missingCashflowColumn =
      isMissingColumnError(result.error.message, "account_id") ||
      isMissingColumnError(result.error.message, "category_id") ||
      isMissingColumnError(result.error.message, "effective_date") ||
      isMissingColumnError(result.error.message, "due_date") ||
      isMissingColumnError(result.error.message, "payment_status");
    if (!missingCashflowColumn) break;
  }

  throw new Error(lastError?.message ?? "Não foi possível salvar o lançamento.");
}

export async function resolveDefaultCashflowIds(
  supabase: SupabaseClient,
  workshopId: string,
  type: TransactionType,
  categoryName: string
) {
  const [accounts, categories] = await Promise.all([
    loadFinancialAccounts(supabase, workshopId).catch(() => []),
    loadFinancialCategories(supabase, workshopId).catch(() => []),
  ]);

  return {
    accountId: defaultAccountId(accounts) || null,
    categoryId: matchCategoryId(categoriesOfType(categories, type, { includeInactive: true }), type, categoryName) || null,
  };
}
