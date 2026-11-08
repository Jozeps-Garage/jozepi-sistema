"use client";

import { useMemo, useState } from "react";
import { CaretDown, CaretRight, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  calculateServiceUsageCost,
  type ProductItem,
  type ServiceProductUsage,
} from "@/lib/products/catalog";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";

const ICON_WEIGHT = "light" as const;

const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-border/80 bg-card px-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export interface PricedService {
  id: string;
  name: string;
  price: number;
}

function newLineId() {
  return `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Patrimônio não se consome: politriz não entra na conta de um serviço. */
function isPriceable(product: ProductItem) {
  return product.kind !== "patrimonio";
}

function amountUnit(product: ProductItem | undefined) {
  if (!product) return "";
  const isLiquid = product.kind
    ? product.kind === "liquido"
    : product.type === "liquid";
  return isLiquid ? "ml" : product.unitLabel || "un";
}

/**
 * A conta de quanto de produto entra em cada serviço, e o que sobra do preço
 * cobrado.
 *
 * Uma versão disso viveu dentro do formulário de cada serviço e foi removida
 * em outubro: era cadastro para manter, escondido, sem nada à vista que
 * pagasse o trabalho. Aqui a tabela mostra todos os serviços com custo e
 * margem de uma vez — o motivo de manter fica na mesma tela que pede o
 * preenchimento.
 */
export function ServicePricingTable({
  services,
  products,
  usagesByService,
  onSave,
}: {
  services: PricedService[];
  products: ProductItem[];
  usagesByService: Record<string, ServiceProductUsage[]>;
  onSave: (serviceId: string, usages: ServiceProductUsage[]) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServiceProductUsage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceableProducts = useMemo(
    () => products.filter(isPriceable),
    [products]
  );

  const rows = useMemo(
    () =>
      services.map((service) => {
        const usages = usagesByService[service.id] ?? [];
        const cost = usages.reduce(
          (total, usage) => total + calculateServiceUsageCost(usage, products),
          0
        );
        return {
          service,
          lines: usages.length,
          cost,
          margin: service.price - cost,
          // Sem preço não há percentual: dividir por zero não diz nada.
          marginPercent: service.price > 0 ? ((service.price - cost) / service.price) * 100 : null,
        };
      }),
    [services, usagesByService, products]
  );

  function open(serviceId: string) {
    setError(null);
    setOpenId(serviceId);
    setDraft((usagesByService[serviceId] ?? []).map((usage) => ({ ...usage })));
  }

  function close() {
    setOpenId(null);
    setDraft([]);
    setError(null);
  }

  function updateLine(id: string, patch: Partial<ServiceProductUsage>) {
    setDraft((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line))
    );
  }

  const draftCost = draft.reduce(
    (total, usage) => total + calculateServiceUsageCost(usage, products),
    0
  );

  async function save(serviceId: string) {
    // Linha pela metade não vai para o banco: produto sem quantidade e avulsa
    // sem nome valem zero e só sujariam a conta.
    const clean = draft.filter((line) =>
      line.productId
        ? Boolean(line.productId && line.amount.trim())
        : Boolean(line.label?.trim())
    );

    setSaving(true);
    setError(null);
    try {
      await onSave(serviceId, clean);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (services.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted">
        Cadastre um serviço para precificá-lo.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="hidden grid-cols-[1fr_7rem_7rem_8rem] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted sm:grid">
        <span>Serviço</span>
        <span className="text-right">Preço</span>
        <span className="text-right">Custo</span>
        <span className="text-right">Margem</span>
      </div>

      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const expanded = openId === row.service.id;
          const negative = row.margin < 0;

          return (
            <li key={row.service.id}>
              <button
                type="button"
                onClick={() => (expanded ? close() : open(row.service.id))}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-background/60"
              >
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_7rem_7rem_8rem] sm:items-center sm:gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {expanded ? (
                      <CaretDown size={12} weight={ICON_WEIGHT} aria-hidden />
                    ) : (
                      <CaretRight size={12} weight={ICON_WEIGHT} aria-hidden />
                    )}
                    <span className="truncate text-sm font-semibold text-foreground">
                      {row.service.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {row.lines === 0
                        ? "sem itens"
                        : row.lines === 1
                          ? "1 item"
                          : `${row.lines} itens`}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-muted sm:text-right">
                    {formatCurrency(row.service.price)}
                  </span>
                  <span className="text-sm tabular-nums text-muted sm:text-right">
                    {row.cost > 0 ? formatCurrency(row.cost) : "—"}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums sm:text-right",
                      negative ? "text-danger" : "text-foreground"
                    )}
                  >
                    {formatCurrency(row.margin)}
                    {row.marginPercent !== null && (
                      <span className="ml-1.5 text-xs font-semibold text-muted">
                        {row.marginPercent.toFixed(0)}%
                      </span>
                    )}
                  </span>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-border bg-background/40 px-4 py-4">
                  {draft.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nenhum item ainda. Some o que este serviço gasta.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {draft.map((line) => {
                        const product = line.productId
                          ? products.find((item) => item.id === line.productId)
                          : undefined;
                        const lineCost = calculateServiceUsageCost(line, products);

                        return (
                          <div
                            key={line.id}
                            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_6rem_2rem] sm:items-center"
                          >
                            {line.productId !== null ? (
                              <>
                                <select
                                  aria-label="Produto"
                                  className={FIELD_CLASS}
                                  value={line.productId}
                                  onChange={(event) =>
                                    updateLine(line.id, {
                                      productId: event.target.value,
                                    })
                                  }
                                >
                                  <option value="">Selecione o produto</option>
                                  {priceableProducts.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="relative">
                                  <input
                                    aria-label="Quantidade usada"
                                    inputMode="decimal"
                                    className={cn(FIELD_CLASS, "pr-10")}
                                    placeholder="0"
                                    value={line.amount}
                                    onChange={(event) =>
                                      updateLine(line.id, {
                                        amount: event.target.value,
                                      })
                                    }
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">
                                    {amountUnit(product)}
                                  </span>
                                </div>
                              </>
                            ) : (
                              <>
                                <input
                                  aria-label="Item"
                                  className={FIELD_CLASS}
                                  placeholder="Ex.: cera de carnaúba"
                                  value={line.label ?? ""}
                                  onChange={(event) =>
                                    updateLine(line.id, {
                                      label: event.target.value,
                                    })
                                  }
                                />
                                <div className="relative">
                                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">
                                    R$
                                  </span>
                                  <input
                                    aria-label="Custo do item"
                                    inputMode="decimal"
                                    className={cn(FIELD_CLASS, "pl-9")}
                                    placeholder="0,00"
                                    value={line.cost ?? ""}
                                    onChange={(event) =>
                                      updateLine(line.id, {
                                        cost: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </>
                            )}
                            <span className="text-sm font-semibold tabular-nums text-foreground sm:text-right">
                              {lineCost > 0 ? formatCurrency(lineCost) : "—"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setDraft((prev) =>
                                  prev.filter((item) => item.id !== line.id)
                                )
                              }
                              className="justify-self-start rounded-lg p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger sm:justify-self-center"
                              aria-label="Remover item"
                              title="Remover item"
                            >
                              <Trash size={15} weight={ICON_WEIGHT} aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => [
                          ...prev,
                          { id: newLineId(), productId: "", amount: "" },
                        ])
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-success/50 bg-success/5 px-3 py-2 text-xs font-semibold text-success transition-colors hover:border-success hover:bg-success/10"
                    >
                      <Plus size={14} weight={ICON_WEIGHT} aria-hidden />
                      Produto do estoque
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => [
                          ...prev,
                          { id: newLineId(), productId: null, amount: "", label: "", cost: "" },
                        ])
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <Plus size={14} weight={ICON_WEIGHT} aria-hidden />
                      Item avulso
                    </button>
                  </div>

                  <p className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3 text-sm">
                    <span className="text-muted">
                      Preço {formatCurrency(row.service.price)}
                      {draftCost > 0 && (
                        <span className="ml-1.5 font-semibold text-danger">
                          − {formatCurrency(draftCost)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-muted">Margem</span>
                      <strong
                        className={cn(
                          "text-base font-bold tabular-nums",
                          row.service.price - draftCost < 0
                            ? "text-danger"
                            : "text-foreground"
                        )}
                      >
                        {formatCurrency(row.service.price - draftCost)}
                      </strong>
                    </span>
                  </p>

                  {error && <p className="mt-3 text-sm text-danger">{error}</p>}

                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={close} disabled={saving}>
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      variant="success"
                      loading={saving}
                      onClick={() => void save(row.service.id)}
                    >
                      Salvar itens
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
