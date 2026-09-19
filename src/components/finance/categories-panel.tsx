"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
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
  const [name, setName] = useState("");
  const [type, setType] = useState<TransactionType>("despesa");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const revenues = categories.filter((category) => category.type === "receita");
  const expenses = categories.filter((category) => category.type === "despesa");

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Informe o nome da categoria.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name, type, active: true });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setSaving(false);
    }
  }

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
        <h2 className="text-lg font-semibold text-foreground">Categorias</h2>
        <p className="mt-1 text-sm text-muted">
          Usadas nos lançamentos de receita e despesa. Desativar esconde do seletor, sem apagar o histórico.
        </p>
      </div>

      <form
        onSubmit={(event) => void handleCreate(event)}
        className="rounded-lg border border-border bg-card p-4 shadow-card sm:p-5"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end">
          <Input
            label="Nova categoria"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Produtos químicos"
          />
          <Dropdown
            label="Tipo"
            value={type}
            options={[
              { value: "receita", label: "Receita" },
              { value: "despesa", label: "Despesa" },
            ]}
            onChange={(value) => setType(value as TransactionType)}
          />
          <Button type="submit" variant="success" loading={saving} className="md:mb-0.5">
            <Plus size={16} weight="light" aria-hidden />
            Criar
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </form>

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
