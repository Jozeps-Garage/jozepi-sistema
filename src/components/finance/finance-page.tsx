"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarBlank,
  CalendarCheck,
  CaretDown,
  ChartBar,
  ChartDonut,
  ChartLineUp,
  CheckCircle,
  CircleHalf,
  Funnel,
  ListChecks,
  Note,
  PencilSimple,
  Plus,
  Prohibit,
  Trash,
  TrendDown,
  TrendUp,
  Trophy,
  Wallet,
  XCircle,
} from "@phosphor-icons/react";
import {
  ClipboardList,
  Pencil,
  Plus as LucidePlus,
  Trash2,
} from "lucide-react";
import { RevenueExpenseChart } from "@/components/finance/revenue-expense-chart";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { formatCurrency } from "@/lib/utils/format";

type FinanceTab = "overview" | "revenues" | "expenses" | "fixedCosts";
type PeriodFilter = "all" | "today" | "week" | "month" | "custom";
type ChartInterval = "7d" | "1m" | "3m" | "6m" | "1a";

const chartIntervalOptions: { value: ChartInterval; label: string; title: string }[] = [
  { value: "7d", label: "7D", title: "Últimos 7 dias" },
  { value: "1m", label: "1M", title: "Último mês por semana" },
  { value: "3m", label: "3M", title: "Últimos 3 meses" },
  { value: "6m", label: "6M", title: "Últimos 6 meses" },
  { value: "1a", label: "1A", title: "Último ano" },
];
type TransactionType = "receita" | "despesa";
type PaymentStatus = "pendente" | "pago" | "parcial" | "cancelado";

function normalizePaymentStatus(value: unknown): PaymentStatus {
  if (
    value === "pendente" ||
    value === "pago" ||
    value === "parcial" ||
    value === "cancelado"
  ) {
    return value;
  }
  return "pago";
}

const SUPPLIERS_STORAGE_KEY = "auto-estetica-suppliers";
const FIXED_COSTS_STORAGE_KEY = "auto-estetica-fixed-costs";
const FIXED_COST_PAYMENT_DAYS_KEY = "auto-estetica-fixed-cost-payment-days";
const TX_PAYMENT_STATUS_STORAGE_KEY = "auto-estetica-tx-payment-status";

interface FinancialTransaction {
  id: string;
  type: TransactionType;
  description: string;
  amount: number | string;
  category: string | null;
  service_order_id: string | null;
  supplier_id: string | null;
  product_id: string | null;
  source: string | null;
  payment_status: PaymentStatus;
  notes: string | null;
  transaction_date: string;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
}

type FixedCostKind = "real" | "estimated";

interface FixedCost {
  id: string;
  workshop_id: string;
  name: string;
  kind: FixedCostKind;
  amount: number | string;
  active: boolean;
  notes: string | null;
  payment_day: number | null;
  created_at: string;
  updated_at: string;
}

interface FixedCostForm {
  name: string;
  kind: FixedCostKind;
  amount: string;
  notes: string;
  paymentDay: string;
}

function sortSuppliers(list: Supplier[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeSuppliers(current: Supplier[], incoming: Supplier[]) {
  const byId = new Map(current.map((supplier) => [supplier.id, supplier]));
  incoming.forEach((supplier) => {
    const existing = byId.get(supplier.id);
    byId.set(supplier.id, existing ? { ...existing, ...supplier } : supplier);
  });
  return sortSuppliers(Array.from(byId.values()));
}

function readStoredSuppliers() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(SUPPLIERS_STORAGE_KEY);
    if (!stored) return [];

    return (JSON.parse(stored) as { id: string; name: string }[])
      .filter((supplier) => supplier.id && supplier.name)
      .map((supplier) => ({ id: supplier.id, name: supplier.name }));
  } catch {
    return [];
  }
}

function createFixedCostId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `fixed-cost-${Date.now()}-${Math.random()}`;
}

function sortFixedCosts(list: FixedCost[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeFixedCosts(current: FixedCost[], incoming: FixedCost[]) {
  const byId = new Map(current.map((cost) => [cost.id, cost]));
  incoming.forEach((cost) => {
    const existing = byId.get(cost.id);
    if (!existing) {
      byId.set(cost.id, cost);
      return;
    }

    byId.set(cost.id, {
      ...existing,
      ...cost,
      // Keep local payment_day when DB/legacy rows omit the column (comes back as null).
      payment_day:
        cost.kind === "estimated"
          ? null
          : cost.payment_day ?? existing.payment_day,
    });
  });
  return applyStoredPaymentDays(sortFixedCosts(Array.from(byId.values())));
}

function readStoredFixedCosts() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(FIXED_COSTS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as FixedCost[]) : [];
  } catch {
    return [];
  }
}

function writeStoredFixedCosts(costs: FixedCost[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FIXED_COSTS_STORAGE_KEY, JSON.stringify(costs));
}

function readStoredPaymentDays(): Record<string, number> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(FIXED_COST_PAYMENT_DAYS_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) => {
        const day = typeof value === "number" ? value : Number(value);
        if (!id || !Number.isFinite(day) || day < 1 || day > 31) return [];
        return [[id, Math.round(day)] as const];
      })
    );
  } catch {
    return {};
  }
}

function writeStoredPaymentDay(id: string, day: number | null) {
  if (typeof window === "undefined" || !id) return;

  try {
    const current = readStoredPaymentDays();
    if (day === null) {
      delete current[id];
    } else {
      current[id] = day;
    }
    window.localStorage.setItem(
      FIXED_COST_PAYMENT_DAYS_KEY,
      JSON.stringify(current)
    );
  } catch {
    // Ignora falhas de armazenamento local.
  }
}

function applyStoredPaymentDays(costs: FixedCost[]): FixedCost[] {
  const days = readStoredPaymentDays();
  return costs.map((cost) => {
    if (cost.kind === "estimated") {
      return { ...cost, payment_day: null };
    }

    return {
      ...cost,
      payment_day: cost.payment_day ?? days[cost.id] ?? null,
    };
  });
}

function readStoredTxPaymentStatuses(): Record<string, PaymentStatus> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(TX_PAYMENT_STATUS_STORAGE_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) => {
        const status = normalizePaymentStatus(value);
        return id ? [[id, status] as const] : [];
      })
    );
  } catch {
    return {};
  }
}

function writeStoredTxPaymentStatus(id: string, status: PaymentStatus) {
  if (typeof window === "undefined" || !id) return;

  try {
    const current = readStoredTxPaymentStatuses();
    current[id] = status;
    window.localStorage.setItem(
      TX_PAYMENT_STATUS_STORAGE_KEY,
      JSON.stringify(current)
    );
  } catch {
    // Ignora falhas de armazenamento local.
  }
}

function clearStoredTxPaymentStatus(id: string) {
  if (typeof window === "undefined" || !id) return;

  try {
    const current = readStoredTxPaymentStatuses();
    if (!(id in current)) return;
    delete current[id];
    window.localStorage.setItem(
      TX_PAYMENT_STATUS_STORAGE_KEY,
      JSON.stringify(current)
    );
  } catch {
    // Ignora falhas de armazenamento local.
  }
}

interface CompletedOrderItem {
  quantity: number | string | null;
  unit_price: number | string | null;
  services: { name: string; price?: number | string | null } | { name: string; price?: number | string | null }[] | null;
}

interface CompletedOrder {
  id: string;
  total_amount: number | string;
  completed_at: string | null;
  opened_at: string | null;
  payment_status: PaymentStatus;
  clients: { name: string } | { name: string }[] | null;
  service_order_items: CompletedOrderItem[] | null;
}

interface FinanceEntry {
  id: string;
  kind: "automatic" | "manual";
  type: TransactionType;
  description: string;
  amount: number;
  category: string;
  date: string;
  createdAt: string;
  clientName?: string;
  serviceName?: string;
  supplierId?: string;
  supplierName?: string;
  source?: string;
  serviceOrderId?: string;
  paymentStatus?: PaymentStatus;
  notes?: string;
}

type FinanceDeleteConfirm =
  | { type: "fixedCost"; cost: FixedCost }
  | { type: "transaction"; entry: FinanceEntry }
  | { type: "revertAppointment"; entry: FinanceEntry }
  | null;

interface TransactionForm {
  description: string;
  amount: string;
  date: string;
  category: string;
  supplierId: string;
}

interface DateRange {
  start: Date;
  end: Date;
}

const tabs: { id: FinanceTab; label: string }[] = [
  { id: "overview", label: "Visão Geral" },
  { id: "revenues", label: "Receitas" },
  { id: "expenses", label: "Despesas" },
  { id: "fixedCosts", label: "Custos Fixos" },
];

const periodOptions = [
  { value: "all", label: "Todos" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
  { value: "custom", label: "Personalizado" },
];

const revenueCategoryOptions = [
  { value: "Serviço", label: "Serviço" },
  { value: "Gorjeta", label: "Gorjeta" },
  { value: "Outros", label: "Outros" },
];

const expenseCategoryOptions = [
  { value: "Produtos", label: "Produtos" },
  { value: "Equipamentos", label: "Equipamentos" },
  { value: "Aluguel", label: "Aluguel" },
  { value: "Marketing", label: "Marketing" },
  { value: "Outros", label: "Outros" },
];
const categoryFilterAll = "all";
const FINANCE_ICON_WEIGHT = "light" as const;
const revenueCategoryFilterOptions = [
  { value: categoryFilterAll, label: "Todas as categorias" },
  ...revenueCategoryOptions,
];
const expenseCategoryFilterOptions = [
  { value: categoryFilterAll, label: "Todas as categorias" },
  ...expenseCategoryOptions,
];
const DONUT_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#6b7280", "#ef4444"];

const shortMonthLabels = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const initialRevenueForm: TransactionForm = {
  description: "",
  amount: "",
  date: dateKey(new Date()),
  category: "Serviço",
  supplierId: categoryFilterAll,
};

const initialExpenseForm: TransactionForm = {
  description: "",
  amount: "",
  date: dateKey(new Date()),
  category: "Produtos",
  supplierId: categoryFilterAll,
};

const initialFixedCostForm: FixedCostForm = {
  name: "",
  kind: "real",
  amount: "",
  notes: "",
  paymentDay: "1",
};

const FIXED_COST_SELECT_FULL =
  "id, workshop_id, name, kind, amount, active, notes, payment_day, created_at, updated_at";
const FIXED_COST_SELECT_LEGACY =
  "id, workshop_id, name, kind, amount, active, notes, created_at, updated_at";

const paymentDayOptions = Array.from({ length: 31 }, (_, index) => {
  const day = String(index + 1);
  return { value: day, label: `Dia ${day}` };
});

function normalizeFixedCost(row: Record<string, unknown>): FixedCost {
  const paymentDayRaw = row.payment_day;
  const paymentDay =
    typeof paymentDayRaw === "number"
      ? paymentDayRaw
      : typeof paymentDayRaw === "string" && paymentDayRaw.trim()
        ? Number(paymentDayRaw)
        : null;

  return {
    id: String(row.id),
    workshop_id: String(row.workshop_id),
    name: String(row.name ?? ""),
    kind: row.kind === "estimated" ? "estimated" : "real",
    amount: (row.amount as number | string) ?? 0,
    active: Boolean(row.active ?? true),
    notes: typeof row.notes === "string" ? row.notes : null,
    payment_day:
      paymentDay !== null && Number.isFinite(paymentDay)
        ? Math.min(31, Math.max(1, Math.round(paymentDay)))
        : null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

function fixedCostExpenseSource(costId: string, yearMonth: string) {
  return `fixed_cost:${costId}:${yearMonth}`;
}

function paymentDateForMonth(year: number, monthIndex: number, paymentDay: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(1, paymentDay), lastDay);
  return dateKey(new Date(year, monthIndex, day));
}

function yearMonthKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function getWeekRange(date: Date): DateRange {
  const start = startOfDay(date);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);

  const end = endOfDay(start);
  end.setDate(start.getDate() + 6);

  return { start, end };
}

function getPeriodRange(
  period: PeriodFilter,
  customStart: string,
  customEnd: string,
  baseDate = new Date()
): DateRange {
  if (period === "all") {
    return {
      start: new Date(2000, 0, 1),
      end: endOfDay(baseDate),
    };
  }

  if (period === "today") {
    return { start: startOfDay(baseDate), end: endOfDay(baseDate) };
  }

  if (period === "week") {
    return getWeekRange(baseDate);
  }

  if (period === "custom") {
    return {
      start: customStart ? startOfDay(parseLocalDate(customStart)) : startOfDay(baseDate),
      end: customEnd ? endOfDay(parseLocalDate(customEnd)) : endOfDay(baseDate),
    };
  }

  return { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
}

function isDateInRange(date: string, range: DateRange) {
  const parsed = parseLocalDate(date);
  return parsed >= range.start && parsed <= range.end;
}

function sortEntriesByLaunch(a: FinanceEntry, b: FinanceEntry) {
  const byCreated = b.createdAt.localeCompare(a.createdAt);
  if (byCreated !== 0) return byCreated;
  return b.date.localeCompare(a.date);
}

function parseMoney(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Informe um valor maior que zero.");
  }

  return amount;
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getOrderDate(order: CompletedOrder) {
  return (order.completed_at ?? order.opened_at ?? "").slice(0, 10);
}

function sumEntries(entries: FinanceEntry[]) {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}

function getMonthLabel(date: Date) {
  return shortMonthLabels[date.getMonth()];
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")}%`;
}

function getInitial(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "R";
}

function formatShortDate(date: string) {
  const parsed = parseLocalDate(date);
  const day = String(parsed.getDate()).padStart(2, "0");

  return `${day} ${shortMonthLabels[parsed.getMonth()]}`;
}

function toCurrencyNumber(value: number | string | null | undefined) {
  return Number(value) || 0;
}

function formatSupplierSaveError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("supplier_id") && normalized.includes("foreign key")) {
    return "Fornecedor inválido. Cadastre-o na aba Fornecedores em Produtos antes de vincular à despesa.";
  }

  return message;
}

const TRANSACTION_SELECT_WITH_NOTES =
  "id, type, description, amount, category, service_order_id, supplier_id, product_id, source, payment_status, notes, transaction_date, created_at";
const TRANSACTION_SELECT_WITH_PAYMENT =
  "id, type, description, amount, category, service_order_id, supplier_id, product_id, source, payment_status, transaction_date, created_at";
const TRANSACTION_SELECT_FULL =
  "id, type, description, amount, category, service_order_id, supplier_id, product_id, source, transaction_date, created_at";
const TRANSACTION_SELECT_WITH_SUPPLIER =
  "id, type, description, amount, category, service_order_id, supplier_id, transaction_date, created_at";
const TRANSACTION_SELECT_LEGACY =
  "id, type, description, amount, category, service_order_id, transaction_date, created_at";

function normalizeTransactionRow(
  row: Record<string, unknown>,
  fallback?: Pick<FinancialTransaction, "payment_status" | "notes"> | null
): FinancialTransaction {
  return {
    id: String(row.id),
    type: row.type as TransactionType,
    description: String(row.description),
    amount: row.amount as number | string,
    category: (row.category as string | null) ?? null,
    service_order_id: (row.service_order_id as string | null) ?? null,
    supplier_id: (row.supplier_id as string | null) ?? null,
    product_id: (row.product_id as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    payment_status:
      "payment_status" in row
        ? normalizePaymentStatus(row.payment_status)
        : fallback?.payment_status ?? "pago",
    notes:
      "notes" in row
        ? typeof row.notes === "string"
          ? row.notes
          : null
        : fallback?.notes ?? null,
    transaction_date: String(row.transaction_date),
    created_at: String(row.created_at ?? row.transaction_date),
  };
}

function isMissingColumnError(
  error: { message?: string } | null,
  column: string
) {
  const message = error?.message?.toLowerCase() ?? "";
  if (!message.includes(column.toLowerCase())) return false;
  if (
    message.includes("foreign key") ||
    message.includes("violates") ||
    message.includes("invalid input syntax")
  ) {
    return false;
  }

  return (
    message.includes("could not find") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

async function loadFinancialTransactions(
  supabase: ReturnType<typeof createClient>,
  workshopId: string
) {
  const attempts = [
    TRANSACTION_SELECT_WITH_NOTES,
    TRANSACTION_SELECT_WITH_PAYMENT,
    TRANSACTION_SELECT_FULL,
    TRANSACTION_SELECT_WITH_SUPPLIER,
    TRANSACTION_SELECT_LEGACY,
  ];

  let lastError: { message: string } | null = null;

  for (const columns of attempts) {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select(columns)
      .eq("workshop_id", workshopId)
      .order("transaction_date", { ascending: false });

    if (!error) {
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) =>
        normalizeTransactionRow(row)
      );
    }

    lastError = error;
  }

  throw new Error(lastError?.message ?? "Não foi possível carregar lançamentos.");
}

async function syncFixedCostExpenses(
  supabase: ReturnType<typeof createClient>,
  workshopId: string,
  costs: FixedCost[],
  existingTransactions: FinancialTransaction[]
): Promise<FinancialTransaction[]> {
  const today = startOfDay(new Date());
  const bySource = new Map(
    existingTransactions
      .filter((tx) => tx.source?.startsWith("fixed_cost:"))
      .map((tx) => [tx.source as string, tx])
  );
  const synced: FinancialTransaction[] = [];

  for (const cost of costs) {
    if (!cost.active || cost.kind !== "real" || !cost.payment_day) continue;

    const createdAt = cost.created_at ? new Date(cost.created_at) : today;

    for (let offset = 0; offset < 12; offset += 1) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const paymentDate = paymentDateForMonth(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        cost.payment_day
      );
      const paymentDateObj = startOfDay(parseLocalDate(paymentDate));

      if (paymentDateObj > today) continue;
      if (monthDate < startOfMonth(createdAt)) continue;

      const source = fixedCostExpenseSource(
        cost.id,
        yearMonthKey(monthDate.getFullYear(), monthDate.getMonth())
      );
      const amount = toCurrencyNumber(cost.amount);
      const existing = bySource.get(source);

      if (existing) {
        const needsUpdate =
          Number(existing.amount) !== amount ||
          existing.description !== cost.name ||
          existing.transaction_date !== paymentDate;

        if (!needsUpdate) continue;

        const { data, error } = await supabase
          .from("financial_transactions")
          .update({
            description: cost.name,
            amount,
            category: "Custo Fixo",
            transaction_date: paymentDate,
            source,
          })
          .eq("id", existing.id)
          .eq("workshop_id", workshopId)
          .select(TRANSACTION_SELECT_FULL)
          .maybeSingle();

        if (!error && data) {
          const normalized = normalizeTransactionRow(
            data as unknown as Record<string, unknown>,
            existing
          );
          synced.push(normalized);
          bySource.set(source, normalized);
        }
        continue;
      }

      const { data, error } = await supabase
        .from("financial_transactions")
        .insert({
          workshop_id: workshopId,
          type: "despesa",
          description: cost.name,
          amount,
          category: "Custo Fixo",
          transaction_date: paymentDate,
          source,
        })
        .select(TRANSACTION_SELECT_WITH_PAYMENT)
        .single();

      if (error) {
        const legacyInsert = await supabase
          .from("financial_transactions")
          .insert({
            workshop_id: workshopId,
            type: "despesa",
            description: cost.name,
            amount,
            category: "Custo Fixo",
            transaction_date: paymentDate,
            source,
          })
          .select(TRANSACTION_SELECT_FULL)
          .single();

        if (!legacyInsert.error && legacyInsert.data) {
          const normalized = normalizeTransactionRow(
            legacyInsert.data as unknown as Record<string, unknown>
          );
          synced.push(normalized);
          bySource.set(source, normalized);
        }
        continue;
      }

      if (data) {
        const normalized = normalizeTransactionRow(
          data as unknown as Record<string, unknown>
        );
        synced.push(normalized);
        bySource.set(source, normalized);
      }
    }
  }

  return synced;
}

async function fetchFinancialTransactionById(
  supabase: ReturnType<typeof createClient>,
  workshopId: string,
  transactionId: string
) {
  const attempts = [
    TRANSACTION_SELECT_WITH_NOTES,
    TRANSACTION_SELECT_WITH_PAYMENT,
    TRANSACTION_SELECT_FULL,
    TRANSACTION_SELECT_WITH_SUPPLIER,
    TRANSACTION_SELECT_LEGACY,
  ];

  let lastError: { message: string } | null = null;

  for (const columns of attempts) {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select(columns)
      .eq("id", transactionId)
      .eq("workshop_id", workshopId)
      .single();

    if (!error && data) {
      return normalizeTransactionRow(data as unknown as Record<string, unknown>);
    }

    lastError = error;
  }

  throw new Error(lastError?.message ?? "Não foi possível carregar o lançamento.");
}

function SummaryCard({
  title,
  value,
  detail,
  icon,
  tone,
  valueTone,
  onClick,
}: {
  title: string;
  value: string;
  detail?: string;
  icon: React.ReactNode;
  tone: "primary" | "success" | "danger" | "muted";
  valueTone?: "success" | "danger";
  onClick?: () => void;
}) {
  const toneStyles = {
    primary: {
      borderLeftColor: "var(--primary)",
      icon: "bg-primary/10 text-primary",
    },
    success: {
      borderLeftColor: "var(--finance-revenue)",
      icon: "bg-[var(--finance-revenue-soft)] text-[var(--finance-revenue)]",
    },
    danger: {
      borderLeftColor: "var(--danger)",
      icon: "bg-danger/10 text-danger",
    },
    muted: {
      borderLeftColor: "var(--muted)",
      icon: "bg-muted/10 text-muted",
    },
  }[tone];
  const valueClass =
    valueTone === "success"
      ? "text-success"
      : valueTone === "danger"
        ? "text-danger"
        : "text-foreground";

  const cardClassName =
    "group relative w-full rounded-lg border border-l-4 border-border bg-card p-5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const ariaLabel = detail ? `${title}: ${detail}` : title;
  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{title}</p>
          <p className={`mt-2 currency-display ${valueClass}`}>
            {value}
          </p>
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${toneStyles.icon}`}
        >
          {icon}
        </span>
      </div>
      {detail && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-5 right-5 top-full z-30 mt-2 translate-y-1 rounded-lg border border-border bg-card shadow-card px-3 py-2 text-xs font-semibold text-foreground opacity-0 shadow-lg ring-1 ring-slate-900/5 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100"
        >
          {detail}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ borderLeftColor: toneStyles.borderLeftColor }}
        className={`${cardClassName} cursor-pointer`}
        aria-label={ariaLabel}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div
      style={{ borderLeftColor: toneStyles.borderLeftColor }}
      className={cardClassName}
      aria-label={ariaLabel}
    >
      {cardContent}
    </div>
  );
}

const INLINE_FILTER_EXIT_MS = 300;

function InlineFilterButton({
  value,
  customStart,
  customEnd,
  category,
  categoryOptions,
  supplier,
  supplierOptions,
  open,
  onToggle,
  onClose,
  onChange,
  onCustomStartChange,
  onCustomEndChange,
  onCategoryChange,
  onSupplierChange,
  onClear,
  ariaLabel = "Filtros",
}: {
  value: PeriodFilter;
  customStart: string;
  customEnd: string;
  category: string;
  categoryOptions: { value: string; label: string }[];
  supplier?: string;
  supplierOptions?: { value: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: PeriodFilter) => void;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSupplierChange?: (value: string) => void;
  onClear: () => void;
  ariaLabel?: string;
}) {
  const showSupplier = Boolean(supplierOptions && onSupplierChange);
  const containerRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [panelReady, setPanelReady] = useState(false);
  const showPanel = open || closing;
  const panelVisible = panelReady && open && !closing;

  const requestClose = useCallback(() => {
    if (!open || closing) return;

    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, INLINE_FILTER_EXIT_MS);
  }, [closing, onClose, open]);

  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  useLayoutEffect(() => {
    if (!showPanel) {
      setPanelReady(false);
      return;
    }

    setPanelReady(false);
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setPanelReady(true));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showPanel]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        requestClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, requestClose]);

  function handleToggle() {
    if (open) {
      requestClose();
      return;
    }

    onToggle();
  }

  function handleClear() {
    onClear();
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={handleToggle}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          open
            ? "border-premium/40 bg-premium/10 text-premium"
            : "border-border/80 bg-card text-foreground/70 hover:bg-background hover:text-foreground"
        }`}
        aria-label="Abrir filtros"
        aria-expanded={open}
        title="Abrir filtros"
      >
        <Funnel size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      </button>

      {showPanel && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          className={`finance-inline-filter-card absolute right-0 top-full z-50 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card px-6 py-4 shadow-card transition-all duration-300 ease-out ${
            showSupplier ? "md:min-w-[42rem]" : "md:min-w-[32rem]"
          } ${
            panelVisible
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-2 opacity-0"
          }`}
          style={{
            boxShadow:
              "-6px 8px 24px rgba(15, 23, 42, 0.1), 0 4px 12px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div className="flex flex-wrap items-end gap-6">
            <Dropdown
              label="Período"
              value={value}
              options={periodOptions}
              onChange={(period) => onChange(period as PeriodFilter)}
              className="min-w-[11rem] flex-1 space-y-2"
            />
            <Dropdown
              label="Categoria"
              value={category}
              options={categoryOptions}
              onChange={onCategoryChange}
              className="min-w-[14rem] flex-[1.2] space-y-2"
            />
            {showSupplier && (
              <Dropdown
                label="Fornecedor"
                value={supplier ?? categoryFilterAll}
                options={supplierOptions!}
                onChange={onSupplierChange!}
                className="min-w-[14rem] flex-[1.2] space-y-2"
              />
            )}
            <div className="flex shrink-0 flex-col gap-2 border-l border-border pl-5">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClear}
                className="min-w-[5.5rem]"
              >
                Limpar
              </Button>
              <Button
                type="button"
                onClick={requestClose}
                className="min-w-[5.5rem]"
              >
                Aplicar
              </Button>
            </div>
          </div>

          {value === "custom" && (
            <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-4">
              <Input
                label="Início"
                type="date"
                value={customStart}
                onChange={(event) => onCustomStartChange(event.target.value)}
                className="w-40"
              />
              <Input
                label="Fim"
                type="date"
                value={customEnd}
                onChange={(event) => onCustomEndChange(event.target.value)}
                className="w-40"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getMonthYearLabel(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function monthKeyFromDateStr(dateStr: string): string {
  // "YYYY-MM-DD" → "YYYY-MM"
  return dateStr.slice(0, 7);
}

const TRANSACTION_PAGE_SIZE = 30;

const PAYMENT_STATUS_OPTIONS: {
  value: PaymentStatus;
  label: string;
  className: string;
  icon: typeof CheckCircle;
}[] = [
  {
    value: "pendente",
    label: "Pendente",
    className: "bg-warning/10 text-warning hover:bg-warning hover:text-white",
    icon: XCircle,
  },
  {
    value: "pago",
    label: "Pago",
    className: "bg-success/10 text-success hover:bg-success hover:text-white",
    icon: CheckCircle,
  },
  {
    value: "parcial",
    label: "Parcial",
    className: "bg-premium/10 text-premium hover:bg-premium hover:text-white",
    icon: CircleHalf,
  },
  {
    value: "cancelado",
    label: "Cancelado",
    className: "bg-danger/10 text-danger hover:bg-danger hover:text-white",
    icon: Prohibit,
  },
];

function getPaymentStatusOption(status?: PaymentStatus) {
  return (
    PAYMENT_STATUS_OPTIONS.find((option) => option.value === status) ??
    PAYMENT_STATUS_OPTIONS[0]
  );
}

function TransactionNotesIcon({
  notes,
  onUpdateNotes,
}: {
  notes: string;
  onUpdateNotes: (notes: string | null) => Promise<void>;
}) {
  const trimmedNotes = notes.trim();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(!trimmedNotes);
  const [draft, setDraft] = useState(trimmedNotes);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setEditing(!trimmedNotes);
        setDraft(trimmedNotes);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, trimmedNotes]);

  async function handleSave() {
    const next = draft.trim();
    if (!next) return;
    setSaving(true);
    try {
      await onUpdateNotes(next);
      setEditing(false);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await onUpdateNotes(null);
      setDraft("");
      setEditing(true);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative z-20 flex shrink-0 items-center justify-center">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setEditing(!trimmedNotes);
          setDraft(trimmedNotes);
        }}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
          trimmedNotes
            ? "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
            : "text-muted hover:bg-background hover:text-foreground"
        }`}
        aria-label={trimmedNotes ? "Ver observação" : "Adicionar observação"}
        title={trimmedNotes ? "Ver observação" : "Adicionar observação"}
      >
        <Note size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-md border border-border bg-card p-3 shadow-lg">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
            Observação
          </p>

          {editing || !trimmedNotes ? (
            <div className="space-y-2">
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                placeholder="Escreva uma observação..."
                className="w-full resize-none border-0 border-b border-border bg-transparent px-0 py-1 text-xs text-foreground outline-none placeholder:text-muted/60 focus:border-primary/40 disabled:opacity-60"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setOpen(false);
                    setEditing(!trimmedNotes);
                    setDraft(trimmedNotes);
                  }}
                  className="text-[11px] font-semibold text-muted hover:text-foreground disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving || !draft.trim()}
                  onClick={() => void handleSave()}
                  className="text-[11px] font-semibold text-success hover:text-success/80 disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                {trimmedNotes}
              </p>
              <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    setDraft(trimmedNotes);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground transition-colors hover:text-success"
                >
                  <PencilSimple size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  Editar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleRemove()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger transition-colors hover:text-danger/80 disabled:opacity-60"
                >
                  <Trash size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  {saving ? "..." : "Excluir"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentStatusSelect({
  value,
  onChange,
}: {
  value?: PaymentStatus;
  onChange: (status: PaymentStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = getPaymentStatusOption(value);
  const CurrentIcon = current.icon;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Alterar status de pagamento"
        title="Alterar status de pagamento"
        className={`inline-flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-bold transition-colors ${current.className}`}
      >
        <CurrentIcon size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
        {current.label}
        <CaretDown size={10} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Status de pagamento"
          className="absolute right-0 top-full z-40 mt-1.5 min-w-[9.5rem] overflow-hidden rounded-lg border border-border bg-card p-1 shadow-card-hover"
        >
          {PAYMENT_STATUS_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            const selected = option.value === current.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-bold transition-colors ${
                  selected
                    ? option.className.split(" hover:")[0]
                    : "text-foreground hover:bg-background"
                }`}
              >
                <OptionIcon size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TransactionList({
  entries,
  emptyMessage,
  emptyDescription,
  accent = "default",
  filter,
  groupByMonth = false,
  onEditTransaction,
  onDeleteTransaction,
  onChangePaymentStatus,
  onUpdateNotes,
}: {
  entries: FinanceEntry[];
  emptyMessage: string;
  emptyDescription?: string;
  accent?: "default" | "expense";
  filter?: React.ReactNode;
  groupByMonth?: boolean;
  onEditTransaction?: (entry: FinanceEntry) => void;
  onDeleteTransaction?: (entry: FinanceEntry) => void;
  onChangePaymentStatus?: (entry: FinanceEntry, status: PaymentStatus) => void;
  onUpdateNotes?: (entry: FinanceEntry, notes: string | null) => Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const entriesSignature = useMemo(
    () => entries.map((entry) => entry.id).join("|"),
    [entries]
  );

  useEffect(() => {
    setPage(0);
  }, [entriesSignature]);

  const totalPages = Math.ceil(entries.length / TRANSACTION_PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pagedEntries = entries.slice(
    safePage * TRANSACTION_PAGE_SIZE,
    (safePage + 1) * TRANSACTION_PAGE_SIZE
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const showPayment = Boolean(onChangePaymentStatus);
  const showNotes = Boolean(onUpdateNotes);
  const labelColumnTitle = accent === "expense" ? "Fornecedor" : "Categoria";
  const canEditPaymentStatus = (entry: FinanceEntry) =>
    accent === "expense" || Boolean(entry.serviceOrderId);

  // Separate fixed columns so OBS / status / edit stay aligned across rows.
  const gridTemplateColumns = [
    "minmax(0, 1fr)",
    "150px",
    "100px",
    "110px",
    showNotes ? "44px" : null,
    showPayment ? "108px" : null,
    "72px",
  ]
    .filter(Boolean)
    .join(" ");

  if (entries.length === 0) {
    return (
      <div className="w-full">
        {filter && <div className="mb-2 flex justify-end px-3">{filter}</div>}
        <div className="flex flex-col items-center px-4 py-12 text-center">
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-lg ${
              accent === "expense"
                ? "bg-danger/10 text-danger"
                : "bg-primary/10 text-primary"
            }`}
          >
            <ClipboardList className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm font-semibold text-foreground">
            {emptyMessage}
          </p>
          {emptyDescription && (
            <p className="mt-1 max-w-sm text-sm text-muted">{emptyDescription}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {filter && <div className="mb-2 flex justify-end px-3">{filter}</div>}
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
        <div
          className="grid items-center gap-x-4 border-b border-border px-3 py-3 text-xs font-semibold text-muted"
          style={{ gridTemplateColumns }}
        >
          <span>Descrição</span>
          <span>{labelColumnTitle}</span>
          <span>Data</span>
          <span>Valor</span>
          {showNotes && <span className="text-center">OBS</span>}
          {showPayment && <span>Status</span>}
          <span className="text-right">Ações</span>
        </div>
        {(() => {
          // Build flat list with optional month-separator rows
          type Row =
            | { kind: "header"; key: string; label: string }
            | { kind: "entry"; entry: FinanceEntry };
          const rows: Row[] = [];
          let lastMonthKey = "";
          for (const entry of pagedEntries) {
            if (groupByMonth) {
              const key = monthKeyFromDateStr(entry.date);
              if (key !== lastMonthKey) {
                rows.push({ kind: "header", key, label: getMonthYearLabel(entry.date) });
                lastMonthKey = key;
              }
            }
            rows.push({ kind: "entry", entry });
          }
          return rows.map((row) => {
            if (row.kind === "header") {
              return (
                <div
                  key={`header-${row.key}`}
                  className="border-b border-border bg-background/60 px-3 py-2"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted capitalize">
                    {row.label}
                  </span>
                </div>
              );
            }
            const { entry } = row;
          const isRevenue = entry.type === "receita";
          const displayTitle =
            entry.kind === "automatic" && entry.clientName
              ? entry.clientName
              : entry.description;
          const displaySubtitle =
            entry.kind === "automatic" && entry.serviceName
              ? entry.serviceName
              : undefined;
          return (
            <article
              key={entry.id}
              className="grid items-center gap-x-4 border-b border-border/70 px-3 py-3 transition-colors hover:bg-background/70"
              style={{ gridTemplateColumns }}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {displayTitle}
                  </p>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      entry.kind === "automatic"
                        ? "bg-success/10 text-success"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    {entry.kind === "automatic" ? (
                      <>
                        <CalendarBlank size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Agenda
                      </>
                    ) : (
                      <>
                        <PencilSimple size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Manual
                      </>
                    )}
                  </span>
                </div>
                {displaySubtitle && (
                  <p className="mt-1 truncate text-xs text-muted">{displaySubtitle}</p>
                )}
              </div>
              <div className="min-w-0 truncate text-sm font-medium text-foreground">
                {accent === "expense" ? entry.supplierName ?? "-" : entry.category}
              </div>
              <div className="text-sm font-medium text-foreground">
                {formatShortDate(entry.date)}
              </div>
              <div
                className={`text-sm font-bold ${
                  isRevenue ? "text-success" : "text-danger"
                }`}
              >
                {formatCurrency(entry.amount)}
              </div>
              {showNotes && onUpdateNotes && (
                <div className="flex justify-center">
                  <TransactionNotesIcon
                    notes={entry.notes ?? ""}
                    onUpdateNotes={(notes) => onUpdateNotes(entry, notes)}
                  />
                </div>
              )}
              {showPayment && (
                <div className="flex min-w-0 items-center">
                  {canEditPaymentStatus(entry) ? (
                    <PaymentStatusSelect
                      value={entry.paymentStatus}
                      onChange={(status) => onChangePaymentStatus?.(entry, status)}
                    />
                  ) : (
                    <span className="inline-flex h-8 items-center gap-1 rounded-full bg-success/10 px-2.5 text-[11px] font-bold text-success">
                      <CheckCircle size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                      Pago
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end gap-1.5">
                {onEditTransaction && (
                  <button
                    type="button"
                    onClick={() => onEditTransaction(entry)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
                    aria-label={`Editar ${entry.description}`}
                    title="Editar lançamento"
                  >
                    <PencilSimple size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  </button>
                )}
                {onDeleteTransaction ? (
                  <button
                    type="button"
                    onClick={() => onDeleteTransaction(entry)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                    aria-label={`Apagar ${entry.description}`}
                    title="Apagar lançamento"
                  >
                    <Trash size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  </button>
                ) : (
                  !onEditTransaction && (
                    <span className="text-xs font-semibold text-muted">-</span>
                  )
                )}
              </div>
            </article>
          );
          }); // end rows.map
        })()} {/* end IIFE */}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t border-border px-3 pt-4">
          <p className="text-xs text-muted">
            {safePage * TRANSACTION_PAGE_SIZE + 1}–{Math.min((safePage + 1) * TRANSACTION_PAGE_SIZE, entries.length)} de {entries.length} lançamentos
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Anterior
            </button>
            {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                  i === safePage
                    ? "bg-primary text-white"
                    : "border border-border bg-card text-muted hover:bg-background"
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage === totalPages - 1}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-muted transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              Próximo →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TransactionFormCard({
  title,
  description,
  form,
  categories,
  supplierOptions,
  loading,
  error,
  buttonLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  form: TransactionForm;
  categories: { value: string; label: string }[];
  supplierOptions?: { value: string; label: string }[];
  loading: boolean;
  error: string | null;
  buttonLabel: string;
  onChange: (patch: Partial<TransactionForm>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      autoComplete="off"
      className="finance-manual-form-enter rounded-lg border border-border bg-card shadow-card p-4 shadow-card sm:p-5"
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label="Descrição"
          value={form.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <Input
          label="Valor"
          prefix="R$"
          value={form.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
        />
        {supplierOptions && (
          <Dropdown
            label="Fornecedor (opcional)"
            value={form.supplierId}
            options={supplierOptions}
            onChange={(supplierId) => onChange({ supplierId })}
          />
        )}
        <Input
          label="Data"
          type="date"
          value={form.date}
          onChange={(event) => onChange({ date: event.target.value })}
        />
        <Dropdown
          label="Categoria"
          value={form.category}
          options={categories}
          onChange={(category) => onChange({ category })}
        />
      </div>
      {error && (
        <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="w-full sm:w-auto"
        >
          Cancelar
        </Button>
        <Button type="submit" variant="success" loading={loading} className="w-full sm:w-auto">
          <LucidePlus className="h-4 w-4" />
          {buttonLabel}
        </Button>
      </div>
    </form>
  );
}

// MonthlyBarChart is now RevenueExpenseChart from revenue-expense-chart.tsx

export function FinancePage() {
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(() => new Date(), []);
  const [activeTab, setActiveTab] = useState<FinanceTab>("overview");
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = readStoredFixedCosts().map((cost) =>
      normalizeFixedCost(cost as unknown as Record<string, unknown>)
    );
    stored.forEach((cost) => {
      if (cost.kind === "real" && cost.payment_day) {
        writeStoredPaymentDay(cost.id, cost.payment_day);
      }
    });
    return applyStoredPaymentDays(stored);
  });
  const fixedCostsRef = useRef(fixedCosts);
  const initialFinanceLoadRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<FinanceDeleteConfirm>(null);
  const [deletingFinanceItem, setDeletingFinanceItem] = useState(false);
  const [revenueForm, setRevenueForm] = useState<TransactionForm>(initialRevenueForm);
  const [expenseForm, setExpenseForm] = useState<TransactionForm>(initialExpenseForm);
  const [showRevenueForm, setShowRevenueForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingRevenueId, setEditingRevenueId] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [showRevenueFilter, setShowRevenueFilter] = useState(false);
  const [showExpenseFilter, setShowExpenseFilter] = useState(false);
  const [savingRevenue, setSavingRevenue] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [revenuePeriod, setRevenuePeriod] = useState<PeriodFilter>("all");
  const [expensePeriod, setExpensePeriod] = useState<PeriodFilter>("all");
  const [revenueCustomStart, setRevenueCustomStart] = useState(dateKey(startOfMonth(today)));
  const [revenueCustomEnd, setRevenueCustomEnd] = useState(dateKey(today));
  const [expenseCustomStart, setExpenseCustomStart] = useState(dateKey(startOfMonth(today)));
  const [expenseCustomEnd, setExpenseCustomEnd] = useState(dateKey(today));
  const [revenueCategoryFilter, setRevenueCategoryFilter] = useState(categoryFilterAll);
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState(categoryFilterAll);
  const [expenseSupplierFilter, setExpenseSupplierFilter] = useState(categoryFilterAll);
  const [showFixedCostForm, setShowFixedCostForm] = useState(false);
  const [editingFixedCostId, setEditingFixedCostId] = useState<string | null>(null);
  const [fixedCostForm, setFixedCostForm] = useState<FixedCostForm>(initialFixedCostForm);
  const [fixedCostError, setFixedCostError] = useState<string | null>(null);
  const [savingFixedCost, setSavingFixedCost] = useState(false);
  const [overviewChartInterval, setOverviewChartInterval] = useState<ChartInterval>("6m");

  const loadFinanceData = useCallback(async () => {
    if (initialFinanceLoadRef.current) {
      setLoading(true);
    }
    setError(null);

    const { workshopId: profileWorkshopId, error: profileError } =
      await fetchOwnWorkshop(supabase);

    if (profileError || !profileWorkshopId) {
      setError(profileError?.message ?? "Oficina não encontrada.");
      setLoading(false);
      return;
    }

    setWorkshopId(profileWorkshopId);

    const [
      { data: ordersData, error: ordersError },
      suppliersResult,
      fixedCostsResult,
    ] =
      await Promise.all([
        supabase
          .from("service_orders")
          .select(
            `
            id,
            total_amount,
            completed_at,
            opened_at,
            payment_status,
            clients(name),
            service_order_items(
              quantity,
              unit_price,
              services(name, price)
            )
          `
          )
          .eq("workshop_id", profileWorkshopId)
          .eq("status", "finalizada")
          .order("completed_at", { ascending: false }),
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("workshop_id", profileWorkshopId)
          .order("name", { ascending: true }),
        supabase
          .from("fixed_costs")
          .select(FIXED_COST_SELECT_FULL)
          .eq("workshop_id", profileWorkshopId)
          .order("name", { ascending: true }),
      ]);
    let transactionsData: FinancialTransaction[] = [];
    try {
      transactionsData = await loadFinancialTransactions(supabase, profileWorkshopId);
    } catch (transactionsError) {
      setError(
        transactionsError instanceof Error
          ? transactionsError.message
          : "Não foi possível carregar lançamentos."
      );
    }

    setTransactions(transactionsData);

    if (ordersError) {
      setError(ordersError.message);
    } else {
      setOrders((ordersData as CompletedOrder[] | null) ?? []);
    }

    const storedSuppliers = readStoredSuppliers();
    if (suppliersResult.error) {
      setSuppliers(storedSuppliers);
    } else {
      setSuppliers(sortSuppliers((suppliersResult.data as Supplier[] | null) ?? []));
    }

    const storedFixedCosts = applyStoredPaymentDays(
      readStoredFixedCosts().map((cost) =>
        normalizeFixedCost(cost as unknown as Record<string, unknown>)
      )
    );
    const localFixedCosts = applyStoredPaymentDays(
      mergeFixedCosts(storedFixedCosts, fixedCostsRef.current)
    );
    let loadedFixedCosts = localFixedCosts;
    if (fixedCostsResult.error) {
      if (isMissingColumnError(fixedCostsResult.error, "payment_day")) {
        const legacyResult = await supabase
          .from("fixed_costs")
          .select(FIXED_COST_SELECT_LEGACY)
          .eq("workshop_id", profileWorkshopId)
          .order("name", { ascending: true });
        if (!legacyResult.error) {
          loadedFixedCosts = mergeFixedCosts(
            localFixedCosts,
            ((legacyResult.data as Record<string, unknown>[] | null) ?? []).map(
              normalizeFixedCost
            )
          );
        }
      }
    } else {
      loadedFixedCosts = mergeFixedCosts(
        localFixedCosts,
        ((fixedCostsResult.data as Record<string, unknown>[] | null) ?? []).map(
          normalizeFixedCost
        )
      );
    }
    loadedFixedCosts = applyStoredPaymentDays(loadedFixedCosts);
    fixedCostsRef.current = loadedFixedCosts;
    setFixedCosts(loadedFixedCosts);

    if (profileWorkshopId) {
      const synced = await syncFixedCostExpenses(
        supabase,
        profileWorkshopId,
        loadedFixedCosts,
        transactionsData
      );
      if (synced.length > 0) {
        setTransactions((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]));
          synced.forEach((item) => byId.set(item.id, item));
          return Array.from(byId.values());
        });
      }
    }

    initialFinanceLoadRef.current = false;
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fixedCostsRef.current = fixedCosts;
  }, [fixedCosts]);

  useEffect(() => {
    void Promise.resolve().then(loadFinanceData);
  }, [loadFinanceData]);

  useEffect(() => {
    if (suppliers.length === 0) return;

    try {
      const storedSuppliers = readStoredSuppliers();
      window.localStorage.setItem(
        SUPPLIERS_STORAGE_KEY,
        JSON.stringify(mergeSuppliers(storedSuppliers, suppliers))
      );
    } catch {
      // Ignora falhas de armazenamento local; o Supabase continua sendo a fonte principal.
    }
  }, [suppliers]);

  useEffect(() => {
    // Avoid wiping localStorage with [] before the first finance load finishes.
    if (loading) return;
    writeStoredFixedCosts(fixedCosts);
  }, [fixedCosts, loading]);

  useEffect(() => {
    if (!workshopId) return;

    const channel = supabase
      .channel(`finance-sync-${workshopId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "financial_transactions",
          filter: `workshop_id=eq.${workshopId}`,
        },
        () => {
          void loadFinanceData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "service_orders",
          filter: `workshop_id=eq.${workshopId}`,
        },
        () => {
          void loadFinanceData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "suppliers",
          filter: `workshop_id=eq.${workshopId}`,
        },
        () => {
          void loadFinanceData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fixed_costs",
          filter: `workshop_id=eq.${workshopId}`,
        },
        () => {
          void loadFinanceData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFinanceData, supabase, workshopId]);

  const ordersById = useMemo(() => {
    return new Map(orders.map((order) => [order.id, order]));
  }, [orders]);

  const suppliersById = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  }, [suppliers]);

  const transactionEntries = useMemo<FinanceEntry[]>(() => {
    const storedPaymentStatuses = readStoredTxPaymentStatuses();

    return transactions.map((transaction) => {
      const order = transaction.service_order_id
        ? ordersById.get(transaction.service_order_id)
        : undefined;
      const serviceNames =
        order?.service_order_items
          ?.map((item) => firstRelation(item.services)?.name)
          .filter(Boolean)
          .join(", ") || undefined;

      const storedStatus = storedPaymentStatuses[transaction.id];
      const paymentStatus =
        transaction.type === "receita" && order
          ? order.payment_status
          : transaction.type === "receita" && transaction.service_order_id
            ? "pendente"
            : storedStatus ?? transaction.payment_status;

      return {
        id: transaction.id,
        kind: transaction.service_order_id ? "automatic" : "manual",
        type: transaction.type,
        description: transaction.description,
        amount: toCurrencyNumber(transaction.amount),
        category: transaction.category ?? "Outros",
        date: transaction.transaction_date,
        createdAt: transaction.created_at ?? transaction.transaction_date,
        clientName: order ? firstRelation(order.clients)?.name : undefined,
        serviceName: serviceNames,
        supplierId: transaction.supplier_id ?? undefined,
        supplierName: transaction.supplier_id
          ? suppliersById.get(transaction.supplier_id)?.name ?? "Fornecedor removido"
          : undefined,
        source: transaction.source ?? undefined,
        serviceOrderId: transaction.service_order_id ?? undefined,
        paymentStatus,
        notes: transaction.notes ?? "",
      };
    });
  }, [ordersById, suppliersById, transactions]);

  const revenueEntries = useMemo(
    () =>
      transactionEntries
        .filter((entry) => entry.type === "receita")
        .sort(sortEntriesByLaunch),
    [transactionEntries]
  );
  const expenseEntries = useMemo(
    () =>
      transactionEntries
        .filter((entry) => entry.type === "despesa")
        .sort(sortEntriesByLaunch),
    [transactionEntries]
  );
  const automaticRevenueServiceOrderIds = useMemo(() => {
    return new Set(
      transactions
        .filter(
          (transaction) =>
            transaction.type === "receita" && transaction.service_order_id
        )
        .map((transaction) => transaction.service_order_id as string)
    );
  }, [transactions]);
  const reportOrders = useMemo(
    () => orders.filter((order) => automaticRevenueServiceOrderIds.has(order.id)),
    [automaticRevenueServiceOrderIds, orders]
  );

  const currentMonthRange = getPeriodRange("month", "", "", today);
  const previousMonthDate = addMonths(today, -1);
  const previousMonthRange = {
    start: startOfMonth(previousMonthDate),
    end: endOfMonth(previousMonthDate),
  };
  const todayRange = getPeriodRange("today", "", "", today);
  const monthRevenues = revenueEntries.filter((entry) =>
    isDateInRange(entry.date, currentMonthRange)
  );
  const monthExpenses = expenseEntries.filter((entry) =>
    isDateInRange(entry.date, currentMonthRange)
  );
  const previousMonthRevenues = revenueEntries.filter((entry) =>
    isDateInRange(entry.date, previousMonthRange)
  );
  const previousMonthExpenses = expenseEntries.filter((entry) =>
    isDateInRange(entry.date, previousMonthRange)
  );
  const monthRevenueTotal = sumEntries(monthRevenues);
  const monthExpenseTotal = sumEntries(monthExpenses);
  const monthProfit = monthRevenueTotal - monthExpenseTotal;
  const previousMonthProfit =
    sumEntries(previousMonthRevenues) - sumEntries(previousMonthExpenses);
  const monthGrowth =
    previousMonthProfit === 0
      ? monthProfit > 0
        ? 100
        : 0
      : ((monthProfit - previousMonthProfit) / Math.abs(previousMonthProfit)) * 100;
  const growthPositive = monthGrowth >= 0;

  const revenueRange = getPeriodRange(
    revenuePeriod,
    revenueCustomStart,
    revenueCustomEnd,
    today
  );
  const expenseRange = getPeriodRange(
    expensePeriod,
    expenseCustomStart,
    expenseCustomEnd,
    today
  );
  const expenseSupplierFilterOptions = [
    { value: categoryFilterAll, label: "Todos os fornecedores" },
    ...suppliers.map((supplier) => ({
      value: supplier.id,
      label: supplier.name,
    })),
  ];
  const expenseSupplierOptions = [
    { value: categoryFilterAll, label: "Sem fornecedor" },
    ...suppliers.map((supplier) => ({
      value: supplier.id,
      label: supplier.name,
    })),
  ];
  const filteredRevenueEntries = revenueEntries.filter(
    (entry) =>
      (revenuePeriod === "all" || isDateInRange(entry.date, revenueRange)) &&
      (revenueCategoryFilter === categoryFilterAll ||
        entry.category === revenueCategoryFilter)
  );
  const filteredExpenseEntries = expenseEntries.filter(
    (entry) =>
      (expensePeriod === "all" || isDateInRange(entry.date, expenseRange)) &&
      (expenseCategoryFilter === categoryFilterAll ||
        entry.category === expenseCategoryFilter) &&
      (expenseSupplierFilter === categoryFilterAll ||
        entry.supplierId === expenseSupplierFilter)
  );

  const reportMonths = Array.from({ length: 6 }, (_, index) =>
    addMonths(startOfMonth(today), index - 5)
  );
  const monthlyReport = reportMonths.map((month) => {
    const range = { start: startOfMonth(month), end: endOfMonth(month) };
    return {
      label: getMonthLabel(month),
      revenue: sumEntries(revenueEntries.filter((entry) => isDateInRange(entry.date, range))),
      expense: sumEntries(expenseEntries.filter((entry) => isDateInRange(entry.date, range))),
    };
  });
  const maxMonthlyValue = Math.max(
    1,
    ...monthlyReport.flatMap((item) => [item.revenue, item.expense])
  );

  const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const overviewChartData = useMemo(() => {
    if (overviewChartInterval === "7d") {
      return Array.from({ length: 7 }, (_, i) => {
        const d = subDays(today, 6 - i);
        const range = { start: startOfDay(d), end: endOfDay(d) };
        return {
          label: dayLabels[d.getDay()],
          revenue: sumEntries(revenueEntries.filter((e) => isDateInRange(e.date, range))),
          expense: sumEntries(expenseEntries.filter((e) => isDateInRange(e.date, range))),
        };
      });
    }
    if (overviewChartInterval === "1m") {
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);
      const weeks: { label: string; start: Date; end: Date }[] = [];
      let cursor = new Date(monthStart);
      let weekNum = 1;
      while (cursor <= monthEnd) {
        const weekEnd = new Date(cursor);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const rangeEnd = weekEnd > monthEnd ? monthEnd : weekEnd;
        weeks.push({
          label: `Sem ${weekNum}`,
          start: new Date(cursor),
          end: endOfDay(rangeEnd),
        });
        cursor.setDate(cursor.getDate() + 7);
        weekNum++;
      }
      return weeks.map(({ label, start, end }) => {
        const range = { start, end };
        return {
          label,
          revenue: sumEntries(revenueEntries.filter((e) => isDateInRange(e.date, range))),
          expense: sumEntries(expenseEntries.filter((e) => isDateInRange(e.date, range))),
        };
      });
    }
    if (overviewChartInterval === "3m") {
      return Array.from({ length: 3 }, (_, i) => {
        const month = addMonths(startOfMonth(today), i - 2);
        const range = { start: startOfMonth(month), end: endOfMonth(month) };
        return {
          label: getMonthLabel(month),
          revenue: sumEntries(revenueEntries.filter((e) => isDateInRange(e.date, range))),
          expense: sumEntries(expenseEntries.filter((e) => isDateInRange(e.date, range))),
        };
      });
    }
    if (overviewChartInterval === "1a") {
      return Array.from({ length: 12 }, (_, i) => {
        const month = addMonths(startOfMonth(today), i - 11);
        const range = { start: startOfMonth(month), end: endOfMonth(month) };
        return {
          label: getMonthLabel(month),
          revenue: sumEntries(revenueEntries.filter((e) => isDateInRange(e.date, range))),
          expense: sumEntries(expenseEntries.filter((e) => isDateInRange(e.date, range))),
        };
      });
    }
    return monthlyReport;
  }, [overviewChartInterval, revenueEntries, expenseEntries, today, monthlyReport]); // eslint-disable-line react-hooks/exhaustive-deps

  const overviewChartMaxValue = useMemo(
    () => Math.max(1, ...overviewChartData.flatMap((item) => [item.revenue, item.expense])),
    [overviewChartData]
  );

  const serviceRevenue = reportOrders.reduce<Record<string, number>>((acc, order) => {
    const items = order.service_order_items ?? [];
    if (items.length === 0) {
      acc["Serviços"] = (acc["Serviços"] ?? 0) + toCurrencyNumber(order.total_amount);
      return acc;
    }

    items.forEach((item) => {
      const service = firstRelation(item.services);
      const serviceName = service?.name ?? "Serviço";
      const catalogPrice = toCurrencyNumber(service?.price ?? item.unit_price);
      const subtotal = catalogPrice * (Number(item.quantity) || 1);
      acc[serviceName] = (acc[serviceName] ?? 0) + subtotal;
    });
    return acc;
  }, {});
  const serviceRanking = Object.entries(serviceRevenue)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const serviceTotal = serviceRanking.reduce((total, item) => total + item.amount, 0);
  const donutSegments = serviceRanking.reduce<
    { name: string; amount: number; dash: number; offset: number }[]
  >((segments, item) => {
    const previous = segments.reduce((total, segment) => total + segment.dash, 0);
    const dash = serviceTotal > 0 ? (item.amount / serviceTotal) * 100 : 0;
    return [...segments, { ...item, dash, offset: -previous }];
  }, []);

  const clientRanking = Object.values(
    reportOrders.reduce<Record<string, { name: string; amount: number }>>((acc, order) => {
      const clientName = firstRelation(order.clients)?.name ?? "Cliente não encontrado";
      acc[clientName] = {
        name: clientName,
        amount: (acc[clientName]?.amount ?? 0) + toCurrencyNumber(order.total_amount),
      };
      return acc;
    }, {})
  )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const todayOrders = reportOrders.filter((order) => {
    const orderDate = getOrderDate(order);
    return orderDate ? isDateInRange(orderDate, todayRange) : false;
  });
  const todayRevenue = sumEntries(
    revenueEntries.filter((entry) => isDateInRange(entry.date, todayRange))
  );
  const todayExpenses = sumEntries(
    expenseEntries.filter((entry) => isDateInRange(entry.date, todayRange))
  );
  const todayProfit = todayRevenue - todayExpenses;
  const activeFixedCosts = fixedCosts.filter((cost) => cost.active);
  const fixedRealTotal = activeFixedCosts
    .filter((cost) => cost.kind === "real")
    .reduce((total, cost) => total + toCurrencyNumber(cost.amount), 0);
  const fixedEstimatedTotal = activeFixedCosts
    .filter((cost) => cost.kind === "estimated")
    .reduce((total, cost) => total + toCurrencyNumber(cost.amount), 0);
  const fixedMonthlyTotal = fixedRealTotal + fixedEstimatedTotal;
  const monthlyWashCount = reportOrders.filter((order) => {
    const orderDate = getOrderDate(order);
    return orderDate ? isDateInRange(orderDate, currentMonthRange) : false;
  }).length;
  const fixedCostPerWash =
    monthlyWashCount > 0 ? fixedMonthlyTotal / monthlyWashCount : 0;

  function resetForm(type: TransactionType) {
    if (type === "receita") {
      setRevenueForm({ ...initialRevenueForm, date: dateKey(today) });
      setEditingRevenueId(null);
      return;
    }

    setExpenseForm({ ...initialExpenseForm, date: dateKey(today) });
    setEditingExpenseId(null);
  }

  function closeManualForm(type: TransactionType) {
    resetForm(type);

    if (type === "receita") {
      setRevenueError(null);
      setShowRevenueForm(false);
      return;
    }

    setExpenseError(null);
    setShowExpenseForm(false);
  }

  async function handleSaveManualTransaction(
    event: React.FormEvent<HTMLFormElement>,
    type: TransactionType
  ) {
    event.preventDefault();
    const form = type === "receita" ? revenueForm : expenseForm;
    const setFormError = type === "receita" ? setRevenueError : setExpenseError;
    const setSaving = type === "receita" ? setSavingRevenue : setSavingExpense;
    const transactionId =
      type === "despesa"
        ? editingExpenseId
        : type === "receita"
          ? editingRevenueId
          : null;

    if (!workshopId) {
      setFormError("Oficina não encontrada.");
      return;
    }

    if (!form.description.trim()) {
      setFormError("Informe a descrição.");
      return;
    }

    let amount: number;
    try {
      amount = parseMoney(form.amount);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Informe um valor válido.");
      return;
    }

    const supplierId =
      type === "despesa" && form.supplierId !== categoryFilterAll
        ? form.supplierId
        : null;

    if (supplierId && !suppliersById.has(supplierId)) {
      setFormError(
        "Fornecedor inválido. Cadastre-o na aba Fornecedores em Produtos antes de vincular à despesa."
      );
      return;
    }

    setSaving(true);
    setFormError(null);
    const transactionPayload = {
      description: form.description.trim(),
      amount,
      category: form.category,
      transaction_date: form.date,
    };

    if (transactionId) {
      let { error: updateError } = await supabase
        .from("financial_transactions")
        .update({
          ...transactionPayload,
          supplier_id: supplierId,
        })
        .eq("id", transactionId)
        .eq("workshop_id", workshopId);

      if (isMissingColumnError(updateError, "supplier_id")) {
        const legacyResult = await supabase
          .from("financial_transactions")
          .update(transactionPayload)
          .eq("id", transactionId)
          .eq("workshop_id", workshopId);

        updateError = legacyResult.error;
      }

      setSaving(false);

      if (updateError) {
        setFormError(formatSupplierSaveError(updateError.message));
        return;
      }

      try {
        const savedTransaction = await fetchFinancialTransactionById(
          supabase,
          workshopId,
          transactionId
        );
        setTransactions((prev) =>
          prev.map((transaction) =>
            transaction.id === transactionId ? savedTransaction : transaction
          )
        );
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Despesa salva, mas não foi possível recarregar."
        );
        void loadFinanceData();
      }

      closeManualForm(type);
      return;
    }

    let { data: insertedRow, error: insertError } = await supabase
      .from("financial_transactions")
      .insert({
        workshop_id: workshopId,
        type,
        ...transactionPayload,
        supplier_id: supplierId,
      })
      .select("id")
      .single();

    if (isMissingColumnError(insertError, "supplier_id")) {
      const legacyResult = await supabase
        .from("financial_transactions")
        .insert({
          workshop_id: workshopId,
          type,
          ...transactionPayload,
        })
        .select("id")
        .single();

      insertedRow = legacyResult.data;
      insertError = legacyResult.error;
    }

    setSaving(false);

    if (insertError || !insertedRow?.id) {
      setFormError(formatSupplierSaveError(insertError?.message ?? "Erro ao salvar."));
      return;
    }

    try {
      const savedTransaction = await fetchFinancialTransactionById(
        supabase,
        workshopId,
        insertedRow.id
      );
      setTransactions((prev) => [savedTransaction, ...prev]);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Despesa salva, mas não foi possível recarregar."
      );
      void loadFinanceData();
    }

    closeManualForm(type);
  }

  function handleEditRevenue(entry: FinanceEntry) {
    setRevenueForm({
      description: entry.description,
      amount: entry.amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      date: entry.date,
      category: entry.category,
      supplierId: categoryFilterAll,
    });
    setRevenueError(null);
    setEditingRevenueId(entry.id);
    setShowRevenueForm(true);
  }

  async function handleChangePaymentStatus(
    entry: FinanceEntry,
    nextStatus: PaymentStatus
  ) {
    if (entry.paymentStatus === nextStatus) return;

    const previousStatus = entry.paymentStatus ?? "pendente";
    setError(null);

    if (entry.type === "receita" && entry.serviceOrderId) {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === entry.serviceOrderId
            ? { ...order, payment_status: nextStatus }
            : order
        )
      );

      const { error: updateError } = await supabase
        .from("service_orders")
        .update({ payment_status: nextStatus })
        .eq("id", entry.serviceOrderId);

      if (updateError) {
        setOrders((prev) =>
          prev.map((order) =>
            order.id === entry.serviceOrderId
              ? { ...order, payment_status: previousStatus }
              : order
          )
        );
        setError(updateError.message);
      }
      return;
    }

    if (entry.type !== "despesa") return;

    writeStoredTxPaymentStatus(entry.id, nextStatus);
    setTransactions((prev) =>
      prev.map((transaction) =>
        transaction.id === entry.id
          ? { ...transaction, payment_status: nextStatus }
          : transaction
      )
    );

    const { error: updateError } = await supabase
      .from("financial_transactions")
      .update({ payment_status: nextStatus })
      .eq("id", entry.id)
      .eq("workshop_id", workshopId);

    if (!updateError) {
      clearStoredTxPaymentStatus(entry.id);
      return;
    }

    if (isMissingColumnError(updateError, "payment_status")) {
      // Keep local/optimistic status until migration 018 is applied.
      return;
    }

    writeStoredTxPaymentStatus(entry.id, previousStatus);
    setTransactions((prev) =>
      prev.map((transaction) =>
        transaction.id === entry.id
          ? { ...transaction, payment_status: previousStatus }
          : transaction
      )
    );
    setError(updateError.message);
  }

  async function handleUpdateTransactionNotes(
    entry: FinanceEntry,
    notes: string | null
  ) {
    const nextNotes = notes?.trim() || null;
    const previousNotes = entry.notes ?? "";

    setTransactions((prev) =>
      prev.map((transaction) =>
        transaction.id === entry.id
          ? { ...transaction, notes: nextNotes }
          : transaction
      )
    );
    setError(null);

    const { error: updateError } = await supabase
      .from("financial_transactions")
      .update({ notes: nextNotes })
      .eq("id", entry.id)
      .eq("workshop_id", workshopId);

    if (updateError) {
      setTransactions((prev) =>
        prev.map((transaction) =>
          transaction.id === entry.id
            ? { ...transaction, notes: previousNotes || null }
            : transaction
        )
      );
      setError(
        isMissingColumnError(updateError, "notes")
          ? "Não foi possível salvar a observação neste lançamento."
          : updateError.message
      );
      throw updateError;
    }
  }

  function handleEditExpense(entry: FinanceEntry) {
    setExpenseForm({
      description: entry.description,
      amount: entry.amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      date: entry.date,
      category: entry.category,
      supplierId: entry.supplierId ?? categoryFilterAll,
    });
    setExpenseError(null);
    setEditingExpenseId(entry.id);
    setShowExpenseForm(true);
  }

  function resetFixedCostForm() {
    setEditingFixedCostId(null);
    setFixedCostForm(initialFixedCostForm);
    setFixedCostError(null);
    setShowFixedCostForm(false);
  }

  function handleEditFixedCost(cost: FixedCost) {
    setEditingFixedCostId(cost.id);
    setFixedCostForm({
      name: cost.name,
      kind: cost.kind,
      amount: toCurrencyNumber(cost.amount).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      notes: cost.notes ?? "",
      paymentDay: String(cost.payment_day ?? 1),
    });
    setFixedCostError(null);
    setShowFixedCostForm(true);
  }

  async function handleSaveFixedCost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workshopId) {
      setFixedCostError("Oficina não encontrada.");
      return;
    }

    if (!fixedCostForm.name.trim()) {
      setFixedCostError("Informe o nome do custo.");
      return;
    }

    let amount: number;
    try {
      amount = parseMoney(fixedCostForm.amount);
    } catch (err) {
      setFixedCostError(err instanceof Error ? err.message : "Informe um valor válido.");
      return;
    }

    const paymentDay = Number(fixedCostForm.paymentDay);
    if (
      fixedCostForm.kind === "real" &&
      (!Number.isFinite(paymentDay) || paymentDay < 1 || paymentDay > 31)
    ) {
      setFixedCostError("Informe o dia de pagamento (1 a 31).");
      return;
    }

    setSavingFixedCost(true);
    setFixedCostError(null);

    const now = new Date().toISOString();
    const existingCost = fixedCosts.find((cost) => cost.id === editingFixedCostId);
    const localCost: FixedCost = {
      id: editingFixedCostId ?? createFixedCostId(),
      workshop_id: workshopId,
      name: fixedCostForm.name.trim(),
      kind: fixedCostForm.kind,
      amount,
      active: existingCost?.active ?? true,
      notes: fixedCostForm.notes.trim() || null,
      payment_day: fixedCostForm.kind === "real" ? paymentDay : null,
      created_at: existingCost?.created_at ?? now,
      updated_at: now,
    };
    writeStoredPaymentDay(localCost.id, localCost.payment_day);
    const nextCostsOptimistic = sortFixedCosts([
      ...fixedCosts.filter((cost) => cost.id !== localCost.id),
      localCost,
    ]);
    fixedCostsRef.current = nextCostsOptimistic;
    writeStoredFixedCosts(nextCostsOptimistic);
    setFixedCosts(nextCostsOptimistic);

    const payload = {
      workshop_id: workshopId,
      name: localCost.name,
      kind: localCost.kind,
      amount,
      active: localCost.active,
      notes: localCost.notes,
      payment_day: localCost.payment_day,
      updated_at: now,
    };

    let result = editingFixedCostId
      ? await supabase
          .from("fixed_costs")
          .update(payload)
          .eq("id", editingFixedCostId)
          .eq("workshop_id", workshopId)
          .select(FIXED_COST_SELECT_FULL)
          .single()
      : await supabase
          .from("fixed_costs")
          .insert({
            id: localCost.id,
            created_at: localCost.created_at,
            ...payload,
          })
          .select(FIXED_COST_SELECT_FULL)
          .single();

    if (result.error && isMissingColumnError(result.error, "payment_day")) {
      const { payment_day: _removed, ...legacyPayload } = payload;
      result = editingFixedCostId
        ? await supabase
            .from("fixed_costs")
            .update(legacyPayload)
            .eq("id", editingFixedCostId)
            .eq("workshop_id", workshopId)
            .select(FIXED_COST_SELECT_LEGACY)
            .single()
        : await supabase
            .from("fixed_costs")
            .insert({
              id: localCost.id,
              created_at: localCost.created_at,
              ...legacyPayload,
            })
            .select(FIXED_COST_SELECT_LEGACY)
            .single();

      if (!result.error) {
        setError(
          "Custo salvo. Para gerar despesas automáticas, execute a migration 016 no Supabase (coluna payment_day)."
        );
      }
    }

    setSavingFixedCost(false);

    if (result.error && !result.data) {
      setFixedCostError(result.error.message);
      const reverted = existingCost
        ? sortFixedCosts([
            ...fixedCostsRef.current.filter((cost) => cost.id !== localCost.id),
            existingCost,
          ])
        : fixedCostsRef.current.filter((cost) => cost.id !== localCost.id);
      fixedCostsRef.current = reverted;
      writeStoredFixedCosts(reverted);
      setFixedCosts(reverted);
      if (!existingCost) {
        writeStoredPaymentDay(localCost.id, null);
      }
      return;
    }

    const savedCost = applyStoredPaymentDays([
      result.data
        ? normalizeFixedCost({
            ...(result.data as Record<string, unknown>),
            payment_day:
              (result.data as Record<string, unknown>).payment_day ??
              localCost.payment_day,
          })
        : localCost,
    ])[0];
    writeStoredPaymentDay(savedCost.id, savedCost.payment_day);

    setFixedCosts((prev) => {
      const nextCosts = sortFixedCosts([
        ...prev.filter((cost) => cost.id !== localCost.id && cost.id !== savedCost.id),
        savedCost,
      ]);
      fixedCostsRef.current = nextCosts;
      writeStoredFixedCosts(nextCosts);
      return nextCosts;
    });

    if (savedCost.kind === "real" && savedCost.active && savedCost.payment_day) {
      const synced = await syncFixedCostExpenses(
        supabase,
        workshopId,
        [savedCost],
        transactions
      );
      if (synced.length > 0) {
        setTransactions((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]));
          synced.forEach((item) => byId.set(item.id, item));
          return Array.from(byId.values());
        });
      }
    }

    resetFixedCostForm();
  }

  async function handleToggleFixedCost(cost: FixedCost) {
    const nextCost = {
      ...cost,
      active: !cost.active,
      updated_at: new Date().toISOString(),
    };

    setFixedCosts((prev) => {
      const next = prev.map((item) => (item.id === cost.id ? nextCost : item));
      fixedCostsRef.current = next;
      writeStoredFixedCosts(next);
      return next;
    });

    await supabase
      .from("fixed_costs")
      .update({ active: nextCost.active, updated_at: nextCost.updated_at })
      .eq("id", cost.id)
      .eq("workshop_id", cost.workshop_id);

    if (
      nextCost.active &&
      nextCost.kind === "real" &&
      nextCost.payment_day &&
      workshopId
    ) {
      const synced = await syncFixedCostExpenses(
        supabase,
        workshopId,
        [nextCost],
        transactions
      );
      if (synced.length > 0) {
        setTransactions((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]));
          synced.forEach((item) => byId.set(item.id, item));
          return Array.from(byId.values());
        });
      }
    }
  }

  function requestDeleteFixedCost(cost: FixedCost) {
    setDeleteConfirm({ type: "fixedCost", cost });
  }

  async function executeDeleteFixedCost(cost: FixedCost) {
    setDeletingFinanceItem(true);

    try {
      setFixedCosts((prev) => {
        const next = prev.filter((item) => item.id !== cost.id);
        fixedCostsRef.current = next;
        writeStoredFixedCosts(next);
        writeStoredPaymentDay(cost.id, null);
        return next;
      });

      await supabase
        .from("fixed_costs")
        .delete()
        .eq("id", cost.id)
        .eq("workshop_id", cost.workshop_id);

      if (editingFixedCostId === cost.id) {
        resetFixedCostForm();
      }

      setDeleteConfirm(null);
    } finally {
      setDeletingFinanceItem(false);
    }
  }

  function requestDeleteTransaction(entry: FinanceEntry) {
    setDeleteConfirm({ type: "transaction", entry });
  }

  async function executeDeleteTransaction(
    entry: FinanceEntry,
    revertAppointment: boolean
  ) {
    setDeletingFinanceItem(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", entry.id);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      if (revertAppointment && entry.serviceOrderId) {
        const { error: orderError } = await supabase
          .from("service_orders")
          .update({
            status: "aberta",
            completed_at: null,
          })
          .eq("id", entry.serviceOrderId);

        if (orderError) {
          setError(orderError.message);
        } else {
          setOrders((prev) =>
            prev.filter((order) => order.id !== entry.serviceOrderId)
          );
        }
      }

      setTransactions((prev) =>
        prev.filter((transaction) => transaction.id !== entry.id)
      );
      setDeleteConfirm(null);
    } finally {
      setDeletingFinanceItem(false);
    }
  }

  function handleDeleteFixedCost(cost: FixedCost) {
    requestDeleteFixedCost(cost);
  }

  function handleDeleteTransaction(entry: FinanceEntry) {
    requestDeleteTransaction(entry);
  }

  return (
    <div
      className="space-y-6"
      style={
        {
          "--finance-revenue": "#16a34a",
          "--finance-revenue-soft": "rgba(22, 163, 74, 0.12)",
        } as React.CSSProperties
      }
    >
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Receita do mês"
          value={formatCurrency(monthRevenueTotal)}
          detail="OS concluídas + lançamentos manuais"
          icon={<TrendUp size={24} weight={FINANCE_ICON_WEIGHT} aria-hidden />}
          tone="success"
          onClick={() => setActiveTab("revenues")}
        />
        <SummaryCard
          title="Despesas do mês"
          value={formatCurrency(monthExpenseTotal)}
          detail="Gastos lançados"
          icon={<TrendDown size={24} weight={FINANCE_ICON_WEIGHT} aria-hidden />}
          tone="danger"
          onClick={() => setActiveTab("expenses")}
        />
        <SummaryCard
          title="Lucro líquido"
          value={formatCurrency(monthProfit)}
          detail="Receita menos despesas"
          icon={<Wallet size={24} weight={FINANCE_ICON_WEIGHT} aria-hidden />}
          tone="primary"
          valueTone={monthProfit >= 0 ? "success" : "danger"}
          onClick={() => setActiveTab("overview")}
        />
        <SummaryCard
          title="Comparativo"
          value={formatPercent(monthGrowth)}
          detail="Vs. mês anterior"
          icon={<ChartLineUp size={24} weight={FINANCE_ICON_WEIGHT} aria-hidden />}
          tone="muted"
          valueTone={growthPositive ? "success" : "danger"}
          onClick={() => setActiveTab("overview")}
        />
      </div>

      <div className="rounded-lg border border-border bg-card shadow-card p-1.5 shadow-card">
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-primary text-white shadow-card"
                  : "text-muted hover:bg-background hover:text-foreground hover:shadow-card"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card shadow-card py-16 text-center text-sm text-muted shadow-card">
          Carregando financeiro...
        </div>
      ) : (
        <>
          {activeTab === "overview" && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-6">
                <section className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <CalendarCheck size={20} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Resumo do dia
                      </h2>
                      <p className="text-sm text-muted">
                        Serviços finalizados e resultado de hoje.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-background px-4 py-3">
                      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted">
                        <ListChecks size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Serviços
                      </p>
                      <p className="mt-1 currency-display text-foreground">
                        {todayOrders.length}
                      </p>
                    </div>
                    <div className="rounded-lg bg-background px-4 py-3">
                      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted">
                        <ArrowUp size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Receita
                      </p>
                      <p className="mt-1 currency-display text-success">
                        {formatCurrency(todayRevenue)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-background px-4 py-3">
                      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted">
                        <Wallet size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Lucro
                      </p>
                      <p className={`mt-1 currency-display ${todayProfit >= 0 ? "text-success" : "text-danger"}`}>
                        {formatCurrency(todayProfit)}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
                        <ChartBar size={20} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold text-foreground">
                          Receita vs despesa
                        </h2>
                        <p className="text-sm text-muted">
                          {chartIntervalOptions.find((o) => o.value === overviewChartInterval)?.title ?? ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
                      {chartIntervalOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setOverviewChartInterval(opt.value)}
                          className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                            overviewChartInterval === opt.value
                              ? "bg-primary text-white shadow-sm"
                              : "text-muted hover:text-foreground"
                          }`}
                          aria-pressed={overviewChartInterval === opt.value}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <RevenueExpenseChart
                    data={overviewChartData}
                    maxValue={overviewChartMaxValue}
                    compact
                  />
                </section>

                <section className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ChartDonut size={20} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Serviços que mais geram receita
                      </h2>
                      <p className="text-sm text-muted">Com base nas OS finalizadas.</p>
                    </div>
                  </div>
                  {serviceRanking.length > 0 ? (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-[160px_1fr] sm:items-center">
                      <svg viewBox="0 0 120 120" className="mx-auto h-40 w-40 -rotate-90">
                        <circle cx="60" cy="60" r="44" fill="none" stroke="#e2e8f0" strokeWidth="18" />
                        {donutSegments.map((segment, index) => (
                          <circle
                            key={segment.name}
                            cx="60" cy="60" r="44" fill="none"
                            stroke={DONUT_COLORS[index % DONUT_COLORS.length]}
                            strokeWidth="18"
                            strokeDasharray={`${segment.dash} ${100 - segment.dash}`}
                            strokeDashoffset={segment.offset}
                            pathLength="100"
                          />
                        ))}
                      </svg>
                      <div className="space-y-3">
                        {serviceRanking.map((item, index) => (
                          <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg bg-background px-4 py-3">
                            <span className="flex min-w-0 items-center gap-2.5 truncate text-sm font-semibold text-foreground">
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }}
                              />
                              {index + 1}. {item.name}
                            </span>
                            <span className="shrink-0 text-sm font-bold text-foreground">
                              {formatCurrency(item.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border bg-background px-4 py-10 text-center text-sm text-muted">
                      Nenhum serviço finalizado para gerar o gráfico.
                    </p>
                  )}
                </section>

              </div>

              <div className="sticky top-4 self-start space-y-4">
              <button
                type="button"
                onClick={() => setActiveTab("revenues")}
                className="w-full cursor-pointer rounded-lg border border-border bg-card p-5 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Ver todas as receitas"
              >
                <h2 className="text-lg font-semibold text-foreground">
                  Últimas receitas
                </h2>
                <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background shadow-card/50">
                  {revenueEntries.slice(0, 5).map((entry) => {
                    const displayName = entry.clientName ?? "Receita manual";
                    const displayDetail =
                      entry.kind === "automatic" && entry.serviceName
                        ? entry.serviceName
                        : entry.description;
                    const badgeLabel =
                      entry.kind === "automatic" ? entry.category : "Manual";

                    return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 bg-card/70 px-4 py-3 transition-colors hover:bg-card"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white">
                          {getInitial(displayName)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {displayName}
                            </p>
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                                entry.kind === "automatic"
                                  ? "bg-success/10 text-success"
                                  : "bg-primary/10 text-primary"
                              }`}
                            >
                              {badgeLabel}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {displayDetail} • {formatShortDate(entry.date)}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-success">
                        {formatCurrency(entry.amount)}
                      </span>
                    </div>
                    );
                  })}
                  {revenueEntries.length === 0 && (
                    <p className="bg-background px-4 py-6 text-center text-sm text-muted">
                      Nenhuma receita registrada.
                    </p>
                  )}
                </div>
              </button>

                <section className="rounded-lg border border-border bg-card p-4 shadow-card">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
                      <Trophy size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">Ranking de clientes</h2>
                      <p className="text-xs text-muted">Clientes que mais gastaram.</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {clientRanking.length > 0 ? (
                      clientRanking.map((client, index) => (
                        <div key={client.name} className="flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-2">
                          <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                            {index + 1}. {client.name}
                          </span>
                          <span className="shrink-0 text-xs font-bold text-success">
                            {formatCurrency(client.amount)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-center text-xs text-muted">Nenhum cliente com receita finalizada.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === "revenues" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Receitas
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Consulte receitas da agenda e lançamentos manuais.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="success"
                  onClick={() => {
                    resetForm("receita");
                    setShowRevenueForm(true);
                    setRevenueError(null);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  Nova receita
                </Button>
              </div>
              {showRevenueForm && (
                <TransactionFormCard
                  title={editingRevenueId ? "Editar receita" : "Lançar receita manual"}
                  description={
                    editingRevenueId
                      ? "Atualize os dados do lançamento selecionado."
                      : "Use para gorjetas, receitas avulsas ou ajustes."
                  }
                  form={revenueForm}
                  categories={revenueCategoryOptions}
                  loading={savingRevenue}
                  error={revenueError}
                  buttonLabel={editingRevenueId ? "Atualizar receita" : "Salvar receita"}
                  onChange={(patch) => setRevenueForm((prev) => ({ ...prev, ...patch }))}
                  onSubmit={(event) => handleSaveManualTransaction(event, "receita")}
                  onCancel={() => closeManualForm("receita")}
                />
              )}
              <TransactionList
                entries={filteredRevenueEntries}
                emptyMessage="Nenhuma receita encontrada."
                groupByMonth={revenuePeriod !== "all"}
                onEditTransaction={handleEditRevenue}
                onChangePaymentStatus={handleChangePaymentStatus}
                onUpdateNotes={handleUpdateTransactionNotes}
                filter={
                  <InlineFilterButton
                    value={revenuePeriod}
                    customStart={revenueCustomStart}
                    customEnd={revenueCustomEnd}
                    category={revenueCategoryFilter}
                    categoryOptions={revenueCategoryFilterOptions}
                    open={showRevenueFilter}
                    onToggle={() => setShowRevenueFilter(true)}
                    onClose={() => setShowRevenueFilter(false)}
                    onChange={setRevenuePeriod}
                    onCustomStartChange={setRevenueCustomStart}
                    onCustomEndChange={setRevenueCustomEnd}
                    onCategoryChange={setRevenueCategoryFilter}
                    onClear={() => {
                      setRevenuePeriod("all");
                      setRevenueCustomStart(dateKey(startOfMonth(today)));
                      setRevenueCustomEnd(dateKey(today));
                      setRevenueCategoryFilter(categoryFilterAll);
                    }}
                    ariaLabel="Filtros de receitas"
                  />
                }
                onDeleteTransaction={handleDeleteTransaction}
              />
            </div>
          )}

          {activeTab === "expenses" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Despesas
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Consulte gastos e registre novos lançamentos manuais.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="success"
                  onClick={() => {
                    resetForm("despesa");
                    setShowExpenseForm(true);
                    setExpenseError(null);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  Nova despesa
                </Button>
              </div>
              {showExpenseForm && (
                <TransactionFormCard
                  title={editingExpenseId ? "Editar despesa" : "Lançar despesa"}
                  description={
                    editingExpenseId
                      ? "Atualize os dados do lançamento selecionado."
                      : "Registre compras, custos fixos e investimentos."
                  }
                  form={expenseForm}
                  categories={expenseCategoryOptions}
                  supplierOptions={expenseSupplierOptions}
                  loading={savingExpense}
                  error={expenseError}
                  buttonLabel={editingExpenseId ? "Atualizar despesa" : "Salvar despesa"}
                  onChange={(patch) => setExpenseForm((prev) => ({ ...prev, ...patch }))}
                  onSubmit={(event) => handleSaveManualTransaction(event, "despesa")}
                  onCancel={() => closeManualForm("despesa")}
                />
              )}
              <TransactionList
                entries={filteredExpenseEntries}
                emptyMessage="Nenhuma despesa registrada"
                emptyDescription="Use o botão + Nova despesa para adicionar um lançamento manual."
                accent="expense"
                filter={
                  <InlineFilterButton
                    value={expensePeriod}
                    customStart={expenseCustomStart}
                    customEnd={expenseCustomEnd}
                    category={expenseCategoryFilter}
                    categoryOptions={expenseCategoryFilterOptions}
                    supplier={expenseSupplierFilter}
                    supplierOptions={expenseSupplierFilterOptions}
                    open={showExpenseFilter}
                    onToggle={() => setShowExpenseFilter(true)}
                    onClose={() => setShowExpenseFilter(false)}
                    onChange={setExpensePeriod}
                    onCustomStartChange={setExpenseCustomStart}
                    onCustomEndChange={setExpenseCustomEnd}
                    onCategoryChange={setExpenseCategoryFilter}
                    onSupplierChange={setExpenseSupplierFilter}
                    onClear={() => {
                      setExpensePeriod("all");
                      setExpenseCustomStart(dateKey(startOfMonth(today)));
                      setExpenseCustomEnd(dateKey(today));
                      setExpenseCategoryFilter(categoryFilterAll);
                      setExpenseSupplierFilter(categoryFilterAll);
                    }}
                    ariaLabel="Filtros de despesas"
                  />
                }
                onEditTransaction={handleEditExpense}
                onDeleteTransaction={handleDeleteTransaction}
                onChangePaymentStatus={handleChangePaymentStatus}
                onUpdateNotes={handleUpdateTransactionNotes}
              />
            </div>
          )}

          {activeTab === "fixedCosts" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Custos Fixos
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Custos reais entram como despesa todo mês na data de pagamento escolhida.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Total fixos reais
                  </p>
                  <p className="mt-1 text-xl font-bold text-foreground">
                    {formatCurrency(fixedRealTotal)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Total estimados
                  </p>
                  <p className="mt-1 text-xl font-bold text-primary">
                    {formatCurrency(fixedEstimatedTotal)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Total mensal
                  </p>
                  <p className="mt-1 text-xl font-bold text-foreground">
                    {formatCurrency(fixedMonthlyTotal)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                    Custo por lavagem
                  </p>
                  <p className="mt-1 text-xl font-bold text-success">
                    {formatCurrency(fixedCostPerWash)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-muted">
                    {monthlyWashCount} {monthlyWashCount === 1 ? "lavagem" : "lavagens"} no mês
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="success"
                  onClick={() => {
                    setEditingFixedCostId(null);
                    setFixedCostForm(initialFixedCostForm);
                    setFixedCostError(null);
                    setShowFixedCostForm(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  Novo custo
                </Button>
              </div>

              {showFixedCostForm && (
                <form
                  onSubmit={handleSaveFixedCost}
                  autoComplete="off"
                  className="finance-manual-form-enter rounded-lg border border-border bg-card shadow-card p-4 shadow-card sm:p-5"
                >
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-foreground">
                      {editingFixedCostId ? "Editar custo fixo" : "Novo custo fixo"}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Custos reais geram despesa automática todo mês na data de pagamento.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Input
                      label="Nome"
                      value={fixedCostForm.name}
                      onChange={(event) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Aluguel"
                    />
                    <Dropdown
                      label="Tipo"
                      value={fixedCostForm.kind}
                      options={[
                        { value: "real", label: "Custo Fixo Real" },
                        { value: "estimated", label: "Média Estimada" },
                      ]}
                      onChange={(kind) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          kind: kind as FixedCostKind,
                        }))
                      }
                    />
                    <Input
                      label="Valor mensal"
                      prefix="R$"
                      value={fixedCostForm.amount}
                      onChange={(event) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="250,00"
                    />
                    {fixedCostForm.kind === "real" && (
                      <Dropdown
                        label="Dia de pagamento"
                        value={fixedCostForm.paymentDay}
                        options={paymentDayOptions}
                        onChange={(paymentDay) =>
                          setFixedCostForm((prev) => ({
                            ...prev,
                            paymentDay,
                          }))
                        }
                      />
                    )}
                    <Input
                      label={
                        fixedCostForm.kind === "estimated"
                          ? "Observação"
                          : "Observação (opcional)"
                      }
                      value={fixedCostForm.notes}
                      onChange={(event) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder={
                        fixedCostForm.kind === "estimated"
                          ? "Baseado nos últimos 3 meses"
                          : "Contrato, vencimento, referência..."
                      }
                    />
                  </div>
                  {fixedCostError && (
                    <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                      {fixedCostError}
                    </p>
                  )}
                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={resetFixedCostForm}
                      className="w-full sm:w-auto"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      variant="success"
                      loading={savingFixedCost}
                      className="w-full sm:w-auto"
                    >
                      <LucidePlus className="h-4 w-4" />
                      {editingFixedCostId ? "Atualizar custo" : "Salvar custo"}
                    </Button>
                  </div>
                </form>
              )}

              <div className="w-full overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className="grid grid-cols-[minmax(200px,1fr)_110px_110px_120px_110px_112px] gap-4 border-b border-border px-3 py-3 text-xs font-semibold text-muted">
                    <span>Nome</span>
                    <span>Tipo</span>
                    <span>Dia</span>
                    <span>Valor</span>
                    <span>Status</span>
                    <span className="text-right">Ações</span>
                  </div>
                  {fixedCosts.length === 0 ? (
                    <p className="px-3 py-10 text-center text-sm font-semibold text-muted">
                      Nenhum custo fixo cadastrado
                    </p>
                  ) : (
                    fixedCosts.map((cost) => (
                      <article
                        key={cost.id}
                        className="grid grid-cols-[minmax(200px,1fr)_110px_110px_120px_110px_112px] items-center gap-4 border-b border-border/70 px-3 py-3 transition-colors hover:bg-background/70"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {cost.name}
                            </p>
                            {cost.kind === "estimated" && (
                              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                                Estimado
                              </span>
                            )}
                          </div>
                          {cost.notes && (
                            <p className="mt-1 truncate text-xs text-muted">
                              {cost.notes}
                            </p>
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {cost.kind === "real" ? "Real" : "Média"}
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {cost.kind === "real" && cost.payment_day
                            ? `Dia ${cost.payment_day}`
                            : "—"}
                        </p>
                        <p className="text-sm font-bold text-foreground">
                          {formatCurrency(toCurrencyNumber(cost.amount))}
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleToggleFixedCost(cost)}
                          className={`w-fit rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                            cost.active
                              ? "bg-success/10 text-success hover:bg-success hover:text-white"
                              : "bg-muted/10 text-muted hover:bg-background hover:text-foreground"
                          }`}
                        >
                          {cost.active ? "Ativo" : "Inativo"}
                        </button>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditFixedCost(cost)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
                            aria-label={`Editar ${cost.name}`}
                            title="Editar custo"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteFixedCost(cost)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                            aria-label={`Excluir ${cost.name}`}
                            title="Excluir custo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .finance-manual-form-enter {
            animation: finance-manual-form-enter 180ms ease-out both;
            transform-origin: top center;
          }
        }

        @keyframes finance-manual-form-enter {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .finance-inline-filter-card {
            transition: none !important;
          }
        }
      `}</style>

      <ConfirmDialog
        open={deleteConfirm?.type === "fixedCost"}
        title="Excluir custo fixo"
        description={
          deleteConfirm?.type === "fixedCost"
            ? `Deseja excluir ${deleteConfirm.cost.name}?`
            : ""
        }
        confirmLabel="Excluir custo"
        loading={deletingFinanceItem}
        onCancel={() => {
          if (!deletingFinanceItem) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "fixedCost") {
            void executeDeleteFixedCost(deleteConfirm.cost);
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "transaction"}
        title="Excluir lançamento"
        description={
          deleteConfirm?.type === "transaction"
            ? deleteConfirm.entry.kind === "automatic"
              ? "Deseja apagar esta receita gerada pela Agenda?"
              : "Deseja apagar este lançamento?"
            : ""
        }
        confirmLabel="Excluir lançamento"
        loading={deletingFinanceItem}
        onCancel={() => {
          if (!deletingFinanceItem) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type !== "transaction") return;

          const entry = deleteConfirm.entry;
          if (entry.kind === "automatic" && entry.serviceOrderId) {
            setDeleteConfirm({ type: "revertAppointment", entry });
            return;
          }

          void executeDeleteTransaction(entry, false);
        }}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "revertAppointment"}
        title="Reverter agendamento"
        description="Deseja também reverter o status do agendamento para Pendente?"
        confirmLabel="Reverter agendamento"
        cancelLabel="Não, só excluir"
        loading={deletingFinanceItem}
        onCancel={() => {
          if (deleteConfirm?.type === "revertAppointment" && !deletingFinanceItem) {
            void executeDeleteTransaction(deleteConfirm.entry, false);
          }
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "revertAppointment") {
            void executeDeleteTransaction(deleteConfirm.entry, true);
          }
        }}
      />
    </div>
  );
}
