"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import {
  formatOnHand,
  pluralize,
  tracksStock,
  type StockItem,
} from "@/lib/products/stock";
import { loadStockItems, recordMovement } from "@/lib/products/stock-repo";

/**
 * Revisão de estoque: você conta a prateleira e diz o que achou.
 *
 * Cada diferença vira um movimento de revisão, que afirma o saldo em vez de
 * somar ou subtrair. Quem está igual não gera movimento nenhum — senão o
 * histórico encheria de linhas que não contam nada.
 */
export function StockReviewDialog({
  open,
  supabase,
  workshopId,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  supabase: SupabaseClient;
  workshopId: string | null;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  const load = useCallback(async () => {
    if (!workshopId) {
      await Promise.resolve();
      setError("Oficina não encontrada.");
      setLoading(false);
      return;
    }
    try {
      const loaded = (await loadStockItems(supabase, workshopId)).filter((item) =>
        tracksStock(item.kind)
      );
      setItems(loaded);
      setCounted({});
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ler o estoque.");
      setLoading(false);
    }
  }, [supabase, workshopId]);

  useEffect(() => {
    if (open) void Promise.resolve().then(load);
  }, [open, load]);

  if (!open || typeof document === "undefined") return null;

  const term = search.trim().toLowerCase();
  const visible = term
    ? items.filter((item) => item.name.toLowerCase().includes(term))
    : items;

  // Só o que você digitou e ficou diferente do saldo atual.
  const changes = items
    .map((item) => {
      const raw = counted[item.id];
      if (raw === undefined || raw.trim() === "") return null;
      const value = Number(raw.replace(",", "."));
      if (!Number.isFinite(value) || value < 0) return null;
      if (value === item.onHand) return null;
      return { item, value };
    })
    .filter((row): row is { item: StockItem; value: number } => row !== null);

  async function handleSave() {
    if (saving || !workshopId || changes.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const { item, value } of changes) {
        await recordMovement(supabase, workshopId, item.onHand, {
          productId: item.id,
          kind: "revisao",
          quantity: value,
          occurredOn: today,
          notes: "Revisão de estoque",
        });
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a revisão.");
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
        aria-labelledby="stock-review-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="stock-review-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              Revisão de estoque
            </h2>
            <p className="mt-1 text-sm text-muted">
              Conte a prateleira e escreva o que achou. Quem ficar em branco
              não muda.
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

        <div className="relative mt-4 shrink-0">
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
            className="w-full rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Lendo o estoque…</p>
          ) : visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {items.length === 0
                ? "Nenhum item de estoque cadastrado."
                : "Nenhum produto com esse nome."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((item) => {
                const raw = counted[item.id] ?? "";
                const value = raw.trim() === "" ? null : Number(raw.replace(",", "."));
                const changed =
                  value !== null && Number.isFinite(value) && value !== item.onHand;
                const unit =
                  item.unitLabel.trim() || (item.kind === "liquido" ? "frasco" : "unidade");

                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {item.name}
                      </p>
                      <p className="text-xs text-muted">
                        Sistema diz: {formatOnHand(item)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        id={`contagem-${item.id}`}
                        inputMode="decimal"
                        value={raw}
                        onChange={(event) =>
                          setCounted((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        placeholder={String(item.onHand)}
                        aria-label={`Quantas ${pluralize(unit)} de ${item.name}`}
                        className={`w-20 rounded-md border bg-input px-3 py-2 text-right text-sm text-foreground outline-none focus:ring-2 focus:ring-accent/20 ${
                          changed ? "border-success" : "border-border"
                        }`}
                      />
                      <span className="w-16 text-xs text-muted">{pluralize(unit)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            {changes.length === 0
              ? "Nada diferente ainda."
              : changes.length === 1
                ? "1 produto com saldo diferente."
                : `${changes.length} produtos com saldo diferente.`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
              onClick={() => void handleSave()}
              loading={saving}
              disabled={loading || changes.length === 0}
              className="w-full sm:w-auto"
            >
              Salvar revisão
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
