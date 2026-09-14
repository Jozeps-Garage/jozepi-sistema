import {
  normalizeProductStock,
  productTypeOptions,
  PRODUCTS_STORAGE_KEY,
  PRODUCT_TYPES_STORAGE_KEY,
  SERVICE_PRODUCT_USAGE_STORAGE_KEY,
  type ProductItem,
  type ProductPriceHistoryEntry,
  type ProductTypeOption,
  type ServiceProductUsage,
} from "@/lib/products/catalog";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ProductRow {
  id: string;
  name: string;
  type: string;
  volume_ml: string;
  usage_per_wash_ml: string;
  quantity: string;
  durability_washes: string;
  total_cost: string;
  photo_url: string | null;
  supplier_id: string | null;
  stock_remaining: string | null;
  price_history: ProductPriceHistoryEntry[] | null;
  created_at?: string | null;
}

interface ProductTypeRow {
  value: string;
  label: string;
  custom: boolean;
}

interface ProductUsageRow {
  id: string;
  service_id: string;
  product_id: string;
  amount: string;
}

type SupabaseLike = SupabaseClient;

function isQueryBuilder(value: unknown): value is {
  eq: (column: string, value: unknown) => unknown;
  in: (column: string, value: unknown[]) => unknown;
  order: (column: string, options?: unknown) => unknown;
  single: () => unknown;
} {
  return typeof value === "object" && value !== null;
}

function productFromRow(row: ProductRow): ProductItem {
  return normalizeProductStock({
    id: row.id,
    name: row.name,
    type: row.type,
    volumeMl: row.volume_ml ?? "",
    usagePerWashMl: row.usage_per_wash_ml ?? "",
    quantity: row.quantity ?? "",
    durabilityWashes: row.durability_washes ?? "",
    totalCost: row.total_cost ?? "",
    photoUrl: row.photo_url ?? undefined,
    supplierId: row.supplier_id ?? undefined,
    stockRemaining: row.stock_remaining ?? undefined,
    priceHistory: Array.isArray(row.price_history) ? row.price_history : [],
    createdAt: row.created_at ?? undefined,
  });
}

function productToRow(product: ProductItem, workshopId: string) {
  return {
    id: product.id,
    workshop_id: workshopId,
    name: product.name,
    type: product.type,
    volume_ml: product.volumeMl ?? "",
    usage_per_wash_ml: product.usagePerWashMl ?? "",
    quantity: product.quantity ?? "",
    durability_washes: product.durabilityWashes ?? "",
    total_cost: product.totalCost ?? "",
    photo_url: product.photoUrl ?? null,
    supplier_id: product.supplierId ?? null,
    stock_remaining: product.stockRemaining ?? null,
    price_history: product.priceHistory ?? [],
    updated_at: new Date().toISOString(),
  };
}

function typeToRow(type: ProductTypeOption, workshopId: string) {
  return {
    workshop_id: workshopId,
    value: type.value,
    label: type.label,
    custom: Boolean(type.custom),
    updated_at: new Date().toISOString(),
  };
}

export function mergeProductLists(current: ProductItem[], incoming: ProductItem[]) {
  const byId = new Map(current.map((product) => [product.id, product]));
  incoming.forEach((product) => byId.set(product.id, product));
  return Array.from(byId.values());
}

export function mergeProductTypes(incoming: ProductTypeOption[]) {
  const byValue = new Map(productTypeOptions.map((option) => [option.value, option]));
  incoming.forEach((option) => byValue.set(option.value, option));
  return Array.from(byValue.values());
}

export function usagesFromRows(rows: ProductUsageRow[]) {
  return rows.reduce<Record<string, ServiceProductUsage[]>>((acc, row) => {
    acc[row.service_id] = [
      ...(acc[row.service_id] ?? []),
      { id: row.id, productId: row.product_id, amount: row.amount },
    ];
    return acc;
  }, {});
}

export async function loadSupabaseCatalog(
  supabase: SupabaseLike,
  workshopId: string
) {
  const productsQuery = supabase
    .from("products")
    .select(
      "id, name, type, volume_ml, usage_per_wash_ml, quantity, durability_washes, total_cost, photo_url, supplier_id, stock_remaining, price_history, created_at"
    );
  const typesQuery = supabase
    .from("product_types")
    .select("value, label, custom");
  const usagesQuery = supabase
    .from("service_product_usages")
    .select("id, service_id, product_id, amount");

  if (
    !isQueryBuilder(productsQuery) ||
    !isQueryBuilder(typesQuery) ||
    !isQueryBuilder(usagesQuery)
  ) {
    throw new Error("Cliente Supabase inválido.");
  }

  const productsResult = await productsQuery
    .eq("workshop_id", workshopId)
    .order("name", { ascending: true });
  const typesResult = await typesQuery
    .eq("workshop_id", workshopId)
    .order("label", { ascending: true });
  const usagesResult = await usagesQuery.eq("workshop_id", workshopId);

  if (productsResult.error) throw new Error(productsResult.error.message);
  if (typesResult.error) throw new Error(typesResult.error.message);
  if (usagesResult.error) throw new Error(usagesResult.error.message);

  return {
    products: ((productsResult.data ?? []) as ProductRow[]).map(productFromRow),
    typeOptions: mergeProductTypes(
      ((typesResult.data ?? []) as ProductTypeRow[]).map((type) => ({
        value: type.value,
        label: type.label,
        custom: type.custom,
      }))
    ),
    serviceProductUsages: usagesFromRows(
      (usagesResult.data ?? []) as ProductUsageRow[]
    ),
  };
}

export async function saveSupabaseProduct(
  supabase: SupabaseLike,
  workshopId: string,
  product: ProductItem
) {
  const result = supabase
    .from("products")
    .upsert?.(productToRow(product, workshopId), { onConflict: "id" });

  if (!result) throw new Error("Tabela products indisponível.");

  const { error } = (await result) as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

export async function deleteSupabaseProduct(supabase: SupabaseLike, productId: string) {
  const query = supabase.from("products").delete?.();
  if (!query || !isQueryBuilder(query)) throw new Error("Tabela products indisponível.");

  const { error } = (await query.eq("id", productId)) as {
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
}

export async function saveSupabaseProductTypes(
  supabase: SupabaseLike,
  workshopId: string,
  types: ProductTypeOption[]
) {
  const customTypes = types.filter((type) => type.custom);
  if (customTypes.length === 0) return;

  const result = supabase
    .from("product_types")
    .upsert?.(customTypes.map((type) => typeToRow(type, workshopId)), {
      onConflict: "workshop_id,value",
    });

  if (!result) throw new Error("Tabela product_types indisponível.");

  const { error } = (await result) as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

export async function replaceSupabaseServiceUsages(
  supabase: SupabaseLike,
  workshopId: string,
  serviceId: string,
  usages: ServiceProductUsage[]
) {
  const deleteQuery = supabase.from("service_product_usages").delete?.();
  if (!deleteQuery || !isQueryBuilder(deleteQuery)) {
    throw new Error("Tabela service_product_usages indisponível.");
  }

  const { error: deleteError } = (await deleteQuery.eq("service_id", serviceId)) as {
    error: { message: string } | null;
  };
  if (deleteError) throw new Error(deleteError.message);

  if (usages.length === 0) return;

  const result = supabase.from("service_product_usages").insert?.(
    usages.map((usage) => ({
      id: usage.id,
      workshop_id: workshopId,
      service_id: serviceId,
      product_id: usage.productId,
      amount: usage.amount,
    }))
  );

  if (!result) throw new Error("Tabela service_product_usages indisponível.");

  const { error } = (await result) as { error: { message: string } | null };
  if (error) throw new Error(error.message);
}

export function readLocalCatalogFromStorage() {
  if (typeof window === "undefined") {
    return {
      products: [] as ProductItem[],
      typeOptions: productTypeOptions,
      serviceProductUsages: {} as Record<string, ServiceProductUsage[]>,
      hasData: false,
    };
  }

  let products: ProductItem[] = [];
  let typeOptions = [...productTypeOptions];
  let serviceProductUsages: Record<string, ServiceProductUsage[]> = {};
  let hasData = false;

  try {
    const storedProducts = window.localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (storedProducts) {
      products = (JSON.parse(storedProducts) as ProductItem[]).map(normalizeProductStock);
      hasData = hasData || products.length > 0;
    }
  } catch {
    window.localStorage.removeItem(PRODUCTS_STORAGE_KEY);
  }

  try {
    const storedTypes = window.localStorage.getItem(PRODUCT_TYPES_STORAGE_KEY);
    if (storedTypes) {
      const customTypes = JSON.parse(storedTypes) as ProductTypeOption[];
      typeOptions = mergeProductTypes(customTypes);
      hasData = hasData || customTypes.length > 0;
    }
  } catch {
    window.localStorage.removeItem(PRODUCT_TYPES_STORAGE_KEY);
  }

  try {
    const storedUsages = window.localStorage.getItem(SERVICE_PRODUCT_USAGE_STORAGE_KEY);
    if (storedUsages) {
      serviceProductUsages = JSON.parse(storedUsages) as Record<
        string,
        ServiceProductUsage[]
      >;
      hasData =
        hasData || Object.values(serviceProductUsages).some((usages) => usages.length > 0);
    }
  } catch {
    window.localStorage.removeItem(SERVICE_PRODUCT_USAGE_STORAGE_KEY);
  }

  return { products, typeOptions, serviceProductUsages, hasData };
}

export function clearLocalCatalogStorage() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(PRODUCTS_STORAGE_KEY);
  window.localStorage.removeItem(PRODUCT_TYPES_STORAGE_KEY);
  window.localStorage.removeItem(SERVICE_PRODUCT_USAGE_STORAGE_KEY);
}

export async function importLocalCatalogToSupabase(
  supabase: SupabaseLike,
  workshopId: string,
  products: ProductItem[],
  types: ProductTypeOption[],
  usages: Record<string, ServiceProductUsage[]>
) {
  for (const product of products) {
    await saveSupabaseProduct(supabase, workshopId, {
      ...product,
      supplierId: undefined,
    });
  }

  await saveSupabaseProductTypes(supabase, workshopId, types);

  for (const [serviceId, serviceUsages] of Object.entries(usages)) {
    await replaceSupabaseServiceUsages(supabase, workshopId, serviceId, serviceUsages);
  }
}
