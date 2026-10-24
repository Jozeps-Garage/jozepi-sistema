"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import { formatCurrency } from "@/lib/utils/format";
import type { ProductItem } from "@/lib/products/catalog";
import {
  loadSupabaseProducts,
  saveSupabaseProduct,
} from "@/lib/products/supabase-catalog";
import { productFromInvoiceLine } from "@/lib/products/stock-entry";
import { recordMovement } from "@/lib/products/stock-repo";

/** A linha da nota, do jeito que o formulário de despesa guarda. */
export interface StockEntryItem {
  uiKey: string;
  description: string;
  quantity: string;
  unitAmount: string;
  volumeMl: string;
  productId: string;
  stockApplied?: boolean;
}

const CREATE = "__criar__";
const SKIP = "__pular__";

function toNumber(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Leva uma compra lançada nas despesas para o estoque.
 *
 * Não acontece sozinho ao salvar de propósito: mexer no saldo é coisa para se
 * conferir antes. Cada item resolvido fica marcado na própria nota, então
 * apertar de novo não soma duas vezes.
 */
export function StockEntryDialog({
  open,
  supabase,
  workshopId,
  items,
  purchaseDate,
  supplierId,
  transactionId,
  onClose,
  onApplied,
}: {
  open: boolean;
  supabase: SupabaseClient;
  workshopId: string | null;
  items: StockEntryItem[];
  purchaseDate: string;
  supplierId?: string;
  /** Despesa que originou a compra, para o histórico apontar de volta. */
  transactionId?: string;
  onClose: () => void;
  onApplied: (appliedKeys: string[]) => Promise<void>;
}) {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  const pending = items.filter((item) => !item.stockApplied);

  const load = useCallback(async () => {
    if (!workshopId) {
      await Promise.resolve();
      setError("Oficina não encontrada.");
      setLoading(false);
      return;
    }
    try {
      // Sem setState antes do await: o estado inicial já nasce "carregando",
      // então nada muda de forma síncrona dentro do efeito.
      const loaded = await loadSupabaseProducts(supabase, workshopId);
      setProducts(loaded);
      // Palpite inicial: o produto que a linha aponta, ou um de mesmo nome.
      const guesses: Record<string, string> = {};
      pending.forEach((item) => {
        const byId = item.productId
          ? loaded.find((product) => product.id === item.productId)
          : undefined;
        const byName = loaded.find(
          (product) =>
            product.name.trim().toLowerCase() ===
            item.description.trim().toLowerCase()
        );
        guesses[item.uiKey] = byId?.id ?? byName?.id ?? "";
      });
      setChoice(guesses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ler o estoque.");
    } finally {
      setLoading(false);
    }
    // pending vem de items, que é estável enquanto o diálogo está aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, workshopId]);

  useEffect(() => {
    // Mesmo padrão dos cards de Configurações: a carga sai do corpo síncrono
    // do efeito, senão a primeira mudança de estado acontece durante o render.
    if (open) void Promise.resolve().then(load);
  }, [open, load]);

  if (!open || typeof document === "undefined") return null;

  const options = [
    { value: "", label: "Escolha o produto…" },
    ...products.map((product) => ({
      value: product.id,
      // Saldo do modelo por embalagem: o stockRemaining antigo ainda carrega
      // mililitros e mostrava "Bactran · 990 ml" ao lado de "fica com 3".
      label: `${product.name} · ${product.onHand ?? 0} ${
        (product.onHand ?? 0) === 1 ? "unidade" : "unidades"
      }`,
    })),
    { value: CREATE, label: "+ Criar produto a partir desta linha" },
    { value: SKIP, label: "Não é produto de estoque — ignorar" },
  ];

  const resolved = pending.filter((item) => {
    const pick = choice[item.uiKey];
    return pick && pick !== SKIP;
  });

  async function handleApply() {
    if (saving) return;
    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    setSaving(true);
    setError(null);
    const appliedKeys: string[] = [];

    try {
      for (const item of pending) {
        const pick = choice[item.uiKey];
        if (!pick) continue;
        if (pick === SKIP) {
          // Marcado como resolvido: não é estoque e não volta a perguntar.
          appliedKeys.push(item.uiKey);
          continue;
        }

        const entry = {
          quantity: toNumber(item.quantity) || 1,
          volumeMl: toNumber(item.volumeMl),
          unitAmount: toNumber(item.unitAmount),
          date: purchaseDate,
        };

        // A compra entra como movimento: é ele que move o saldo e que o
        // histórico lê depois para dizer o que foi comprado e por quanto.
        let productId = pick;
        let saldoAtual = 0;

        if (pick === CREATE) {
          const created = productFromInvoiceLine({
            name: item.description,
            quantity: entry.quantity,
            volumeMl: entry.volumeMl,
            unitAmount: entry.unitAmount,
            supplierId,
          });
          await saveSupabaseProduct(supabase, workshopId, created);
          productId = created.id;
        } else {
          const product = products.find((candidate) => candidate.id === pick);
          if (!product) continue;
          saldoAtual = product.onHand ?? 0;
        }

        await recordMovement(supabase, workshopId, saldoAtual, {
          productId,
          kind: "entrada",
          quantity: entry.quantity,
          occurredOn: entry.date,
          unitCost: entry.unitAmount > 0 ? entry.unitAmount : null,
          transactionId: transactionId ?? null,
          notes: "Compra lançada na despesa",
        });

        appliedKeys.push(item.uiKey);
      }

      await onApplied(appliedKeys);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível lançar no estoque.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-entry-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="stock-entry-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              Lançar no estoque
            </h2>
            <p className="mt-1 text-sm text-muted">
              Diga a qual produto cada item desta nota pertence. O saldo sobe
              pela quantidade comprada.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!saving) onClose();
            }}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={16} weight="light" aria-hidden />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted">Lendo o estoque…</p>
          ) : pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Todos os itens desta nota já foram lançados no estoque.
            </p>
          ) : (
            pending.map((item) => {
              const quantity = toNumber(item.quantity) || 1;
              const volume = toNumber(item.volumeMl);
              const pick = choice[item.uiKey];
              const product = products.find((candidate) => candidate.id === pick);

              return (
                <div key={item.uiKey} className="border-t border-border pt-4 first:border-0 first:pt-0">
                  <p className="text-sm font-semibold text-foreground">
                    {quantity > 1 ? `${quantity}× ` : ""}
                    {item.description || "Item sem nome"}
                    {volume > 0 ? (
                      <span className="font-normal text-muted"> · {volume} ml cada</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatCurrency(toNumber(item.unitAmount))} a unidade
                  </p>
                  <div className="mt-2">
                    <Dropdown
                      label="Produto no estoque"
                      value={pick ?? ""}
                      options={options}
                      onChange={(value) =>
                        setChoice((prev) => ({ ...prev, [item.uiKey]: value }))
                      }
                      compact
                    />
                  </div>
                  {product && quantity > 0 && (
                    <p className="mt-1.5 text-xs font-medium text-success">
                      Entram {quantity}{" "}
                      {quantity === 1 ? "unidade" : "unidades"} em {product.name}
                      , que fica com {(product.onHand ?? 0) + quantity}.
                    </p>
                  )}
                  {pick === CREATE && (
                    <p className="mt-1.5 text-xs font-medium text-premium">
                      Cria &ldquo;{item.description}&rdquo; no cadastro com{" "}
                      {quantity} {quantity === 1 ? "unidade" : "unidades"}.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={() => void handleApply()}
            loading={saving}
            disabled={loading || resolved.length === 0}
            className="w-full sm:w-auto"
          >
            {resolved.length > 1
              ? `Lançar ${resolved.length} itens`
              : "Lançar no estoque"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
