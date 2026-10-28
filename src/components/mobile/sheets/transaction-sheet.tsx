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
import type {
  FinancialAccount,
  FinancialCategory,
  PaymentStatus,
} from "@/lib/finance/types";
import {
  SUPPLIER_SELECT_FIELDS,
  SUPPLIER_SELECT_LEGACY,
  isMissingSupplierColumn,
} from "@/lib/suppliers/save";
import { parseCurrencyInput } from "@/lib/utils/money";

interface SupplierOption {
  id: string;
  name: string;
  trade_name?: string | null;
}

const SEM_FORNECEDOR = "";

/** Nome de fachada manda quando existe: é por ele que a nota é reconhecida. */
function supplierLabel(supplier: SupplierOption) {
  return supplier.trade_name?.trim() || supplier.name;
}

async function loadSuppliers(
  supabase: SupabaseClient,
  workshopId: string
): Promise<SupplierOption[]> {
  let { data, error } = (await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT_FIELDS)
    .eq("workshop_id", workshopId)) as {
    data: unknown;
    error: { message?: string } | null;
  };
  // Sem a 043 as colunas novas não existem; repete sem elas.
  if (error && isMissingSupplierColumn(error)) {
    ({ data, error } = (await supabase
      .from("suppliers")
      .select(SUPPLIER_SELECT_LEGACY)
      .eq("workshop_id", workshopId)) as {
      data: unknown;
      error: { message?: string } | null;
    });
  }
  if (error) return [];
  return ((data as SupplierOption[] | null) ?? []).sort((a, b) =>
    supplierLabel(a).localeCompare(supplierLabel(b), "pt-BR")
  );
}

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
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("pago");
  /** Pago: quando o dinheiro se moveu. Pendente: quando vence. */
  const [settleDate, setSettleDate] = useState(todayKey());
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState(SEM_FORNECEDOR);
  const [notes, setNotes] = useState("");
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
    setPaymentStatus("pago");
    setSettleDate(todayKey());
    setSupplierId(SEM_FORNECEDOR);
    setNotes("");
    setError(null);
    setLoadingOptions(true);

    void (async () => {
      try {
        const [loadedAccounts, loadedCategories, loadedSuppliers] =
          await Promise.all([
            loadFinancialAccounts(supabase, workshopId),
            loadFinancialCategories(supabase, workshopId),
            // Fornecedor é conveniência: se a consulta falhar, o lançamento
            // segue sem ele em vez de travar o formulário inteiro.
            loadSuppliers(supabase, workshopId),
          ]);
        if (cancelled) return;
        setAccounts(loadedAccounts);
        setCategories(loadedCategories);
        setSuppliers(loadedSuppliers);
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
      value = parseCurrencyInput(amount, { min: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Valor inválido.");
      return;
    }

    const categoryName =
      categoryOptions.find((option) => option.value === categoryId)?.label ?? "Outros";

    setSaving(true);
    setError(null);
    try {
      const pago = paymentStatus === "pago";
      await createTransaction(supabase, workshopId, {
        type,
        description,
        amount: value,
        category: categoryName,
        categoryId,
        accountId,
        date,
        // Pago: a data em que o dinheiro se moveu. Pendente: o vencimento,
        // e nenhuma data de pagamento — senão o caixa conta o que não entrou.
        effectiveDate: pago ? settleDate || date : null,
        dueDate: pago ? null : settleDate || date,
        paymentStatus,
        supplierId: isExpense ? supplierId || null : null,
        notes,
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
        <div className="grid grid-cols-2 gap-3">
          <Dropdown
            label="Status"
            value={paymentStatus}
            onChange={(value) => setPaymentStatus(value as PaymentStatus)}
            options={
              isExpense
                ? [
                    { value: "pago", label: "Pago" },
                    { value: "pendente", label: "A pagar" },
                  ]
                : [
                    { value: "pago", label: "Recebido" },
                    { value: "pendente", label: "A receber" },
                  ]
            }
          />
          <Input
            label={paymentStatus === "pago" ? "Pago em" : "Vencimento"}
            type="date"
            value={settleDate}
            onChange={(event) => setSettleDate(event.target.value)}
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
        {isExpense && suppliers.length > 0 && (
          <Dropdown
            label="Fornecedor (opcional)"
            value={supplierId}
            onChange={setSupplierId}
            options={[
              { value: SEM_FORNECEDOR, label: "Sem fornecedor" },
              ...suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplierLabel(supplier),
              })),
            ]}
          />
        )}
        <Input
          label="Observação (opcional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={isExpense ? "Ex.: nota 1259" : "Ex.: pago em dinheiro"}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full">
          {isExpense ? "Lançar despesa" : "Lançar receita"}
        </Button>
      </form>
    </BottomSheet>
  );
}
