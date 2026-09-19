"use client";

import { useMemo, useState } from "react";
import { ChartLineUp, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { dueRelativeLabel, isOpenPaymentStatus } from "@/lib/finance/due";
import {
  balanceSeries,
  futureOpenItems,
  paidMovementsFromLedger,
  projectedBalance,
  type ProjectionHorizon,
  type ProjectionOpenItem,
} from "@/lib/finance/projection";
import type {
  FinancialAccount,
  FinancialTransfer,
  PaymentStatus,
  TransactionType,
} from "@/lib/finance/types";
import { formatCurrency } from "@/lib/utils/format";

const HORIZON_OPTIONS: { value: ProjectionHorizon; label: string }[] = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

const REALIZED_COLOR = "#1a2744";
const PROJECTED_COLOR = "#c9a84c";

type LedgerEntry = {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  date: string;
  effectiveDate?: string | null;
  dueDate?: string | null;
  accountId?: string;
  paymentStatus?: PaymentStatus;
  clientName?: string;
  serviceName?: string;
};

function formatAxisDate(date: string, horizon: ProjectionHorizon) {
  const [, month, day] = date.split("-");
  if (horizon === 90) return `${day}/${month}`;
  return `${day}/${month}`;
}

function BalanceEvolutionChart({
  points,
  horizon,
}: {
  points: { date: string; balance: number; kind: "realized" | "projected" }[];
  horizon: ProjectionHorizon;
}) {
  const realized = points.filter((point) => point.kind === "realized");
  const projected = points.filter((point) => point.kind === "projected");
  const values = points.map((point) => point.balance);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padValue = Math.max((maxVal - minVal) * 0.1, 1);
  const min = minVal - padValue;
  const max = maxVal + padValue;
  const span = Math.max(max - min, 1);
  const width = 400;
  const height = 100;
  const padX = 8;
  const padY = 10;

  function xFor(index: number, total: number) {
    if (total <= 1) return width / 2;
    return padX + (index / (total - 1)) * (width - padX * 2);
  }

  function yFor(value: number) {
    return padY + (1 - (value - min) / span) * (height - padY * 2);
  }

  const allDates = [
    ...realized.map((point) => point.date),
    ...projected.slice(1).map((point) => point.date),
  ];
  const total = allDates.length || 1;
  const todayIndex = Math.max(realized.length - 1, 0);

  const realizedCoords = realized.map((point, index) => ({
    x: xFor(index, total),
    y: yFor(point.balance),
  }));
  const lastRealized = realizedCoords[realizedCoords.length - 1];
  const projectedCoords = [
    ...(lastRealized ? [lastRealized] : []),
    ...projected.map((point, index) => ({
      x: xFor(todayIndex + index, total),
      y: yFor(point.balance),
    })),
  ];

  const zeroY = yFor(0);
  const showZero = 0 >= min && 0 <= max;
  const labelIndexes = [0, todayIndex, total - 1];
  const todayX = xFor(todayIndex, total);

  return (
    <div className="overflow-hidden rounded-lg bg-background px-3 pb-3 pt-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-56 w-full"
        role="img"
        aria-label="Evolução do saldo"
      >
        {showZero && (
          <line
            x1={padX}
            x2={width - padX}
            y1={zeroY}
            y2={zeroY}
            stroke="currentColor"
            className="text-border"
            strokeWidth="0.6"
          />
        )}
        <line
          x1={todayX}
          x2={todayX}
          y1={padY}
          y2={height - padY}
          stroke="currentColor"
          className="text-border"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
        <polyline
          points={realizedCoords.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={REALIZED_COLOR}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={projectedCoords.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={PROJECTED_COLOR}
          strokeWidth="1.6"
          strokeDasharray="5 4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {lastRealized && (
          <circle cx={lastRealized.x} cy={lastRealized.y} r="2.2" fill={REALIZED_COLOR} />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
        {labelIndexes.map((index) => (
          <span key={`${allDates[index]}-${index}`}>
            {allDates[index] ? formatAxisDate(allDates[index], horizon) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CashflowProjectionPanel({
  currentBalance,
  entries,
  accounts,
  transfers,
  today,
  onMarkPaid,
}: {
  currentBalance: number;
  entries: LedgerEntry[];
  accounts: FinancialAccount[];
  transfers: FinancialTransfer[];
  today: string;
  onMarkPaid: (item: ProjectionOpenItem) => void;
}) {
  const [horizon, setHorizon] = useState<ProjectionHorizon>(30);
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  );

  const openItems = useMemo<ProjectionOpenItem[]>(
    () =>
      entries
        .filter((entry) => isOpenPaymentStatus(entry.paymentStatus))
        .map((entry) => ({
          id: entry.id,
          description: entry.clientName
            ? `${entry.clientName}${entry.serviceName ? ` · ${entry.serviceName}` : ""}`
            : entry.description,
          amount: entry.amount,
          type: entry.type,
          dueDate: entry.dueDate || entry.date,
          accountName: entry.accountId ? accountNames.get(entry.accountId) : undefined,
          paymentStatus: entry.paymentStatus,
        })),
    [accountNames, entries]
  );

  const movements = useMemo(
    () =>
      paidMovementsFromLedger({
        transactions: entries.map((entry) => ({
          type: entry.type,
          amount: entry.amount,
          payment_status: entry.paymentStatus,
          effective_date: entry.effectiveDate,
          transaction_date: entry.date,
          account_id: entry.accountId ?? null,
        })),
        transfers,
        accounts,
      }),
    [accounts, entries, transfers]
  );

  const series = useMemo(
    () =>
      balanceSeries({
        currentBalance,
        movements,
        openItems,
        today,
        horizonDays: horizon,
      }),
    [currentBalance, horizon, movements, openItems, today]
  );

  const kpis = [7, 30, 90].map((days) => ({
    days,
    value: projectedBalance(currentBalance, openItems, today, days),
  }));
  const upcoming = futureOpenItems(openItems, today);
  const hasPartial = openItems.some((item) => item.paymentStatus === "parcial");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Fluxo de Caixa</h2>
        <p className="mt-1 text-sm text-muted">
          Projeção a partir do saldo atual das contas ativas, somando pendências por vencimento.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <article
            key={kpi.days}
            className="rounded-lg border border-dashed border-premium/40 bg-card p-5 shadow-card"
          >
            <p className="label-caps text-premium">Projetado · {kpi.days} dias</p>
            <p
              className={`mt-2 currency-display ${
                kpi.value >= 0 ? "text-foreground" : "text-danger"
              }`}
            >
              {formatCurrency(kpi.value)}
            </p>
            <p className="mt-1 text-xs text-muted">
              Saldo atual {formatCurrency(currentBalance)}
            </p>
          </article>
        ))}
      </div>

      {hasPartial && (
        <p className="rounded-lg border border-border bg-background px-4 py-3 text-xs text-muted">
          Transações parciais entram na projeção pelo valor total — o sistema ainda não guarda quanto já foi pago.
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-premium/10 text-premium">
              <ChartLineUp size={20} weight="light" aria-hidden />
            </span>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Evolução do saldo</h3>
              <p className="text-sm text-muted">Realizado até hoje, projetado dali em diante</p>
            </div>
          </div>
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
            {HORIZON_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setHorizon(option.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                  horizon === option.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
                aria-pressed={horizon === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <BalanceEvolutionChart points={series} horizon={horizon} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: REALIZED_COLOR }} />
            Realizado
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, ${PROJECTED_COLOR} 0 6px, transparent 6px 10px)`,
              }}
            />
            Projetado
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <h3 className="text-lg font-semibold text-foreground">Movimentações futuras</h3>
        <p className="mt-1 text-sm text-muted">
          Receitas e despesas em aberto com vencimento a partir de hoje, incluindo parcelas.
        </p>
        {upcoming.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted">
            Nenhuma pendência com vencimento futuro.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {upcoming.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{item.description}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        item.type === "receita"
                          ? "bg-success/10 text-success"
                          : "bg-danger/10 text-danger"
                      }`}
                    >
                      {item.type === "receita" ? "Receita" : "Despesa"}
                    </span>
                    {item.paymentStatus === "parcial" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                        <WarningCircle size={11} weight="fill" aria-hidden />
                        Parcial
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {dueRelativeLabel(item.dueDate, today)}
                    {item.accountName ? ` · ${item.accountName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      item.type === "receita" ? "text-success" : "text-danger"
                    }`}
                  >
                    {formatCurrency(item.amount)}
                  </span>
                  <Button
                    type="button"
                    variant="success"
                    onClick={() => onMarkPaid(item)}
                    className="h-7 min-h-0 px-2.5 py-0 text-[11px]"
                  >
                    Marcar pago
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
