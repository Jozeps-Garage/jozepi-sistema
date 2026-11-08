"use client";

import { useMemo, useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
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
 * O que entra num serviço e quanto sobra do preço cobrado.
 *
 * Mora dentro do card do próprio serviço, aberto pela linha de margem. Uma
 * versão disto já viveu escondida no formulário de edição e foi removida em
 * outubro, por ser cadastro para manter sem nada à vista que pagasse o
 * trabalho; agora o custo e a margem ficam no card mesmo fechado, e abrir é
 * só para mexer.
 */
export function ServicePricingEditor({
  price,
  products,
  usages,
  onSave,
  onCancel,
}: {
  price: number;
  products: ProductItem[];
  usages: ServiceProductUsage[];
  onSave: (usages: ServiceProductUsage[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ServiceProductUsage[]>(() =>
    usages.map((usage) => ({ ...usage }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceableProducts = useMemo(
    () => products.filter(isPriceable),
    [products]
  );

  const cost = draft.reduce(
    (total, usage) => total + calculateServiceUsageCost(usage, products),
    0
  );

  function updateLine(id: string, patch: Partial<ServiceProductUsage>) {
    setDraft((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line))
    );
  }

  async function save() {
    // Linha pela metade não vai para o banco: produto sem quantidade e avulsa
    // sem nome valem zero e só sujariam a conta.
    const clean = draft.filter((line) =>
      line.productId ? Boolean(line.amount.trim()) : Boolean(line.label?.trim())
    );

    setSaving(true);
    setError(null);
    try {
      await onSave(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-background/40 p-4">
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
                        updateLine(line.id, { productId: event.target.value })
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
                          updateLine(line.id, { amount: event.target.value })
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
                        updateLine(line.id, { label: event.target.value })
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
                          updateLine(line.id, { cost: event.target.value })
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
                    setDraft((prev) => prev.filter((item) => item.id !== line.id))
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
          Preço {formatCurrency(price)}
          {cost > 0 && (
            <span className="ml-1.5 font-semibold text-danger">
              − {formatCurrency(cost)}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-muted">Margem</span>
          <strong
            className={cn(
              "text-base font-bold tabular-nums",
              price - cost < 0 ? "text-danger" : "text-foreground"
            )}
          >
            {formatCurrency(price - cost)}
          </strong>
        </span>
      </p>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="success"
          loading={saving}
          onClick={() => void save()}
        >
          Salvar itens
        </Button>
      </div>
    </div>
  );
}
