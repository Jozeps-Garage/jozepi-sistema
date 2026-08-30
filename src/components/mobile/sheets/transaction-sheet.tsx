"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MoneyField } from "@/components/mobile/sheets/fields";
import { createTransaction, type TransactionType } from "@/lib/finance/transactions";
import { parseCurrencyInput } from "@/lib/utils/money";

const EXPENSE_CATEGORIES = [
  { value: "Produtos", label: "Produtos" },
  { value: "Equipamentos", label: "Equipamentos" },
  { value: "Aluguel", label: "Aluguel" },
  { value: "Marketing", label: "Marketing" },
  { value: "Outros", label: "Outros" },
];

const REVENUE_CATEGORIES = [
  { value: "Serviço", label: "Serviço" },
  { value: "Gorjeta", label: "Gorjeta" },
  { value: "Outros", label: "Outros" },
];

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

interface TransactionSheetProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  workshopId: string;
  type: TransactionType;
  onDone: (tone: "success" | "error", message: string) => void;
}

export function TransactionSheet({
  open,
  onClose,
  supabase,
  workshopId,
  type,
  onDone,
}: TransactionSheetProps) {
  const isExpense = type === "despesa";
  const categories = isExpense ? EXPENSE_CATEGORIES : REVENUE_CATEGORIES;

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0].value);
  const [date, setDate] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDescription("");
    setAmount("");
    setCategory(categories[0].value);
    setDate(todayKey());
    setError(null);
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!description.trim()) {
      setError("Informe uma descrição.");
      return;
    }

    let value: number;
    try {
      value = parseCurrencyInput(amount, { min: 0.01 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Valor inválido.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createTransaction(supabase, workshopId, {
        type,
        description,
        amount: value,
        category,
        date,
      });
      onDone(
        "success",
        isExpense ? "Despesa lançada!" : "Receita lançada!"
      );
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
      onDone("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={isExpense ? "Nova despesa" : "Nova receita"}
      description={
        isExpense ? "Lance um gasto rapidamente" : "Registre uma entrada avulsa"
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Descrição"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={isExpense ? "Ex.: Shampoo automotivo" : "Ex.: Gorjeta"}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Valor" value={amount} onChange={setAmount} />
          <Input
            label="Data"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <Dropdown
          label="Categoria"
          value={category}
          onChange={setCategory}
          options={categories}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full">
          {isExpense ? "Lançar despesa" : "Lançar receita"}
        </Button>
      </form>
    </BottomSheet>
  );
}
