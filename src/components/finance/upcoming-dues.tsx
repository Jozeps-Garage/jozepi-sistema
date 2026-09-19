"use client";

import { CalendarBlank, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { dueRelativeLabel, isOverdue, todayDateKey } from "@/lib/finance/due";
import type { PaymentStatus, TransactionType } from "@/lib/finance/types";
import { formatCurrency } from "@/lib/utils/format";

export type UpcomingDueItem = {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  dueDate: string;
  accountName?: string;
  paymentStatus?: PaymentStatus;
};

export function UpcomingDuesList({
  items,
  today = todayDateKey(),
  onMarkPaid,
}: {
  items: UpcomingDueItem[];
  today?: string;
  onMarkPaid?: (item: UpcomingDueItem) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted">
        Nenhuma conta vencida ou a vencer nos próximos 7 dias.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
      {items.map((item) => {
        const overdue = isOverdue(
          { payment_status: item.paymentStatus, due_date: item.dueDate },
          today
        );
        return (
          <li
            key={item.id}
            className={`flex items-center justify-between gap-3 px-4 py-3 ${
              overdue ? "bg-danger/5" : "bg-card/70"
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {item.description}
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    item.type === "receita"
                      ? "bg-success/10 text-success"
                      : "bg-danger/10 text-danger"
                  }`}
                >
                  {item.type === "receita" ? "Receita" : "Despesa"}
                </span>
                {overdue && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                    <WarningCircle size={11} weight="fill" aria-hidden />
                    Vencido
                  </span>
                )}
              </div>
              <p className={`mt-0.5 truncate text-xs ${overdue ? "font-semibold text-danger" : "text-muted"}`}>
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
              {onMarkPaid && (
                <Button
                  type="button"
                  variant="success"
                  onClick={() => onMarkPaid(item)}
                  className="h-7 min-h-0 px-2.5 py-0 text-[11px]"
                >
                  Marcar pago
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function UpcomingDuesSection({
  items,
  today = todayDateKey(),
  onMarkPaid,
}: {
  items: UpcomingDueItem[];
  today?: string;
  onMarkPaid?: (item: UpcomingDueItem) => void;
}) {
  const overdueCount = items.filter((item) =>
    isOverdue({ payment_status: item.paymentStatus, due_date: item.dueDate }, today)
  ).length;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10 text-warning">
          <CalendarBlank size={20} weight="light" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Contas a vencer</h2>
          <p className="text-sm text-muted">
            Vencidas e próximas 7 dias
            {overdueCount > 0 ? ` · ${overdueCount} vencida${overdueCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </div>
      <UpcomingDuesList items={items} today={today} onMarkPaid={onMarkPaid} />
    </section>
  );
}
