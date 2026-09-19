"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MoneyField } from "@/components/mobile/sheets/fields";
import { defaultAccountId, loadFinancialAccounts } from "@/lib/finance/accounts";
import {
  categoriesOfType,
  loadFinancialCategories,
} from "@/lib/finance/categories";
import {
  createTransaction,
  type TransactionType,
} from "@/lib/finance/transactions";
import type { FinancialAccount, FinancialCategory } from "@/lib/finance/types";
import { parseCurrencyInput } from "@/lib/utils/money";

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

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = categoriesOfType(categories, type).map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const accountOptions = accounts
    .filter((account) => account.active)
    .map((account) => ({ value: account.id, label: account.name }));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setDescription("");
    setAmount("");
    setDate(todayKey());
    setError(null);
    setLoadingOptions(true);

    void (async () => {
      try {
        const [loadedAccounts, loadedCategories] = await Promise.all([
          loadFinancialAccounts(supabase, workshopId),
          loadFinancialCategories(supabase, workshopId),
        ]);
        if (cancelled) return;
        setAccounts(loadedAccounts);
        setCategories(loadedCategories);
        setAccountId(defaultAccountId(loadedAccounts));
        setCategoryId(categoriesOfType(loadedCategories, type)[0]?.id ?? "");
      } catch (err) {
        if (cancelled) return;
        setAccounts([]);
        setCategories([]);
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar contas e categorias."
        );
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, supabase, workshopId, type]);

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!description.trim()) {
      setError("Informe uma descrição.");
      return;
    }
    if (!accountId) {
      setError("Selecione a conta do lançamento.");
      return;
    }
    if (!categoryId) {
      setError("Selecione a categoria.");
      return;
    }

    let value: number;
    try {
      value = parseCurrencyInput(amount, { min: 0.01 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Valor inválido.");
      return;
    }

    const categoryName =
      categoryOptions.find((option) => option.value === categoryId)?.label ?? "Outros";

    setSaving(true);
    setError(null);
    try {
      await createTransaction(supabase, workshopId, {
        type,
        description,
        amount: value,
        category: categoryName,
        categoryId,
        accountId,
        date,
        effectiveDate: date,
        paymentStatus: "pago",
      });
      onDone(
        "success",
        isExpense ? "Despesa lançada!" : "Receita lançada!"
      );
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
          label="Conta"
          value={accountId}
          onChange={setAccountId}
          options={accountOptions}
          placeholder={loadingOptions ? "Carregando..." : "Selecione a conta"}
        />
        <Dropdown
          label="Categoria"
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions}
          placeholder={loadingOptions ? "Carregando..." : "Selecione a categoria"}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full">
          {isExpense ? "Lançar despesa" : "Lançar receita"}
        </Button>
      </form>
    </BottomSheet>
  );
}
