"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import type { FinancialCategory, TransactionType } from "@/lib/finance/types";

const ICON_WEIGHT = "light" as const;

/**
 * Renomear e desativar as categorias de um tipo só. Abre pelo rodapé do
 * próprio seletor, então o tipo já está decidido pela página — em Receitas
 * só aparecem as de receita. Criar é pelo "Nova categoria" lá no topo.
 */
export function CategoryManagerDialog({
  open,
  type,
  categories,
  onSave,
  onClose,
}: {
  open: boolean;
  type: TransactionType;
  categories: FinancialCategory[];
  onSave: (input: {
    id?: string;
    name: string;
    type: TransactionType;
    active: boolean;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  if (!open || typeof document === "undefined") return null;

  const items = categories.filter((category) => category.type === type);
  const busy = savingId !== null;

  function close() {
    if (busy) return;
    setEditingId(null);
    setError(null);
    onClose();
  }

  async function handleRename(category: FinancialCategory) {
    const name = editName.trim();
    if (!name) {
      setError("Informe o nome da categoria.");
      return;
    }
    setSavingId(category.id);
    setError(null);
    try {
      await onSave({ id: category.id, name, type: category.type, active: category.active });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível renomear.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleToggle(category: FinancialCategory) {
    setSavingId(category.id);
    setError(null);
    try {
      await onSave({
        id: category.id,
        name: category.name,
        type: category.type,
        active: !category.active,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar.");
    } finally {
      setSavingId(null);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-manager-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="category-manager-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              Categorias de {type === "receita" ? "receita" : "despesa"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Desativar esconde do seletor, sem apagar o histórico.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={16} weight={ICON_WEIGHT} aria-hidden />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Nenhuma categoria ainda. Use o &ldquo;Nova categoria&rdquo; no seletor.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((category) => (
                <li key={category.id} className="flex items-center gap-3 px-4 py-3">
                  {editingId === category.id ? (
                    <Input
                      id={`categoria-${category.id}`}
                      label="Nome"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleRename(category);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      compact
                    />
                  ) : (
                    <p
                      className={`min-w-0 flex-1 text-sm font-semibold ${
                        category.active ? "text-foreground" : "text-muted line-through"
                      }`}
                    >
                      {category.name}
                    </p>
                  )}
                  <div className="flex shrink-0 gap-2">
                    {editingId === category.id ? (
                      <>
                        <Button
                          type="button"
                          variant="success"
                          onClick={() => void handleRename(category)}
                          loading={savingId === category.id}
                          className="min-h-9 px-3 text-sm"
                        >
                          Salvar
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditingId(null)}
                          className="min-h-9 px-3 text-sm"
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(category.id);
                            setEditName(category.name);
                            setError(null);
                          }}
                          className="min-h-9 px-3 text-sm"
                        >
                          Renomear
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void handleToggle(category)}
                          loading={savingId === category.id}
                          className="min-h-9 px-3 text-sm"
                        >
                          {category.active ? "Desativar" : "Ativar"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Fechar
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
