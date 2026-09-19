import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialCategory, TransactionType } from "@/lib/finance/types";

function normalizeCategory(row: Record<string, unknown>): FinancialCategory {
  return {
    id: String(row.id),
    workshop_id: String(row.workshop_id),
    name: String(row.name ?? ""),
    type: row.type === "despesa" ? "despesa" : "receita",
    active: Boolean(row.active ?? true),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function loadFinancialCategories(
  supabase: SupabaseClient,
  workshopId: string
): Promise<FinancialCategory[]> {
  const { data, error } = await supabase
    .from("financial_categories")
    .select("id, workshop_id, name, type, active, created_at, updated_at")
    .eq("workshop_id", workshopId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeCategory);
}

export function categoriesOfType(
  categories: FinancialCategory[],
  type: TransactionType,
  { includeInactive = false }: { includeInactive?: boolean } = {}
) {
  return categories.filter(
    (category) =>
      category.type === type && (includeInactive || category.active)
  );
}

export function matchCategoryId(
  categories: FinancialCategory[],
  type: TransactionType,
  name: string | null | undefined
) {
  const needle = name?.trim().toLowerCase();
  if (!needle) return "";
  return (
    categories.find(
      (category) =>
        category.type === type && category.name.trim().toLowerCase() === needle
    )?.id ?? ""
  );
}

export async function saveFinancialCategory(
  supabase: SupabaseClient,
  workshopId: string,
  input: {
    id?: string;
    name: string;
    type: TransactionType;
    active: boolean;
  }
) {
  const payload = {
    workshop_id: workshopId,
    name: input.name.trim(),
    type: input.type,
    active: input.active,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("financial_categories")
      .update(payload)
      .eq("id", input.id)
      .eq("workshop_id", workshopId)
      .select("id, workshop_id, name, type, active, created_at, updated_at")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Não foi possível salvar a categoria.");
    }
    return normalizeCategory(data as Record<string, unknown>);
  }

  const { data, error } = await supabase
    .from("financial_categories")
    .insert(payload)
    .select("id, workshop_id, name, type, active, created_at, updated_at")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Não foi possível criar a categoria.");
  }
  return normalizeCategory(data as Record<string, unknown>);
}
