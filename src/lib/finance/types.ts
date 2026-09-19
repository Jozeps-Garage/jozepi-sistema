export type TransactionType = "receita" | "despesa";
export type PaymentStatus = "pendente" | "pago" | "parcial" | "cancelado";
export type FinancialAccountType = "dinheiro" | "banco" | "digital" | "outro";

export const FINANCIAL_ACCOUNT_TYPE_LABEL: Record<FinancialAccountType, string> = {
  dinheiro: "Dinheiro",
  banco: "Banco",
  digital: "Digital",
  outro: "Outro",
};

export const DEFAULT_ACCOUNT_NAME = "Não classificado";
export const FIXED_COST_CATEGORY_NAME = "Custo Fixo";

export interface FinancialAccount {
  id: string;
  workshop_id: string;
  name: string;
  type: FinancialAccountType;
  initial_balance: number;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinancialCategory {
  id: string;
  workshop_id: string;
  name: string;
  type: TransactionType;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinancialTransfer {
  id: string;
  workshop_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  transfer_date: string;
  description: string | null;
  created_at: string;
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return (
    value === "pendente" ||
    value === "pago" ||
    value === "parcial" ||
    value === "cancelado"
  );
}

export function isAccountType(value: unknown): value is FinancialAccountType {
  return (
    value === "dinheiro" ||
    value === "banco" ||
    value === "digital" ||
    value === "outro"
  );
}

export function cashDate(row: {
  effective_date?: string | null;
  transaction_date: string;
}) {
  return row.effective_date || row.transaction_date;
}

export function toMoneyNumber(value: number | string | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}
