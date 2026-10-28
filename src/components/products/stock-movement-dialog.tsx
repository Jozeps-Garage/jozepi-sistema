"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import { formatDate } from "@/lib/utils/format";
import {
  buildStockCycles,
  formatDuration,
  formatOnHand,
  type StockCycle,
  type StockItem,
} from "@/lib/products/stock";
import { loadMovements, recordMovement } from "@/lib/products/stock-repo";

/**
 * Baixa e histórico de um produto.
 *
 * A baixa é o "acabou/quebrou/descartei" do dia a dia. O histórico embaixo
 * mostra os ciclos de vida fechados — comprei, acabou, durou tanto —, que é
 * o que responde se um produto rende ou não.
 */
export function StockMovementDialog({
  open,
  supabase,
  workshopId,
  item,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  supabase: SupabaseClient;
  workshopId: string | null;
  item: StockItem | null;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [quantity, setQuantity] = useState("1");
  const [occurredOn, setOccurredOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [cycles, setCycles] = useState<StockCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  const productId = item?.id ?? null;

  const load = useCallback(async () => {
    if (!workshopId || !productId) {
      await Promise.resolve();
      setLoading(false);
      return;
    }
    try {
      // A história inteira ainda é lida: é dela que saem os ciclos de vida.
      setCycles(buildStockCycles(await loadMovements(supabase, workshopId, productId)));
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ler o histórico.");
      setLoading(false);
    }
  }, [supabase, workshopId, productId]);

  useEffect(() => {
    if (open) void Promise.resolve().then(load);
  }, [open, load]);

  if (!open || !item || typeof document === "undefined") return null;

  async function handleBaixa() {
    if (saving || !workshopId || !item) return;
    const value = Number(quantity.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe quantas saíram.");
      return;
    }
    if (value > item.onHand) {
      setError(`Você só tem ${formatOnHand(item)} em estoque.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await recordMovement(supabase, workshopId, item.onHand, {
        productId: item.id,
        kind: "baixa",
        quantity: value,
        occurredOn,
        notes: notes.trim() || null,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível dar baixa.");
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
        aria-labelledby="stock-movement-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="stock-movement-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              {item.name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Em estoque: <strong className="text-foreground">{formatOnHand(item)}</strong>
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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[6rem_11rem_minmax(0,1fr)]">
          <Input
            label="Saíram"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            compact
          />
          <Input
            label="Quando"
            type="date"
            value={occurredOn}
            onChange={(event) => setOccurredOn(event.target.value)}
            compact
          />
          <Input
            label="Motivo (opcional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Acabou, quebrou, descartei"
            compact
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="success"
            onClick={() => void handleBaixa()}
            loading={saving}
            disabled={item.onHand <= 0}
            className="w-full sm:w-auto"
          >
            Dar baixa
          </Button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Durabilidade</h3>
          {loading ? (
            <p className="mt-3 text-sm text-muted">Lendo o histórico…</p>
          ) : cycles.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Ainda não há ciclo fechado. Quando este produto zerar, aparece
              aqui quanto tempo durou.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {cycles.map((cycle) => (
                <li
                  key={`${cycle.startedOn}-${cycle.endedOn ?? "aberto"}`}
                  className="rounded-lg border border-border bg-background px-3 py-2"
                >
                  <p className="text-sm font-semibold text-foreground">
                    {cycle.endedOn
                      ? `Durou ${formatDuration(cycle.days ?? 0)}`
                      : "Em uso agora"}
                  </p>
                  <p className="text-xs text-muted">
                    Entrou {formatDate(cycle.startedOn)}
                    {cycle.endedOn ? ` · acabou ${formatDate(cycle.endedOn)}` : ""}
                    {cycle.purchased > 0
                      ? ` · ${cycle.purchased} ${cycle.purchased === 1 ? "unidade" : "unidades"}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
