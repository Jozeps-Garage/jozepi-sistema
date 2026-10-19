"use client";

import { useState } from "react";
import { ArrowLeft, PencilSimple, Plus, Star } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import {
  FINANCIAL_ACCOUNT_TYPE_LABEL,
  type FinancialAccount,
  type FinancialAccountType,
} from "@/lib/finance/types";
import { formatCurrency } from "@/lib/utils/format";
import { formatMoneyInput } from "@/lib/utils/money";

type PeriodFilter = "all" | "today" | "week" | "month" | "custom";

const PERIOD_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
  { value: "custom", label: "Personalizado" },
];

const ACCOUNT_TYPE_OPTIONS = (
  Object.entries(FINANCIAL_ACCOUNT_TYPE_LABEL) as [FinancialAccountType, string][]
).map(([value, label]) => ({ value, label }));

const ICON_WEIGHT = "light" as const;

export interface AccountStatementLine {
  id: string;
  date: string;
  description: string;
  amount: number;
  kind: "receita" | "despesa" | "transfer_in" | "transfer_out";
  overdue?: boolean;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inPeriod(date: string, period: PeriodFilter, customStart: string, customEnd: string) {
  if (period === "all") return true;
  const today = dateKey(new Date());
  if (period === "today") return date === today;
  if (period === "custom") {
    return (!customStart || date >= customStart) && (!customEnd || date <= customEnd);
  }
  const now = new Date();
  if (period === "month") {
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return date.startsWith(prefix);
  }
  const start = new Date(now);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return date >= dateKey(start) && date <= dateKey(end);
}

/**
 * As contas e o extrato de cada uma. Mora no topo da página de Caixa: é a
 * composição do saldo de onde a projeção logo abaixo parte. `selectedId` fica
 * com o pai porque, ao abrir o extrato de uma conta, a projeção sai da tela.
 */
export function AccountsPanel({
  accounts,
  balances,
  statementLines,
  selectedId,
  onSelectAccount,
  onSaveAccount,
  onSetDefault,
  onToggleActive,
  onOpenTransfer,
}: {
  accounts: FinancialAccount[];
  balances: Record<string, number>;
  statementLines: (accountId: string) => AccountStatementLine[];
  selectedId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  onSaveAccount: (input: {
    id?: string;
    name: string;
    type: FinancialAccountType;
    initialBalance: string;
  }) => Promise<void>;
  onSetDefault: (accountId: string) => Promise<void>;
  onToggleActive: (account: FinancialAccount) => Promise<void>;
  onOpenTransfer: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  /** Preenchido: editando essa conta. Vazio: cadastrando uma nova. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<FinancialAccountType>("dinheiro");
  const [initialBalance, setInitialBalance] = useState("0,00");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodFilter>("month");
  const [customStart, setCustomStart] = useState(dateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customEnd, setCustomEnd] = useState(dateKey(new Date()));

  const activeTotal = accounts
    .filter((account) => account.active)
    .reduce((sum, account) => sum + (balances[account.id] ?? 0), 0);

  const selected = accounts.find((account) => account.id === selectedId) ?? null;
  const lines = selected
    ? statementLines(selected.id).filter((line) =>
        inPeriod(line.date, period, customStart, customEnd)
      )
    : [];

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormError(null);
  }

  function startCreating() {
    setEditingId(null);
    setName("");
    setType("dinheiro");
    setInitialBalance("0,00");
    setFormError(null);
    setShowForm(true);
  }

  function startEditing(account: FinancialAccount) {
    setEditingId(account.id);
    setName(account.name);
    setType(account.type);
    setInitialBalance(formatMoneyInput(account.initial_balance));
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setFormError("Informe o nome da conta.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSaveAccount({
        id: editingId ?? undefined,
        name,
        type,
        initialBalance,
      });
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erro ao salvar conta.");
    } finally {
      setSaving(false);
    }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => onSelectAccount(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={16} weight={ICON_WEIGHT} aria-hidden />
          Todas as contas
        </button>
        <div className="rounded-lg border border-border bg-card p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-caps text-muted">{selected.name}</p>
              <p className="mt-1 currency-display text-foreground">
                {formatCurrency(balances[selected.id] ?? 0)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {FINANCIAL_ACCOUNT_TYPE_LABEL[selected.type]}
                {selected.is_default ? " · Conta padrão" : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onSelectAccount(null);
                startEditing(selected);
              }}
              className="shrink-0"
            >
              <PencilSimple size={16} weight={ICON_WEIGHT} aria-hidden />
              Editar
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Dropdown
            label="Período"
            value={period}
            options={PERIOD_OPTIONS}
            onChange={(value) => setPeriod(value as PeriodFilter)}
            className="min-w-[11rem]"
          />
          {period === "custom" && (
            <>
              <Input
                label="De"
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
              />
              <Input
                label="Até"
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
              />
            </>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {lines.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              Nenhum movimento neste período.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 ${
                    line.overdue ? "bg-danger/5" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {line.description}
                      {line.overdue ? (
                        <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                          Vencido
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">
                      {line.date.slice(8, 10)}/{line.date.slice(5, 7)}/{line.date.slice(0, 4)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-bold tabular-nums ${
                      line.amount >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {line.amount >= 0 ? "+" : ""}
                    {formatCurrency(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="section-title">Caixa</h2>
          <p className="mt-1 text-sm text-muted">
            Saldo das contas, extrato e projeção do que está por vir.
            Transferências não entram no DRE.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" onClick={onOpenTransfer}>
            Transferir
          </Button>
          <Button type="button" variant="success" onClick={startCreating}>
            <Plus size={16} weight={ICON_WEIGHT} aria-hidden />
            Nova conta
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-card">
        <p className="label-caps text-muted">Saldo total</p>
        <p className="mt-1 currency-display text-foreground">{formatCurrency(activeTotal)}</p>
        <p className="mt-1 text-xs text-muted">Soma das contas ativas</p>
      </div>

      {showForm && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="finance-manual-form-enter rounded-lg border border-border bg-card p-4 shadow-card sm:p-5"
        >
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            {editingId ? "Editar conta" : "Nova conta"}
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input
              label="Nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: InfinitePay"
            />
            <Dropdown
              label="Tipo"
              value={type}
              options={ACCOUNT_TYPE_OPTIONS}
              onChange={(value) => setType(value as FinancialAccountType)}
            />
            <Input
              label="Saldo inicial"
              prefix="R$"
              value={initialBalance}
              onChange={(event) => setInitialBalance(event.target.value)}
            />
          </div>
          {editingId && (
            <p className="mt-3 text-xs text-muted">
              Mexer no saldo inicial recalcula o saldo atual desta conta.
            </p>
          )}
          {formError && <p className="mt-3 text-sm text-danger">{formError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeForm}>
              Cancelar
            </Button>
            <Button type="submit" variant="success" loading={saving}>
              {editingId ? "Salvar alterações" : "Salvar conta"}
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {accounts.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Nenhuma conta cadastrada. Aplique a migration 030_financial_accounts.sql.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {accounts.map((account) => (
              // Estreito: o nome ocupa a linha inteira e saldo e ações descem
              // para a segunda. Largo: tudo na mesma linha.
              <li
                key={account.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <button
                  type="button"
                  onClick={() => onSelectAccount(account.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-foreground">
                    {account.name}
                    {account.is_default ? (
                      <span className="ml-2 rounded-full bg-premium/15 px-2 py-0.5 text-[10px] font-bold text-premium">
                        Padrão
                      </span>
                    ) : null}
                    {!account.active ? (
                      <span className="ml-2 text-[10px] font-semibold text-muted">Inativa</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    {FINANCIAL_ACCOUNT_TYPE_LABEL[account.type]}
                  </p>
                </button>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <p className="text-sm font-bold tabular-nums text-foreground">
                    {formatCurrency(balances[account.id] ?? 0)}
                  </p>
                  <div className="flex items-center gap-1">
                    {!account.is_default && account.active && (
                      <button
                        type="button"
                        onClick={() => void onSetDefault(account.id)}
                        className="rounded-lg p-2 text-muted transition-colors hover:bg-background hover:text-premium"
                        title="Definir como conta padrão"
                        aria-label={`Definir ${account.name} como conta padrão`}
                      >
                        <Star size={16} weight={ICON_WEIGHT} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEditing(account)}
                      className="rounded-lg p-2 text-muted transition-colors hover:bg-background hover:text-foreground"
                      title={`Editar ${account.name}`}
                      aria-label={`Editar ${account.name}`}
                    >
                      <PencilSimple size={16} weight={ICON_WEIGHT} />
                    </button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onToggleActive(account)}
                      className="min-h-9 px-3 text-sm"
                    >
                      {account.active ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
