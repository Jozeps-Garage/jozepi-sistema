import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cashDate,
  toMoneyNumber,
  type FinancialAccount,
  type FinancialTransfer,
  type PaymentStatus,
  type TransactionType,
} from "@/lib/finance/types";

export { cashDate };

export interface CashTransactionRow {
  type: TransactionType | string;
  amount: number | string;
  payment_status?: PaymentStatus | string | null;
  effective_date?: string | null;
  transaction_date: string;
  account_id?: string | null;
}

export function isPaidCashStatus(status: string | null | undefined) {
  return !status || status === "pago";
}

export function isPaidRevenue(row: CashTransactionRow) {
  return row.type === "receita" && isPaidCashStatus(row.payment_status);
}

export function sumPaidRevenueInRange(
  rows: CashTransactionRow[],
  startDate: string,
  endDate: string
) {
  return rows.reduce((sum, row) => {
    if (!isPaidRevenue(row)) return sum;
    const date = cashDate(row);
    if (date < startDate || date > endDate) return sum;
    return sum + toMoneyNumber(row.amount);
  }, 0);
}

/**
 * Receita do mês no regime de caixa: lançamentos tipo receita já pagos,
 * pela data de efetivação (com fallback para a data de lançamento).
 */
export async function getMonthlyRevenue(
  supabase: SupabaseClient,
  workshopId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const withEffective = await supabase
    .from("financial_transactions")
    .select("type, amount, payment_status, effective_date, transaction_date")
    .eq("workshop_id", workshopId)
    .eq("type", "receita");

  if (!withEffective.error) {
    const rows = (withEffective.data ?? []) as CashTransactionRow[];
    return sumPaidRevenueInRange(
      rows.map((row) => ({
        ...row,
        payment_status: row.payment_status ?? "pago",
      })),
      startDate,
      endDate
    );
  }

  const legacy = await supabase
    .from("financial_transactions")
    .select("type, amount, transaction_date")
    .eq("workshop_id", workshopId)
    .eq("type", "receita")
    .gte("transaction_date", startDate)
    .lte("transaction_date", endDate);

  if (legacy.error) return 0;

  return ((legacy.data ?? []) as CashTransactionRow[]).reduce(
    (sum, row) => sum + toMoneyNumber(row.amount),
    0
  );
}

export function accountBalance(
  account: FinancialAccount,
  transactions: CashTransactionRow[],
  transfers: FinancialTransfer[]
) {
  const movement = transactions.reduce((sum, row) => {
    if (row.account_id !== account.id) return sum;
    if (!isPaidCashStatus(row.payment_status)) return sum;
    const amount = toMoneyNumber(row.amount);
    if (row.type === "receita") return sum + amount;
    if (row.type === "despesa") return sum - amount;
    return sum;
  }, 0);

  const transferDelta = transfers.reduce((sum, transfer) => {
    if (transfer.to_account_id === account.id) return sum + transfer.amount;
    if (transfer.from_account_id === account.id) return sum - transfer.amount;
    return sum;
  }, 0);

  return account.initial_balance + movement + transferDelta;
}
