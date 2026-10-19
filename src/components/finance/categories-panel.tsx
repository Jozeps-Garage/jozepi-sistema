"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FinancialCategory, TransactionType } from "@/lib/finance/types";

function CategoryGroup({
  title,
  items,
  editingId,
  editName,
  saving,
  onEditNameChange,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggle,
}: {
  title: string;
  items: FinancialCategory[];
  editingId: string | null;
  editName: string;
  saving: boolean;
  onEditNameChange: (value: string) => void;
  onStartRename: (category: FinancialCategory) => void;
  onSaveRename: (category: FinancialCategory) => void;
  onCancelRename: () => void;
  onToggle: (category: FinancialCategory) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Nenhuma categoria.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((category) => (
            <li key={category.id} className="flex items-center gap-3 px-4 py-3">
              {editingId === category.id ? (
                <Input
                  id={`categoria-${category.id}`}
                  label="Nome"
                  value={editName}
                  onChange={(event) => onEditNameChange(event.target.value)}
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
                      onClick={() => onSaveRename(category)}
                      loading={saving}
                    >
                      Salvar
                    </Button>
                    <Button type="button" variant="secondary" onClick={onCancelRename}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onStartRename(category)}
                    >
                      Renomear
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onToggle(category)}
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
    </section>
  );
}

export function CategoriesPanel({
  categories,
  onSave,
}: {
  categories: FinancialCategory[];
  onSave: (input: {
    id?: string;
    name: string;
    type: TransactionType;
    active: boolean;
  }) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const revenues = categories.filter((category) => category.type === "receita");
  const expenses = categories.filter((category) => category.type === "despesa");

  async function handleRename(category: FinancialCategory) {
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: category.id,
        name: editName,
        type: category.type,
        active: category.active,
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível renomear.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(category: FinancialCategory) {
    setSaving(true);
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
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-title">Categorias</h2>
        <p className="mt-1 text-sm text-muted">
          Para criar, use o &ldquo;Nova categoria&rdquo; no seletor da própria
          receita ou despesa. Aqui você renomeia e desativa — desativar esconde
          do seletor, sem apagar o histórico.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryGroup
          title="Receitas"
          items={revenues}
          editingId={editingId}
          editName={editName}
          saving={saving}
          onEditNameChange={setEditName}
          onStartRename={(category) => {
            setEditingId(category.id);
            setEditName(category.name);
          }}
          onSaveRename={(category) => void handleRename(category)}
          onCancelRename={() => setEditingId(null)}
          onToggle={(category) => void handleToggle(category)}
        />
        <CategoryGroup
          title="Despesas"
          items={expenses}
          editingId={editingId}
          editName={editName}
          saving={saving}
          onEditNameChange={setEditName}
          onStartRename={(category) => {
            setEditingId(category.id);
            setEditName(category.name);
          }}
          onSaveRename={(category) => void handleRename(category)}
          onCancelRename={() => setEditingId(null)}
          onToggle={(category) => void handleToggle(category)}
        />
      </div>
    </div>
  );
}
