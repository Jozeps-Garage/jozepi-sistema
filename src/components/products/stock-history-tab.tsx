"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Dropdown } from "@/components/ui/dropdown";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { MOVEMENT_LABEL, type MovementKind } from "@/lib/products/stock";
import {
  loadAllMovements,
  type MovementWithProduct,
} from "@/lib/products/stock-repo";

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Tudo" },
  { value: "entrada", label: "Compras" },
  { value: "baixa", label: "Baixas" },
  { value: "revisao", label: "Conferências" },
];

const KIND_TONE: Record<MovementKind, string> = {
  entrada: "bg-success/10 text-success",
  baixa: "bg-danger/10 text-danger",
  revisao: "bg-primary/10 text-primary",
};

/**
 * Tudo que entrou e saiu do estoque, em ordem.
 *
 * O valor pago vem gravado no próprio movimento, não do preço atual do
 * produto: preço muda, e recalcular pelo de hoje faria o histórico mentir
 * sobre o que custou na época.
 */
export function StockHistoryTab({
  supabase,
  workshopId,
}: {
  supabase: SupabaseClient;
  workshopId: string | null;
}) {
  const [movements, setMovements] = useState<MovementWithProduct[]>([]);
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workshopId) {
      await Promise.resolve();
      setLoading(false);
      return;
    }
    try {
      setMovements(await loadAllMovements(supabase, workshopId));
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.includes("unit_cost") || message.includes("stock_movements")
          ? "O histórico ainda não foi instalado no banco. Aplique as migrations 047 e 049 no Supabase."
          : message || "Não foi possível ler o histórico."
      );
      setLoading(false);
    }
  }, [supabase, workshopId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return movements.filter((movement) => {
      if (kindFilter !== "all" && movement.kind !== kindFilter) return false;
      if (!term) return true;
      return movement.productName.toLowerCase().includes(term);
    });
  }, [movements, kindFilter, search]);

  const totalPago = visible
    .filter((movement) => movement.kind === "entrada")
    .reduce(
      (total, movement) => total + (movement.unitCost ?? 0) * movement.quantity,
      0
    );

  return (
    <section className="product-tab-panel-enter space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            label=""
            value={kindFilter}
            options={KIND_FILTERS}
            onChange={setKindFilter}
            compact
            className="w-40"
          />
          <div className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
            <MagnifyingGlass
              size={15}
              weight="light"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto…"
              aria-label="Buscar no histórico"
              className="h-10 w-full rounded-lg border border-border/80 bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {totalPago > 0 && (
          <p className="text-sm text-muted">
            Comprado no período listado:{" "}
            <strong className="text-foreground">{formatCurrency(totalPago)}</strong>
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Lendo o histórico…
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {movements.length === 0
              ? "Nada movimentou o estoque ainda. Compras lançadas na despesa, baixas e conferências aparecem aqui."
              : "Nenhuma movimentação com esse filtro."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((movement) => {
              const pago =
                movement.kind === "entrada" && movement.unitCost !== null
                  ? movement.unitCost * movement.quantity
                  : null;

              return (
                <li
                  key={movement.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <span className="w-20 shrink-0 text-xs font-semibold tabular-nums text-muted">
                    {formatDate(movement.occurredOn)}
                  </span>
                  <span
                    className={`w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-bold ${
                      KIND_TONE[movement.kind]
                    }`}
                  >
                    {MOVEMENT_LABEL[movement.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {movement.productName}
                    </span>
                    {movement.notes && (
                      <span className="block truncate text-xs text-muted">
                        {movement.notes}
                      </span>
                    )}
                  </span>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                    {movement.kind === "revisao"
                      ? `= ${movement.balanceAfter}`
                      : movement.kind === "entrada"
                        ? `+${movement.quantity}`
                        : `−${movement.quantity}`}
                  </span>
                  <span className="w-28 shrink-0 text-right text-sm tabular-nums text-muted">
                    {pago !== null ? formatCurrency(pago) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
