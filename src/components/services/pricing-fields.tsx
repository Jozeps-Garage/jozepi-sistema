"use client";

import { useMemo } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
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

/**
 * Líquido se mede no que sai da embalagem; o resto, em quantos serviços a
 * unidade atende — é a divisão que transforma um pano caro num custo de
 * centavos por carro.
 */
function amountUnit(product: ProductItem | undefined) {
  if (!product) return "";
  const isLiquid = product.kind
    ? product.kind === "liquido"
    : product.type === "liquid";
  return isLiquid ? "ml" : "usos";
}

/**
 * O que entra num serviço e quanto sobra do preço cobrado.
 *
 * É uma seção do formulário do serviço, não uma tela à parte: salva no mesmo
 * "Salvar alterações" que o nome e o preço, porque é a mesma decisão. O card
 * mostra o custo e a margem com o formulário fechado — foi a falta disso, e
 * não o lugar, que fez a primeira versão morrer em outubro.
 */
export function ServicePricingFields({
  price,
  products,
  usages,
  onChange,
}: {
  price: number;
  products: ProductItem[];
  usages: ServiceProductUsage[];
  onChange: (usages: ServiceProductUsage[]) => void;
}) {
  const priceableProducts = useMemo(
    () => products.filter(isPriceable),
    [products]
  );

  const draft = usages;

  const cost = draft.reduce(
    (total, usage) => total + calculateServiceUsageCost(usage, products),
    0
  );

  function updateLine(id: string, patch: Partial<ServiceProductUsage>) {
    onChange(
      draft.map((line) => (line.id === id ? { ...line, ...patch } : line))
    );
  }

  return (
    <section className="mt-6 border-t border-border pt-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold tracking-wide text-foreground">
          Custo do serviço
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          O que este serviço gasta. Líquido entra pelos ml; o que não é líquido,
          por quantos serviços a unidade atende — o valor se divide por eles. O
          item avulso você digita com o valor na mão.
        </p>
      </div>
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
                  onClick={() => onChange(draft.filter((item) => item.id !== line.id))}
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
            onChange([...draft, { id: newLineId(), productId: "", amount: "" }])
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-success/50 bg-success/5 px-3 py-2 text-xs font-semibold text-success transition-colors hover:border-success hover:bg-success/10"
        >
          <Plus size={14} weight={ICON_WEIGHT} aria-hidden />
          Produto do estoque
        </button>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...draft,
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

    </section>
  );
}
