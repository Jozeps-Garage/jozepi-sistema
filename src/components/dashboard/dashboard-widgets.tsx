"use client";

import Link from "next/link";
import {
  CalendarBlank,
  CurrencyDollar,
  ListChecks,
  UsersThree,
  Wallet,
  WarningCircle,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { RevenueMiniChart } from "@/components/dashboard/revenue-mini-chart";
import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DashboardData } from "@/lib/dashboard/types";
import {
  buildWhatsAppUrl,
  formatShortDate,
  formatTime,
  getClientName,
  getClientPhone,
  getProductStockPercent,
  getServiceNames,
  getStatusClasses,
  getStatusLabel,
} from "@/lib/dashboard/types";

export function RevenueWidget({ data }: { data: DashboardData }) {
  return (
    <div className="card-surface flex h-full flex-col justify-between">
      <div className="mb-1.5 flex items-center gap-2">
        <CurrencyDollar size={16} weight="light" className="text-muted" aria-hidden />
        <p className="label-caps">Faturamento do Mês</p>
      </div>
      <div>
        <p className="text-2xl font-bold leading-none text-foreground">
          {formatCurrency(data.stats.monthly_revenue)}
        </p>
        <p className="mt-0.5 text-[11px] text-muted">Receitas de OS finalizadas</p>
      </div>
    </div>
  );
}

export function ClientsWidget({ data }: { data: DashboardData }) {
  return (
    <Link
      href="/clientes"
      className="card-surface block h-full transition-opacity hover:opacity-80"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps">Clientes Cadastrados</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {data.stats.total_clients}
          </p>
          <p className="mt-1 text-xs font-semibold text-premium">
            Ver todos os clientes
          </p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UsersThree size={20} weight="light" aria-hidden />
        </div>
      </div>
    </Link>
  );
}

export function ServicesWidget({ data }: { data: DashboardData }) {
  return (
    <div className="card-surface flex h-full flex-col justify-between">
      <div className="mb-1.5 flex items-center gap-2">
        <ListChecks size={16} weight="light" className="text-muted" aria-hidden />
        <p className="label-caps">Serviços do Mês</p>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold leading-none text-foreground">
            {data.stats.open_orders}
          </span>
          <span className="mt-1 self-start rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
            Abertos
          </span>
        </div>
        <div className="h-10 w-px bg-border" />
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold leading-none text-foreground">
            {data.stats.completed_orders_month}
          </span>
          <span className="mt-1 self-start rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
            Finalizados
          </span>
        </div>
      </div>
    </div>
  );
}

export function AgendaWidget({ data }: { data: DashboardData }) {
  return (
    <div className="card-surface flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarBlank size={16} weight="light" className="text-muted" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">Agenda da semana</h2>
        </div>
        <span className="text-xs text-muted">7 dias</span>
      </div>

      {data.weekAppointments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-3 text-center">
          <CalendarBlank
            size={28}
            weight="light"
            className="mb-2 text-muted/40"
            aria-hidden
          />
          <p className="text-sm font-medium text-foreground">
            Nenhum agendamento esta semana
          </p>
          <p className="mt-0.5 text-xs text-muted">Adicione agendamentos na Agenda</p>
        </div>
      ) : (
        <ul className="max-h-36 space-y-0.5 overflow-y-auto">
          {data.weekAppointments.map((appt) => {
            const clientName = getClientName(appt.clients);
            const service = getServiceNames(appt.service_order_items);
            const phone = getClientPhone(appt.clients);
            const waUrl = buildWhatsAppUrl(
              phone,
              clientName,
              service,
              appt.scheduled_date,
              appt.scheduled_start
            );
            const isToday = appt.scheduled_date === data.todayDateKey;
            return (
              <li
                key={appt.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg px-2 py-1",
                  isToday && "bg-premium/10 ring-1 ring-premium/25"
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="w-12 shrink-0 text-center">
                    <p
                      className={cn(
                        "text-[10px] font-semibold uppercase",
                        isToday ? "text-premium" : "text-muted"
                      )}
                    >
                      {isToday ? "Hoje" : formatShortDate(appt.scheduled_date)}
                    </p>
                    {appt.scheduled_start && (
                      <p className="text-xs font-medium text-foreground">
                        {formatTime(appt.scheduled_start)}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {clientName}
                    </p>
                    <p className="truncate text-[11px] text-muted">{service}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getStatusClasses(appt.status)}`}
                  >
                    {getStatusLabel(appt.status)}
                  </span>
                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Enviar mensagem para ${clientName}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                    >
                      <WhatsappLogo
                        size={16}
                        weight="fill"
                        style={{ color: "#25D366" }}
                      />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto border-t border-border pt-2">
        <Link
          href="/agenda"
          className="text-xs font-semibold text-premium transition-opacity hover:opacity-70"
        >
          Ver agenda completa →
        </Link>
      </div>
    </div>
  );
}

export function CashflowWidget({ data }: { data: DashboardData }) {
  return (
    <div className="card-surface flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <Wallet size={16} weight="light" className="text-muted" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">Financeiro</h2>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex min-h-0 flex-col sm:pr-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">A receber</h3>
            {data.unpaidOrders.length > 0 && (
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                {data.unpaidOrders.length}
              </span>
            )}
          </div>
          {data.unpaidOrders.length === 0 ? (
            <p className="py-2 text-xs text-muted">Nada a receber</p>
          ) : (
            <ul className="max-h-40 divide-y divide-border overflow-y-auto">
              {data.unpaidOrders.map((order) => {
                const clientName = getClientName(order.clients);
                const service = getServiceNames(order.service_order_items);
                const dateStr = (order.completed_at ?? order.opened_at)?.slice(
                  0,
                  10
                );
                return (
                  <li
                    key={order.id}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {clientName}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {service}
                        {dateStr ? ` · ${formatShortDate(dateStr)}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-success">
                      {formatCurrency(Number(order.total_amount ?? 0))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 flex-col pt-3 sm:pl-4 sm:pt-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">A pagar</h3>
            {data.pendingExpenses.length > 0 && (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
                {data.pendingExpenses.length}
              </span>
            )}
          </div>
          {data.pendingExpenses.length === 0 ? (
            <p className="py-2 text-xs text-muted">Nada a pagar</p>
          ) : (
            <ul className="max-h-40 divide-y divide-border overflow-y-auto">
              {data.pendingExpenses.map((expense) => (
                <li
                  key={expense.id}
                  className="flex items-center justify-between gap-2 py-1"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {expense.description}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {expense.category ?? "Despesa"}
                      {expense.transaction_date
                        ? ` · ${formatShortDate(expense.transaction_date)}`
                        : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-danger">
                    {formatCurrency(Number(expense.amount ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-auto border-t border-border pt-2">
        <Link
          href="/financeiro"
          className="text-xs font-semibold text-premium transition-opacity hover:opacity-70"
        >
          Ver financeiro →
        </Link>
      </div>
    </div>
  );
}

export function ChartWidget({ data }: { data: DashboardData }) {
  return (
    <RevenueMiniChart
      data={data.monthlyChartData}
      maxValue={data.maxChartValue}
    />
  );
}

export function LowStockWidget({ data }: { data: DashboardData }) {
  return (
    <div className="card-surface flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <WarningCircle size={15} weight="light" className="text-muted" aria-hidden />
        <p className="label-caps">Estoque Baixo</p>
      </div>
      {data.lowStockProducts.length === 0 ? (
        <p className="text-xs text-muted">Todos os produtos com estoque adequado</p>
      ) : (
        <ul className="space-y-1.5">
          {data.lowStockProducts.slice(0, 5).map((product) => {
            const pct = Math.round(getProductStockPercent(product));
            return (
              <li
                key={product.name}
                className="flex items-center justify-between gap-2"
              >
                <p className="truncate text-xs font-medium text-foreground">
                  {product.name}
                </p>
                <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
                  {pct}%
                </span>
              </li>
            );
          })}
          {data.lowStockProducts.length > 5 && (
            <li className="text-[11px] text-muted">
              +{data.lowStockProducts.length - 5} outros
            </li>
          )}
        </ul>
      )}
      <div className="mt-auto pt-2">
        <Link
          href="/produtos"
          className="text-xs font-semibold text-premium transition-opacity hover:opacity-70"
        >
          Ver estoque →
        </Link>
      </div>
    </div>
  );
}
