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

/**
 * `financial_transactions.category` é uma cópia do nome, não uma FK: os filtros
 * e o DRE agrupam por essa coluna. Sem carregar o rename até lá, o nome antigo
 * continua aparecendo ao lado do novo como se fossem duas categorias.
 */
async function renameTransactionCategory(
  supabase: SupabaseClient,
  workshopId: string,
  input: {
    categoryId: string;
    type: TransactionType;
    previousName: string;
    nextName: string;
  }
) {
  const linked = await supabase
    .from("financial_transactions")
    .update({ category: input.nextName })
    .eq("workshop_id", workshopId)
    .eq("category_id", input.categoryId);

  // Lançamentos de antes da 031 têm só o texto, sem `category_id`. O tipo
  // separa uma receita e uma despesa que se chamem igual.
  const legacy = await supabase
    .from("financial_transactions")
    .update({ category: input.nextName })
    .eq("workshop_id", workshopId)
    .is("category_id", null)
    .eq("type", input.type)
    .eq("category", input.previousName);

  if (linked.error || legacy.error) {
    throw new Error(
      linked.error?.message ??
        legacy.error?.message ??
        "Não foi possível renomear a categoria nos lançamentos."
    );
  }
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
): Promise<{ category: FinancialCategory; renamedFrom: string | null }> {
  const payload = {
    workshop_id: workshopId,
    name: input.name.trim(),
    type: input.type,
    active: input.active,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    // Lido antes do update: é o nome que os lançamentos ainda carregam.
    const previous = await supabase
      .from("financial_categories")
      .select("name")
      .eq("id", input.id)
      .eq("workshop_id", workshopId)
      .maybeSingle();
    const previousName = previous.error
      ? null
      : ((previous.data?.name as string | null | undefined) ?? null);

    const renamedFrom =
      previousName && previousName !== payload.name ? previousName : null;

    // Os lançamentos primeiro, de propósito: se este passo falhar, nada mudou
    // e tentar de novo começa do mesmo lugar. Na ordem inversa, a categoria já
    // teria o nome novo e o nome antigo nos lançamentos ficaria sem quem o
    // procurasse.
    if (renamedFrom) {
      await renameTransactionCategory(supabase, workshopId, {
        categoryId: input.id,
        type: input.type,
        previousName: renamedFrom,
        nextName: payload.name,
      });
    }

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

    return { category: normalizeCategory(data as Record<string, unknown>), renamedFrom };
  }

  const { data, error } = await supabase
    .from("financial_categories")
    .insert(payload)
    .select("id, workshop_id, name, type, active, created_at, updated_at")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Não foi possível criar a categoria.");
  }
  return { category: normalizeCategory(data as Record<string, unknown>), renamedFrom: null };
}
