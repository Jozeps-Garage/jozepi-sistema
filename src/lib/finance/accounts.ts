import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_ACCOUNT_NAME,
  isAccountType,
  toMoneyNumber,
  type FinancialAccount,
  type FinancialAccountType,
} from "@/lib/finance/types";

function normalizeAccount(row: Record<string, unknown>): FinancialAccount {
  return {
    id: String(row.id),
    workshop_id: String(row.workshop_id),
    name: String(row.name ?? DEFAULT_ACCOUNT_NAME),
    type: isAccountType(row.type) ? row.type : "outro",
    initial_balance: toMoneyNumber(row.initial_balance as number | string | null),
    active: Boolean(row.active ?? true),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function loadFinancialAccounts(
  supabase: SupabaseClient,
  workshopId: string
): Promise<FinancialAccount[]> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select(
      "id, workshop_id, name, type, initial_balance, active, is_default, created_at, updated_at"
    )
    .eq("workshop_id", workshopId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeAccount);
}

export function defaultAccountId(accounts: FinancialAccount[]) {
  return (
    accounts.find((account) => account.active && account.is_default)?.id ??
    accounts.find((account) => account.active)?.id ??
    ""
  );
}

export async function setDefaultFinancialAccount(
  supabase: SupabaseClient,
  workshopId: string,
  accountId: string
) {
  const { error: clearError } = await supabase
    .from("financial_accounts")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("workshop_id", workshopId)
    .eq("is_default", true);

  if (clearError) throw new Error(clearError.message);

  const { error } = await supabase
    .from("financial_accounts")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("workshop_id", workshopId);

  if (error) throw new Error(error.message);
}

export async function saveFinancialAccount(
  supabase: SupabaseClient,
  workshopId: string,
  input: {
    id?: string;
    name: string;
    type: FinancialAccountType;
    initial_balance: number;
    active: boolean;
  }
) {
  const payload = {
    workshop_id: workshopId,
    name: input.name.trim(),
    type: input.type,
    initial_balance: input.initial_balance,
    active: input.active,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("financial_accounts")
      .update(payload)
      .eq("id", input.id)
      .eq("workshop_id", workshopId)
      .select(
        "id, workshop_id, name, type, initial_balance, active, is_default, created_at, updated_at"
      )
      .single();
    if (error || !data) throw new Error(error?.message ?? "Não foi possível salvar a conta.");
    return normalizeAccount(data as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("financial_accounts")
    .insert({ ...payload, is_default: false })
    .select(
      "id, workshop_id, name, type, initial_balance, active, is_default, created_at, updated_at"
    )
    .single();
  if (error || !data) throw new Error(error?.message ?? "Não foi possível criar a conta.");
  return normalizeAccount(data as Record<string, unknown>);
}
