"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";

export function ConfirmPaidDialog({
  open,
  defaultDate,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  defaultDate: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (effectiveDate: string) => void;
}) {
  const [date, setDate] = useState(defaultDate);

  useEffect(() => {
    if (open) setDate(defaultDate);
  }, [open, defaultDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 py-6 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-paid-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!date) return;
          onConfirm(date);
        }}
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-card-hover"
      >
        <h2 id="confirm-paid-title" className="text-base font-semibold text-foreground">
          Confirmar pagamento
        </h2>
        <p className="mt-1 text-sm text-muted">
          Informe a data em que o valor efetivamente entrou ou saiu da conta.
        </p>
        <div className="mt-4">
          <Input
            label="Data de efetivação"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="success" loading={loading}>
            Marcar como pago
          </Button>
        </div>
      </form>
    </div>
  );
}

export function TransferDialog({
  open,
  accounts,
  loading,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  accounts: { id: string; name: string }[];
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    date: string;
    description: string;
  }) => void;
}) {
  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setFromAccountId(accounts[0]?.id ?? "");
    setToAccountId(accounts[1]?.id ?? accounts[0]?.id ?? "");
    setAmount("");
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    setDate(`${now.getFullYear()}-${month}-${day}`);
    setDescription("");
  }, [open, accounts]);

  if (!open) return null;

  const options = accounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 py-6 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ fromAccountId, toAccountId, amount, date, description });
        }}
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-card-hover"
      >
        <h2 id="transfer-title" className="text-base font-semibold text-foreground">
          Transferir entre contas
        </h2>
        <p className="mt-1 text-sm text-muted">
          Só movimenta saldo entre contas próprias — não entra como receita nem despesa.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <Dropdown
            label="Origem"
            value={fromAccountId}
            options={options}
            onChange={setFromAccountId}
          />
          <Dropdown
            label="Destino"
            value={toAccountId}
            options={options}
            onChange={setToAccountId}
          />
          <Input
            label="Valor"
            prefix="R$"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Input
            label="Data"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            label="Descrição (opcional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: Sangria do caixa"
          />
        </div>
        {error && (
          <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="success" loading={loading}>
            Transferir
          </Button>
        </div>
      </form>
    </div>
  );
}
