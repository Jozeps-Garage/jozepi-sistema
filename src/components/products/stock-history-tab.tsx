"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, MagnifyingGlass } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Dropdown } from "@/components/ui/dropdown";
import { StockKindIcon } from "@/components/products/stock-kind-icon";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  STOCK_KIND_OPTIONS,
  buildWriteOffs,
  formatDuration,
  type StockWriteOff,
} from "@/lib/products/stock";
import {
  loadAllMovements,
  type MovementWithProduct,
} from "@/lib/products/stock-repo";

const KIND_FILTERS = [
  { value: "all", label: "Tudo" },
  ...STOCK_KIND_OPTIONS.map((option) => ({
    value: option.value as string,
    label: option.label,
  })),
];

/**
 * Quanto custou o que saiu.
 *
 * O preço da compra que abasteceu aquele saldo é o número certo. Quando não
 * há compra atrás da baixa — saldo que veio de conferência, ou de antes de
 * existir histórico — vale mais mostrar o custo do cadastro avisando que é
 * aproximação do que deixar a coluna muda.
 */
function valueOf(row: StockWriteOff<MovementWithProduct>) {
  const quantity = row.movement.quantity;
  if (row.unitCost !== null) {
    return { amount: row.unitCost * quantity, estimated: false };
  }
  const fallback = row.movement.productUnitCost;
  if (fallback > 0) return { amount: fallback * quantity, estimated: true };
  return null;
}

/** Motivo que só repete o que a linha já diz vira ruído: "Acabou · acabou". */
function extraNote(row: StockWriteOff<MovementWithProduct>) {
  const note = row.movement.notes?.trim();
  if (!note) return "";
  if (row.emptied && /^acabou\.?$/i.test(note)) return "";
  return ` · ${note}`;
}

/** O que a baixa fez com o saldo. As datas ficam nas setas, ao lado. */
function statusLine(row: StockWriteOff<MovementWithProduct>) {
  if (!row.emptied) {
    const resto = row.movement.balanceAfter;
    return `Sobrou ${resto} ${resto === 1 ? "unidade" : "unidades"}`;
  }
  if (row.days === null) return "Acabou";
  // "durou no mesmo dia" não se lê; no dia da entrada a frase é outra.
  if (row.days === 0) return "Acabou no mesmo dia";
  return `Acabou · durou ${formatDuration(row.days)}`;
}

/**
 * O que já saiu do estoque.
 *
 * Só baixa: entrada e revisão enchiam a lista de linhas que não respondiam
 * nada — a compra você já vê na despesa, e a conferência é rotina. A pergunta
 * que esta aba existe para responder é quanto tempo um produto durou, então
 * cada baixa vem ao lado de desde quando aquele saldo estava ali e do que se
 * pagou por ele — gravado no movimento da compra, não no preço de hoje.
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

  // A baixa precisa da história inteira do produto para saber desde quando
  // havia saldo, então os movimentos são separados por produto antes de virar
  // linha — e só então reordenados, do mais recente para o mais antigo.
  const writeOffs = useMemo(() => {
    const byProduct = new Map<string, MovementWithProduct[]>();
    movements.forEach((movement) => {
      const list = byProduct.get(movement.productId);
      if (list) list.push(movement);
      else byProduct.set(movement.productId, [movement]);
    });

    const rows: StockWriteOff<MovementWithProduct>[] = [];
    byProduct.forEach((list) => {
      const ascending = [...list].sort((a, b) =>
        a.occurredOn === b.occurredOn
          ? a.createdAt.localeCompare(b.createdAt)
          : a.occurredOn.localeCompare(b.occurredOn)
      );
      rows.push(...buildWriteOffs(ascending));
    });

    return rows.sort((a, b) =>
      a.movement.occurredOn === b.movement.occurredOn
        ? b.movement.createdAt.localeCompare(a.movement.createdAt)
        : b.movement.occurredOn.localeCompare(a.movement.occurredOn)
    );
  }, [movements]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return writeOffs.filter((row) => {
      if (kindFilter !== "all" && row.movement.productKind !== kindFilter) {
        return false;
      }
      if (!term) return true;
      return row.movement.productName.toLowerCase().includes(term);
    });
  }, [writeOffs, kindFilter, search]);

  const totalSaiu = visible.reduce(
    (total, row) => total + (valueOf(row)?.amount ?? 0),
    0
  );
  // Um total com estimativa dentro não pode se passar por exato.
  const totalEstimado = visible.some((row) => valueOf(row)?.estimated);

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

        {totalSaiu > 0 && (
          <p className="text-sm text-muted">
            Saiu no período listado:{" "}
            <strong className="text-foreground">
              {totalEstimado ? "≈ " : ""}
              {formatCurrency(totalSaiu)}
            </strong>
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
            {writeOffs.length === 0
              ? "Nenhuma baixa ainda. Quando um produto acabar ou um utensílio for descartado, a baixa aparece aqui com desde quando ele estava em estoque."
              : "Nenhuma baixa com esse filtro."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((row) => {
              const { movement } = row;
              const saiu = valueOf(row);

              return (
                <li
                  key={movement.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  {/* Entrou em verde, saiu em vermelho: a leitura da linha
                      começa pelas duas datas que a aba existe para comparar. */}
                  <span className="w-24 shrink-0 space-y-0.5 text-xs font-semibold tabular-nums">
                    <span
                      className="flex items-center gap-1.5 text-success"
                      aria-label={
                        row.inStockSince
                          ? `Entrou em ${formatDate(row.inStockSince)}`
                          : "Sem entrada registrada"
                      }
                    >
                      <ArrowDown size={12} weight="bold" aria-hidden />
                      {row.inStockSince ? formatDate(row.inStockSince) : "—"}
                    </span>
                    <span
                      className="flex items-center gap-1.5 text-danger"
                      aria-label={`Saiu em ${formatDate(movement.occurredOn)}`}
                    >
                      <ArrowUp size={12} weight="bold" aria-hidden />
                      {formatDate(movement.occurredOn)}
                    </span>
                  </span>
                  <StockKindIcon kind={movement.productKind} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {movement.productName}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {statusLine(row)}
                      {extraNote(row)}
                    </span>
                  </span>
                  <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-danger">
                    −{movement.quantity}
                  </span>
                  <span
                    className="w-28 shrink-0 text-right text-sm tabular-nums text-muted"
                    title={
                      saiu?.estimated
                        ? "Aproximado pelo custo do cadastro: esta saída não tem compra com valor registrado."
                        : undefined
                    }
                  >
                    {saiu === null
                      ? "—"
                      : `${saiu.estimated ? "≈ " : ""}${formatCurrency(saiu.amount)}`}
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
