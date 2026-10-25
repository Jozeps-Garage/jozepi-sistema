import type { SupabaseClient } from "@supabase/supabase-js";
import {
  balanceAfterMovement,
  type MovementKind,
  type StockItem,
  type StockKind,
  type StockMovement,
} from "@/lib/products/stock";

const STOCK_SELECT =
  "id, name, kind, on_hand, min_on_hand, unit_label, package_volume_ml, resale_value, acquired_on, total_cost, supplier_id, photo_url, type, volume_ml, quantity";

const MOVEMENT_SELECT =
  "id, product_id, kind, quantity, balance_after, occurred_on, notes, transaction_id, unit_cost, created_at";

/** Sem a 047 as colunas não existem; a tela avisa em vez de quebrar. */
export function isMissingStockColumn(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("on_hand") ||
    message.includes("unit_label") ||
    message.includes("package_volume_ml") ||
    message.includes("stock_movements") ||
    message.includes("\"kind\"")
  );
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** O custo vem como texto em formato BR ("1.234,56") do modelo antigo. */
function moneyFromText(value: unknown) {
  if (typeof value === "number") return value;
  const raw = text(value).trim();
  if (!raw) return 0;
  const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function kindFromRow(row: Record<string, unknown>): StockKind {
  const kind = text(row.kind);
  if (kind === "liquido" || kind === "utensilio" || kind === "patrimonio") {
    return kind;
  }
  // Linha que a 047 não alcançou: cai pelo tipo antigo.
  return text(row.type) === "liquid" ? "liquido" : "utensilio";
}

export function stockItemFromRow(row: Record<string, unknown>): StockItem {
  const kind = kindFromRow(row);
  return {
    id: String(row.id),
    name: text(row.name),
    kind,
    onHand: numberOrNull(row.on_hand) ?? 0,
    minOnHand: numberOrNull(row.min_on_hand),
    unitLabel: text(row.unit_label) || (kind === "liquido" ? "frasco" : "unidade"),
    packageVolumeMl: numberOrNull(row.package_volume_ml),
    unitCost: moneyFromText(row.total_cost),
    resaleValue: numberOrNull(row.resale_value),
    acquiredOn: text(row.acquired_on) || null,
    supplierId: text(row.supplier_id) || null,
    photoUrl: text(row.photo_url) || null,
  };
}

export async function loadStockItems(
  supabase: SupabaseClient,
  workshopId: string
): Promise<StockItem[]> {
  const { data, error } = await supabase
    .from("products")
    .select(STOCK_SELECT)
    .eq("workshop_id", workshopId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[] | null) ?? []).map(stockItemFromRow);
}

export function movementFromRow(row: Record<string, unknown>): StockMovement {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    kind: text(row.kind) as MovementKind,
    quantity: numberOrNull(row.quantity) ?? 0,
    balanceAfter: numberOrNull(row.balance_after) ?? 0,
    occurredOn: text(row.occurred_on),
    notes: text(row.notes) || null,
    transactionId: text(row.transaction_id) || null,
    unitCost: numberOrNull(row.unit_cost),
    createdAt: text(row.created_at),
  };
}

export async function loadMovements(
  supabase: SupabaseClient,
  workshopId: string,
  productId: string
): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT)
    .eq("workshop_id", workshopId)
    .eq("product_id", productId)
    // Crescente: os ciclos são montados na ordem em que aconteceram.
    .order("occurred_on", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[] | null) ?? []).map(movementFromRow);
}

/** Movimento com nome e categoria do produto, para a aba de histórico. */
export interface MovementWithProduct extends StockMovement {
  productName: string;
  productKind: StockKind;
}

export async function loadAllMovements(
  supabase: SupabaseClient,
  workshopId: string
): Promise<MovementWithProduct[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select(`${MOVEMENT_SELECT}, products(name, kind)`)
    .eq("workshop_id", workshopId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => {
    const joined = row.products;
    const product = (Array.isArray(joined) ? joined[0] : joined) as
      | { name?: string; kind?: string }
      | null
      | undefined;
    return {
      ...movementFromRow(row),
      productName: product?.name ?? "Produto removido",
      productKind: kindFromRow({ kind: product?.kind }),
    };
  });
}

export interface MovementInput {
  productId: string;
  kind: MovementKind;
  /** Entrada/baixa: quanto mexeu. Revisão: o saldo contado. */
  quantity: number;
  occurredOn: string;
  notes?: string | null;
  transactionId?: string | null;
  /** Quanto custou cada unidade. Só faz sentido em entrada. */
  unitCost?: number | null;
}

/**
 * Grava o movimento e deixa o saldo do produto de acordo.
 *
 * O saldo fica nas duas pontas de propósito: em `products.on_hand`, para a
 * lista ler sem somar a história toda, e em `balance_after`, para o histórico
 * não depender de recalcular a cadeia inteira.
 */
export async function recordMovement(
  supabase: SupabaseClient,
  workshopId: string,
  currentOnHand: number,
  input: MovementInput
): Promise<number> {
  const balance = balanceAfterMovement(currentOnHand, input.kind, input.quantity);

  const { error: movementError } = await supabase.from("stock_movements").insert({
    workshop_id: workshopId,
    product_id: input.productId,
    kind: input.kind,
    quantity: input.quantity,
    balance_after: balance,
    occurred_on: input.occurredOn,
    notes: input.notes?.trim() || null,
    transaction_id: input.transactionId ?? null,
    unit_cost: input.unitCost ?? null,
  });

  if (movementError) throw new Error(movementError.message);

  const { error: productError } = await supabase
    .from("products")
    .update({ on_hand: balance, updated_at: new Date().toISOString() })
    .eq("id", input.productId)
    .eq("workshop_id", workshopId);

  if (productError) throw new Error(productError.message);
  return balance;
}
