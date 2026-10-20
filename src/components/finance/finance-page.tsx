"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowsClockwise,
  ArrowUp,
  CalendarBlank,
  CaretLeft,
  CalendarCheck,
  CaretDown,
  CaretRight,
  CaretUp,
  CaretUpDown,
  ChartBar,
  ChartLine,
  ChartDonut,
  ChartLineUp,
  Check,
  CheckCircle,
  FileText,
  Package,
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
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import {
  ClipboardList,
  Pencil,
  Plus as LucidePlus,
  Trash2,
} from "lucide-react";
import { ConfirmPaidDialog, TransferDialog } from "@/components/finance/cashflow-dialogs";
import { AccountsPanel, type AccountStatementLine } from "@/components/finance/accounts-panel";
import { CategoryManagerDialog } from "@/components/finance/category-manager";
import { UpcomingDuesSection } from "@/components/finance/upcoming-dues";
import { CashflowProjectionPanel } from "@/components/finance/cashflow-projection";
import {
  RevenueExpenseChart,
  type ChartMode,
} from "@/components/finance/revenue-expense-chart";
import { NfseDialog, type NfseInvoice } from "@/components/finance/nfse-dialog";
import { SupplierQuickForm } from "@/components/suppliers/supplier-quick-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { formatCurrency } from "@/lib/utils/format";
import {
  defaultAccountId,
  loadFinancialAccounts,
  saveFinancialAccount,
  setDefaultFinancialAccount,
} from "@/lib/finance/accounts";
import { accountBalance, cashDate as cashflowDate, isPaidCashStatus, sumPaidRevenueInRange } from "@/lib/finance/cash";
import {
  inDueAlertWindow,
  INSTALLMENT_PERIODS,
  addPeriodToDateKey,
  installmentBaseDescription,
  type InstallmentPeriod,
  isOverdue,
  splitInstallmentAmounts,
  todayDateKey,
} from "@/lib/finance/due";
import {
  categoriesOfType,
  loadFinancialCategories,
  matchCategoryId,
  saveFinancialCategory,
} from "@/lib/finance/categories";
import { resolveDefaultCashflowIds } from "@/lib/finance/transactions";
import {
  FIXED_COST_CATEGORY_NAME,
  type FinancialAccount,
  type FinancialCategory,
  type FinancialTransfer,
} from "@/lib/finance/types";

type FinanceTab = "overview" | "revenues" | "expenses" | "fixedCosts" | "cash";
/** Sobrou para os intervalos fixos da visão geral; o filtro usa DateGranularity. */
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
  category_id: string | null;
  account_id: string | null;
  service_order_id: string | null;
  supplier_id: string | null;
  product_id: string | null;
  source: string | null;
  payment_status: PaymentStatus;
  notes: string | null;
  items: unknown;
  invoice_number: string | null;
  transaction_date: string;
  effective_date: string | null;
  due_date: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
  /** Nome de fachada; é ele que aparece nas listas quando existe. */
  trade_name?: string | null;
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

    return (JSON.parse(stored) as Supplier[])
      .filter((supplier) => supplier.id && supplier.name)
      .map((supplier) => ({
        id: supplier.id,
        name: supplier.name,
        trade_name: supplier.trade_name ?? null,
      }));
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
      payment_day: cost.payment_day ?? existing.payment_day,
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
  kind: "automatic" | "fixed" | "manual";
  type: TransactionType;
  description: string;
  amount: number;
  category: string;
  categoryId?: string;
  accountId?: string;
  date: string;
  effectiveDate?: string | null;
  dueDate?: string | null;
  createdAt: string;
  clientName?: string;
  serviceName?: string;
  supplierId?: string;
  supplierName?: string;
  source?: string;
  serviceOrderId?: string;
  paymentStatus?: PaymentStatus;
  notes?: string;
  items?: TransactionItem[];
  invoiceNumber?: string;
  installmentGroupId?: string | null;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
}

type FinanceDeleteConfirm =
  | { type: "fixedCost"; cost: FixedCost }
  | { type: "transaction"; entry: FinanceEntry }
  | { type: "revertAppointment"; entry: FinanceEntry }
  | { type: "installmentGroup"; entry: FinanceEntry; remaining: FinanceEntry[] }
  | { type: "wholeInstallment"; entries: FinanceEntry[] }
  | null;

/** Linha de uma nota: o que foi comprado, quantos e por quanto cada um. */
interface TransactionItem {
  /** Só para a key do React; não vai para o banco. */
  uiKey: string;
  description: string;
  quantity: string;
  unitAmount: string;
  /** Produto do estoque, quando a linha veio de lá. Vazio: item avulso. */
  productId: string;
  volumeMl: string;
}

/** O que o lançamento precisa saber do estoque — não o cadastro inteiro. */
interface StockProduct {
  id: string;
  name: string;
  volumeMl: string;
  totalCost: string;
  stockRemaining: string;
}

interface TransactionForm {
  description: string;
  amount: string;
  invoiceNumber: string;
  items: TransactionItem[];
  notes: string;
  date: string;
  effectiveDate: string;
  dueDate: string;
  categoryId: string;
  accountId: string;
  paymentStatus: PaymentStatus;
  supplierId: string;
  installmentsEnabled: boolean;
  installmentCount: string;
  installmentPeriod: InstallmentPeriod;
  /** As parcelas como ficam na tela: dá para mexer em cada uma antes de salvar. */
  installments: InstallmentDraft[];
}

interface InstallmentDraft {
  uiKey: string;
  dueDate: string;
  amount: string;
  notes: string;
  paid: boolean;
}

/**
 * Monta a tabela de parcelas a partir do total, da quantidade, do intervalo e
 * do primeiro vencimento. O que sobra de centavo vai na última, como em
 * 166,67 + 166,67 + 166,66.
 */
function buildInstallments(
  total: number,
  count: number,
  period: InstallmentPeriod,
  firstDue: string
): InstallmentDraft[] {
  const safeCount = Math.min(Math.max(Math.round(count) || 0, 1), 60);
  return splitInstallmentAmounts(total, safeCount).map((value, index) => ({
    uiKey: `parcela-${index + 1}`,
    dueDate: addPeriodToDateKey(firstDue, period, index),
    amount: formatMoneyInput(value),
    notes: "",
    paid: false,
  }));
}

function sumInstallments(rows: InstallmentDraft[]) {
  return rows.reduce((total, row) => total + (parseFilterAmount(row.amount) ?? 0), 0);
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
  { id: "cash", label: "Caixa" },
];

const categoryFilterAll = "all";
const unassignedAccountFilter = "__sem_conta__";

type TransactionSortKey = "description" | "label" | "date" | "amount" | "status";
type SummaryBucket = "overdue" | "settled" | "upcoming";
type TransactionSort = { key: TransactionSortKey; direction: "asc" | "desc" };

const PAYMENT_STATUS_ORDER: Record<string, number> = {
  pendente: 0,
  parcial: 1,
  pago: 2,
  cancelado: 3,
};

/** A data que a linha mostra: vencimento quando existe, senão o lançamento. */
function sortableDate(entry: FinanceEntry) {
  return entry.dueDate || entry.date;
}

function compareEntries({ key, direction }: TransactionSort) {
  const factor = direction === "asc" ? 1 : -1;
  return (a: FinanceEntry, b: FinanceEntry) => {
    let result = 0;
    if (key === "amount") {
      result = a.amount - b.amount;
    } else if (key === "date") {
      result = sortableDate(a).localeCompare(sortableDate(b));
    } else if (key === "status") {
      result =
        (PAYMENT_STATUS_ORDER[a.paymentStatus ?? "pago"] ?? 9) -
        (PAYMENT_STATUS_ORDER[b.paymentStatus ?? "pago"] ?? 9);
    } else if (key === "label") {
      result = (a.supplierName ?? a.category ?? "").localeCompare(
        b.supplierName ?? b.category ?? "",
        "pt-BR"
      );
    } else {
      result = (a.clientName ?? a.description).localeCompare(
        b.clientName ?? b.description,
        "pt-BR"
      );
    }
    return result * factor;
  };
}

/** Fornecedor pelo nome de fachada; a razão social é o que sobra no cadastro. */
function supplierDisplayName(
  supplier: { name: string; trade_name?: string | null } | undefined
) {
  if (!supplier) return "Fornecedor removido";
  return supplier.trade_name?.trim() || supplier.name;
}

function matchesAccountFilter(entry: FinanceEntry, filter: string) {
  if (filter === categoryFilterAll) return true;
  if (filter === unassignedAccountFilter) return !entry.accountId;
  return entry.accountId === filter;
}

/**
 * Tudo que dá para perguntar sobre um lançamento. Um objeto só em vez de um
 * estado por campo: eram onze states e onze props espalhados entre receitas e
 * despesas, e cada filtro novo multiplicava os dois lados.
 */
type FinanceFilterState = {
  granularity: DateGranularity;
  /** Um dia qualquer dentro do período visível; as setas andam com ele. */
  anchor: string;
  /** Qual data o período compara: lançamento, vencimento ou pagamento. */
  dateField: "date" | "dueDate" | "effectiveDate";
  customStart: string;
  customEnd: string;
  search: string;
  status: string;
  origin: string;
  category: string;
  account: string;
  /** Fornecedor nas despesas, cliente nas receitas. */
  party: string;
  minAmount: string;
  maxAmount: string;
};

const financeStatusFilterOptions = [
  { value: categoryFilterAll, label: "Todos" },
  { value: "pendente", label: "Pendente" },
  { value: "vencido", label: "Vencido" },
  { value: "pago", label: "Pago" },
  { value: "parcial", label: "Parcial" },
  { value: "cancelado", label: "Cancelado" },
];

const financeOriginFilterOptions = [
  { value: categoryFilterAll, label: "Todas" },
  { value: "automatic", label: "Agenda" },
  { value: "fixed", label: "Custo fixo" },
  { value: "manual", label: "Manual" },
];

function createFinanceFilterState(
  customStart: string,
  customEnd: string,
  /** Despesa é conta a pagar, então a pergunta padrão dela é o vencimento.
   *  Receita nasce de serviço prestado: a data que importa é o lançamento. */
  dateField: FinanceFilterState["dateField"] = "date"
): FinanceFilterState {
  return {
    granularity: "all",
    anchor: customEnd,
    dateField,
    customStart,
    customEnd,
    search: "",
    status: categoryFilterAll,
    origin: categoryFilterAll,
    category: categoryFilterAll,
    account: categoryFilterAll,
    party: categoryFilterAll,
    minAmount: "",
    maxAmount: "",
  };
}

/**
 * Mesma convenção do resto do app (parseCurrencyInput): ponto é separador de
 * milhar e vírgula é decimal, então "1.000" é mil e não um. Diferença é que
 * aqui campo vazio ou rabisco devolve null em vez de estourar — é filtro, não
 * formulário.
 */
function parseFilterAmount(value: string) {
  const cleaned = value.trim().replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Quantos filtros estão valendo — vira o contador no botão do funil. */
function countActiveFinanceFilters(filters: FinanceFilterState) {
  return [
    filters.granularity !== "all",
    Boolean(filters.search.trim()),
    filters.status !== categoryFilterAll,
    filters.origin !== categoryFilterAll,
    filters.category !== categoryFilterAll,
    filters.account !== categoryFilterAll,
    filters.party !== categoryFilterAll,
    parseFilterAmount(filters.minAmount) !== null,
    parseFilterAmount(filters.maxAmount) !== null,
  ].filter(Boolean).length;
}

function matchesFinanceFilter(
  entry: FinanceEntry,
  filters: FinanceFilterState,
  range: { start: Date; end: Date },
  todayKeyValue: string,
  partyOf: (entry: FinanceEntry) => string | undefined
) {
  if (filters.granularity !== "all") {
    const basis =
      filters.dateField === "dueDate"
        ? entry.dueDate
        : filters.dateField === "effectiveDate"
          ? entry.effectiveDate
          : entry.date;
    // Sem a data escolhida o lançamento não cabe no período: uma conta sem
    // vencimento não entra num filtro por vencimento.
    if (!basis || !isDateInRange(basis, range)) return false;
  }

  if (
    filters.category !== categoryFilterAll &&
    entry.category !== filters.category
  ) {
    return false;
  }

  if (!matchesAccountFilter(entry, filters.account)) return false;

  if (filters.party !== categoryFilterAll && partyOf(entry) !== filters.party) {
    return false;
  }

  if (filters.origin !== categoryFilterAll && entry.kind !== filters.origin) {
    return false;
  }

  if (filters.status !== categoryFilterAll) {
    // "Vencido" não é um status gravado: é pendente com vencimento no passado.
    if (filters.status === "vencido") {
      const overdue = isOverdue(
        { payment_status: entry.paymentStatus, due_date: entry.dueDate },
        todayKeyValue
      );
      if (!overdue) return false;
    } else if (entry.paymentStatus !== filters.status) {
      return false;
    }
  }

  const min = parseFilterAmount(filters.minAmount);
  if (min !== null && entry.amount < min) return false;
  const max = parseFilterAmount(filters.maxAmount);
  if (max !== null && entry.amount > max) return false;

  const term = filters.search.trim().toLowerCase();
  if (term) {
    const haystack = [
      entry.description,
      entry.clientName,
      entry.serviceName,
      entry.supplierName,
      entry.category,
      entry.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(term)) return false;
  }

  return true;
}
const FINANCE_ICON_WEIGHT = "light" as const;
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
  effectiveDate: dateKey(new Date()),
  dueDate: dateKey(new Date()),
  categoryId: "",
  accountId: "",
  paymentStatus: "pago",
  supplierId: categoryFilterAll,
  installmentsEnabled: false,
  installmentCount: "3",
  installmentPeriod: "mensal",
  installments: [],
  invoiceNumber: "",
  items: [],
  notes: "",
};

const initialExpenseForm: TransactionForm = {
  description: "",
  amount: "",
  date: dateKey(new Date()),
  effectiveDate: dateKey(new Date()),
  dueDate: dateKey(new Date()),
  categoryId: "",
  accountId: "",
  paymentStatus: "pago",
  supplierId: categoryFilterAll,
  installmentsEnabled: false,
  installmentCount: "3",
  installmentPeriod: "mensal",
  installments: [],
  invoiceNumber: "",
  items: [],
  notes: "",
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

const FIXED_COST_GRID_COLUMNS = "minmax(0, 1fr) 88px 80px 136px 88px 72px";

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

/** Violação de índice único no Postgres. */
function isDuplicateRowError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "23505" ||
    (error.message ?? "").toLowerCase().includes("duplicate key")
  );
}

function isFixedCostSource(source: string | null | undefined) {
  return Boolean(source?.startsWith("fixed_cost:"));
}

function getFixedCostTransactionsBySource(transactions: FinancialTransaction[]) {
  return new Map(
    transactions
      .filter((tx) => tx.source?.startsWith("fixed_cost:"))
      .map((tx) => [tx.source as string, tx])
  );
}

function getPendingEstimatedLaunch(
  cost: FixedCost,
  existingSources: Map<string, unknown>,
  today: Date
) {
  if (!cost.active || cost.kind !== "estimated" || !cost.payment_day) return null;

  const createdAt = cost.created_at ? new Date(cost.created_at) : today;

  for (let offset = 11; offset >= 0; offset -= 1) {
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
    if (!existingSources.has(source)) {
      return {
        paymentDate,
        source,
        monthLabel: `${getMonthLabel(monthDate)} ${monthDate.getFullYear()}`,
      };
    }
  }

  return null;
}

function getLastLaunchedEstimatedAmount(
  cost: FixedCost,
  bySource: Map<string, FinancialTransaction>
) {
  const prefix = `fixed_cost:${cost.id}:`;
  let latestKey = "";
  let latestAmount = 0;

  bySource.forEach((tx, source) => {
    if (!source.startsWith(prefix) || source <= latestKey) return;
    latestKey = source;
    latestAmount = toCurrencyNumber(tx.amount);
  });

  return latestAmount;
}

function formatMoneyInput(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

/**
 * Período por granularidade e navegação, no lugar de "hoje / semana / mês".
 * Escolhe-se o tamanho da janela uma vez e anda-se por ela com as setas, que é
 * como se olha um histórico: não "este mês", e sim "qual mês".
 */
type DateGranularity =
  | "all"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "semester"
  | "year"
  | "custom";

const dateGranularityOptions: { value: DateGranularity; label: string }[] = [
  { value: "all", label: "Todo o período" },
  { value: "day", label: "Diário" },
  { value: "week", label: "Semanal" },
  { value: "month", label: "Mensal" },
  { value: "quarter", label: "Trimestral" },
  { value: "semester", label: "Semestral" },
  { value: "year", label: "Anual" },
  { value: "custom", label: "Personalizado" },
];

function granularityBounds(granularity: DateGranularity, anchor: Date): DateRange {
  const year = anchor.getFullYear();

  if (granularity === "day") {
    return { start: startOfDay(anchor), end: endOfDay(anchor) };
  }
  if (granularity === "week") return getWeekRange(anchor);
  if (granularity === "month") {
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }
  if (granularity === "quarter") {
    const firstMonth = Math.floor(anchor.getMonth() / 3) * 3;
    return {
      start: new Date(year, firstMonth, 1),
      end: endOfMonth(new Date(year, firstMonth + 2, 1)),
    };
  }
  if (granularity === "semester") {
    const firstMonth = anchor.getMonth() < 6 ? 0 : 6;
    return {
      start: new Date(year, firstMonth, 1),
      end: endOfMonth(new Date(year, firstMonth + 5, 1)),
    };
  }
  return {
    start: new Date(year, 0, 1),
    end: endOfMonth(new Date(year, 11, 1)),
  };
}

function resolveDateRange(
  granularity: DateGranularity,
  anchorKey: string,
  customStart: string,
  customEnd: string,
  today: Date
): DateRange {
  if (granularity === "all") {
    return { start: new Date(2000, 0, 1), end: endOfDay(today) };
  }
  if (granularity === "custom") {
    return {
      start: customStart ? startOfDay(parseLocalDate(customStart)) : startOfDay(today),
      end: customEnd ? endOfDay(parseLocalDate(customEnd)) : endOfDay(today),
    };
  }
  return granularityBounds(
    granularity,
    anchorKey ? parseLocalDate(anchorKey) : today
  );
}

/** Quantos meses (ou dias) cada seta anda. */
function shiftAnchor(
  granularity: DateGranularity,
  anchorKey: string,
  direction: 1 | -1,
  today: Date
): string {
  const anchor = anchorKey ? parseLocalDate(anchorKey) : today;

  if (granularity === "day") return dateKey(addDaysTo(anchor, direction));
  if (granularity === "week") return dateKey(addDaysTo(anchor, direction * 7));

  const months =
    granularity === "quarter"
      ? 3
      : granularity === "semester"
        ? 6
        : granularity === "year"
          ? 12
          : 1;
  // Dia 1 para não pular fevereiro quando a âncora é 31.
  return dateKey(
    new Date(anchor.getFullYear(), anchor.getMonth() + direction * months, 1)
  );
}

function addDaysTo(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function dateRangeLabel(
  granularity: DateGranularity,
  anchorKey: string,
  customStart: string,
  customEnd: string,
  today: Date
): string {
  if (granularity === "all") return "Todo o período";
  if (granularity === "custom") {
    const from = customStart ? formatShortDate(customStart) : "início";
    const to = customEnd ? formatShortDate(customEnd) : "hoje";
    return `${from} – ${to}`;
  }

  const anchor = anchorKey ? parseLocalDate(anchorKey) : today;
  const year = anchor.getFullYear();

  if (granularity === "day") return formatShortDate(dateKey(anchor));
  if (granularity === "week") {
    const { start, end } = getWeekRange(anchor);
    return `${formatShortDate(dateKey(start))} – ${formatShortDate(dateKey(end))}`;
  }
  if (granularity === "month") {
    return `${getMonthLabel(anchor)} ${year}`;
  }
  if (granularity === "quarter") {
    return `${Math.floor(anchor.getMonth() / 3) + 1}º tri ${year}`;
  }
  if (granularity === "semester") {
    return `${anchor.getMonth() < 6 ? 1 : 2}º sem ${year}`;
  }
  return String(year);
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

// min = 0 libera lançamento sem valor (serviço trocado, cortesia). Transferência
// e custo fixo continuam exigindo valor — o banco recusa transferência zerada.
function parseMoney(value: string, { min = 0.01 }: { min?: number } = {}) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < min) {
    throw new Error(
      min > 0 ? "Informe um valor maior que zero." : "Informe um valor válido."
    );
  }

  return amount;
}

function parseOptionalMoney(value: string) {
  if (!value.trim()) return 0;
  return parseMoney(value);
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

const TRANSACTION_SELECT_PHASE3 =
  "id, type, description, amount, category, category_id, account_id, service_order_id, supplier_id, product_id, source, payment_status, notes, items, invoice_number, transaction_date, effective_date, due_date, installment_group_id, installment_number, installment_total, created_at";
const TRANSACTION_SELECT_PHASE2 =
  "id, type, description, amount, category, category_id, account_id, service_order_id, supplier_id, product_id, source, payment_status, notes, transaction_date, effective_date, due_date, installment_group_id, installment_number, installment_total, created_at";
const TRANSACTION_SELECT_CASHFLOW =
  "id, type, description, amount, category, category_id, account_id, service_order_id, supplier_id, product_id, source, payment_status, notes, transaction_date, effective_date, created_at";
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
    category_id: (row.category_id as string | null) ?? null,
    account_id: (row.account_id as string | null) ?? null,
    service_order_id: (row.service_order_id as string | null) ?? null,
    supplier_id: (row.supplier_id as string | null) ?? null,
    product_id: (row.product_id as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    payment_status:
      "payment_status" in row
        ? normalizePaymentStatus(row.payment_status)
        : fallback?.payment_status ?? "pago",
    items: row.items ?? [],
    invoice_number:
      typeof row.invoice_number === "string" ? row.invoice_number : null,
    notes:
      "notes" in row
        ? typeof row.notes === "string"
          ? row.notes
          : null
        : fallback?.notes ?? null,
    transaction_date: String(row.transaction_date),
    effective_date: (row.effective_date as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    installment_group_id: (row.installment_group_id as string | null) ?? null,
    installment_number:
      typeof row.installment_number === "number" ? row.installment_number : null,
    installment_total:
      typeof row.installment_total === "number" ? row.installment_total : null,
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
    TRANSACTION_SELECT_PHASE3,
    TRANSACTION_SELECT_PHASE2,
    TRANSACTION_SELECT_CASHFLOW,
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
  const defaults = await resolveDefaultCashflowIds(
    supabase,
    workshopId,
    "despesa",
    FIXED_COST_CATEGORY_NAME
  );
  // Pendente, e não "pago": o sistema sabe que a conta venceu, não que alguém
  // a pagou. Nascer paga escondia a conta da lista de contas a pagar e ainda
  // descontava do saldo um dinheiro que não tinha saído.
  const cashflowInsert = {
    ...(defaults.accountId ? { account_id: defaults.accountId } : {}),
    ...(defaults.categoryId ? { category_id: defaults.categoryId } : {}),
    payment_status: "pendente" as const,
  };

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
          existing.transaction_date !== paymentDate ||
          (!existing.account_id && Boolean(defaults.accountId)) ||
          (!existing.category_id && Boolean(defaults.categoryId));

        if (!needsUpdate) continue;

        const { data, error } = await supabase
          .from("financial_transactions")
          .update({
            description: cost.name,
            amount,
            category: FIXED_COST_CATEGORY_NAME,
            transaction_date: paymentDate,
            source,
            ...(existing.account_id ? {} : cashflowInsert.account_id ? { account_id: cashflowInsert.account_id } : {}),
            ...(existing.category_id ? {} : cashflowInsert.category_id ? { category_id: cashflowInsert.category_id } : {}),
          })
          .eq("id", existing.id)
          .eq("workshop_id", workshopId)
          .select(TRANSACTION_SELECT_PHASE2)
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

      const insertPayload = {
        workshop_id: workshopId,
        type: "despesa" as const,
        description: cost.name,
        amount,
        category: FIXED_COST_CATEGORY_NAME,
        transaction_date: paymentDate,
        source,
        ...cashflowInsert,
        due_date: paymentDate,
      };

      const { data, error } = await supabase
        .from("financial_transactions")
        .insert(insertPayload)
        .select(TRANSACTION_SELECT_PHASE2)
        .single();

      if (error) {
        // 23505: o índice único barrou — outra carga já lançou este mês.
        // Repetir pelo caminho antigo só criaria a duplicata que o índice
        // acabou de impedir.
        if (isDuplicateRowError(error)) continue;

        const legacyInsert = await supabase
          .from("financial_transactions")
          .insert({
            workshop_id: workshopId,
            type: "despesa",
            description: cost.name,
            amount,
            category: FIXED_COST_CATEGORY_NAME,
            transaction_date: paymentDate,
            source,
            payment_status: "pendente",
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
    TRANSACTION_SELECT_PHASE3,
    TRANSACTION_SELECT_PHASE2,
    TRANSACTION_SELECT_CASHFLOW,
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

/**
 * Controle só de datas, separado do funil: escolhe o tamanho da janela e anda
 * por ela com as setas. O funil cuida do resto (status, categoria, valor).
 */
function DateRangeFilter({
  value,
  today,
  onChange,
}: {
  value: FinanceFilterState;
  today: Date;
  onChange: (patch: Partial<FinanceFilterState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigable = value.granularity !== "all" && value.granularity !== "custom";
  const label = dateRangeLabel(
    value.granularity,
    value.anchor,
    value.customStart,
    value.customEnd,
    today
  );

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
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

  function move(direction: 1 | -1) {
    onChange({
      anchor: shiftAnchor(value.granularity, value.anchor, direction, today),
    });
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="Escolher período"
        title="Escolher período"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
          value.granularity === "all"
            ? "text-foreground/70 hover:bg-background hover:text-foreground"
            : "bg-premium/10 text-premium"
        }`}
      >
        <CalendarBlank size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={!navigable}
        aria-label="Período anterior"
        className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <CaretLeft size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      </button>
      {/* first-letter e não capitalize: "Todo o período" não vira "Todo O Período". */}
      <span className="min-w-[7.5rem] px-1 text-center text-xs font-bold text-foreground first-letter:uppercase">
        {label}
      </span>
      <button
        type="button"
        onClick={() => move(1)}
        disabled={!navigable}
        aria-label="Próximo período"
        className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <CaretRight size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-card shadow-card-hover">
          <ul className="py-1">
            {dateGranularityOptions.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      granularity: option.value,
                      // Toda troca recomeça de hoje: manter a âncora antiga
                      // levaria a "setembro" ao virar de anual para mensal.
                      anchor: dateKey(today),
                    });
                    if (option.value !== "custom") setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors hover:bg-background ${
                    value.granularity === option.value
                      ? "font-bold text-foreground"
                      : "text-muted"
                  }`}
                >
                  {option.label}
                  {value.granularity === option.value && (
                    <Check size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {value.granularity === "custom" && (
            <div className="space-y-3 border-t border-border px-4 py-3">
              <Input
                label="Início"
                type="date"
                value={value.customStart}
                onChange={(event) => onChange({ customStart: event.target.value })}
              />
              <Input
                label="Fim"
                type="date"
                value={value.customEnd}
                onChange={(event) => onChange({ customEnd: event.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InlineFilterButton({
  value,
  categoryOptions,
  accountOptions,
  partyOptions,
  partyLabel,
  settlementLabel,
  open,
  onToggle,
  onClose,
  onChange,
  onClear,
  ariaLabel = "Filtros",
}: {
  value: FinanceFilterState;
  categoryOptions: { value: string; label: string }[];
  accountOptions: { value: string; label: string }[];
  partyOptions: { value: string; label: string }[];
  partyLabel: string;
  /** "Recebimento" nas receitas, "Pagamento" nas despesas. */
  settlementLabel: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (patch: Partial<FinanceFilterState>) => void;
  onClear: () => void;
  ariaLabel?: string;
}) {
  const activeCount = countActiveFinanceFilters(value);
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

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={handleToggle}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          open || activeCount > 0
            ? "border-premium/40 bg-premium/10 text-premium"
            : "border-border/80 bg-card text-foreground/70 hover:bg-background hover:text-foreground"
        }`}
        aria-label={
          activeCount > 0
            ? `Abrir filtros (${activeCount} ${
                activeCount === 1 ? "ativo" : "ativos"
              })`
            : "Abrir filtros"
        }
        aria-expanded={open}
        title="Abrir filtros"
      >
        <Funnel size={16} weight={FINANCE_ICON_WEIGHT} aria-hidden />
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-premium px-1 text-[9px] font-bold leading-none text-white ring-2 ring-card">
            {activeCount}
          </span>
        )}
      </button>

      {showPanel && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          className={`finance-inline-filter-card @container absolute right-0 top-full z-50 mt-2 max-h-[min(80vh,38rem)] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-card px-4 py-5 shadow-card transition-all duration-300 ease-out sm:px-6 ${
            panelVisible
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-2 opacity-0"
          }`}
          style={{
            boxShadow:
              "-6px 8px 24px rgba(15, 23, 42, 0.1), 0 4px 12px rgba(15, 23, 42, 0.06)",
          }}
        >
          <Input
            label="Buscar"
            value={value.search}
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="Descrição, cliente, serviço, fornecedor ou observação"
          />

          <div className="mt-4 grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
            <Dropdown
              label="Status"
              value={value.status}
              options={financeStatusFilterOptions}
              onChange={(status) => onChange({ status })}
              className="space-y-2"
            />
            <Dropdown
              label="Origem"
              value={value.origin}
              options={financeOriginFilterOptions}
              onChange={(origin) => onChange({ origin })}
              className="space-y-2"
            />
            <Dropdown
              label="Categoria"
              value={value.category}
              options={categoryOptions}
              onChange={(category) => onChange({ category })}
              className="space-y-2"
            />
            <Dropdown
              label={partyLabel}
              value={value.party}
              options={partyOptions}
              onChange={(party) => onChange({ party })}
              className="space-y-2"
            />
            <Dropdown
              label="Conta"
              value={value.account}
              options={accountOptions}
              onChange={(account) => onChange({ account })}
              className="space-y-2"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
            <Input
              label="Valor mínimo"
              inputMode="decimal"
              value={value.minAmount}
              onChange={(event) => onChange({ minAmount: event.target.value })}
              placeholder="0,00"
            />
            <Input
              label="Valor máximo"
              inputMode="decimal"
              value={value.maxAmount}
              onChange={(event) => onChange({ maxAmount: event.target.value })}
              placeholder="0,00"
            />
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <p className="label-caps">Filtrar pela data de</p>
            <p className="mb-2 mt-0.5 text-xs text-muted">
              Qual das três datas o período escolhido no calendário considera.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { value: "date", label: "Lançamento" },
                  { value: "dueDate", label: "Vencimento" },
                  { value: "effectiveDate", label: settlementLabel },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ dateField: option.value })}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    value.dateField === option.value
                      ? "bg-primary text-white"
                      : "bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 @sm:flex-row @sm:items-center @sm:justify-between">
            <p className="text-xs text-muted">
              {activeCount === 0
                ? "Nenhum filtro aplicado"
                : `${activeCount} ${
                    activeCount === 1 ? "filtro aplicado" : "filtros aplicados"
                  }`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClear}
                className="flex-1 @sm:min-w-[5.5rem] @sm:flex-none"
              >
                Limpar
              </Button>
              <Button
                type="button"
                onClick={requestClose}
                className="flex-1 @sm:min-w-[5.5rem] @sm:flex-none"
              >
                Aplicar
              </Button>
            </div>
          </div>
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
/** Quantos itens os rankings mostram antes de "Ver todos". */
const RANKING_PREVIEW_SIZE = 5;

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

/**
 * Observação dentro do card aberto. Substitui o ícone que ficava na linha: lá
 * ela era o único jeito de escrever a observação, e tirar o ícone sem trazer a
 * edição para cá deixaria o campo só de leitura.
 */
function TransactionNotesField({
  notes,
  onUpdateNotes,
}: {
  notes: string;
  onUpdateNotes: (notes: string | null) => Promise<void>;
}) {
  const trimmedNotes = notes.trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmedNotes);
  const [saving, setSaving] = useState(false);

  async function save(value: string | null) {
    setSaving(true);
    try {
      await onUpdateNotes(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-3">
        <p className="label-caps">Observação</p>
        <textarea
          rows={3}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
          placeholder="Escreva uma observação..."
          className="mt-1 w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-primary/40 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          {trimmedNotes && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(null)}
              className="text-xs font-semibold text-danger transition-colors hover:text-danger/80 disabled:opacity-60"
            >
              Excluir observação
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft(trimmedNotes);
              setEditing(false);
            }}
            className="text-xs font-semibold text-muted transition-colors hover:text-foreground disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !draft.trim()}
            onClick={() => void save(draft.trim())}
            className="text-xs font-semibold text-success transition-colors hover:text-success/80 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="label-caps">Observação</p>
      {trimmedNotes ? (
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
          {trimmedNotes}
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-muted">Nenhuma observação.</p>
      )}
      <button
        type="button"
        onClick={() => {
          setDraft(trimmedNotes);
          setEditing(true);
        }}
        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80"
      >
        <PencilSimple size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
        {trimmedNotes ? "Editar observação" : "Adicionar observação"}
      </button>
    </div>
  );
}

function PaymentStatusSelect({
  value,
  overdue,
  onChange,
}: {
  value?: PaymentStatus;
  overdue?: boolean;
  onChange: (status: PaymentStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = getPaymentStatusOption(value);
  const display = overdue
    ? {
        label: "Vencido",
        className: "bg-danger/10 text-danger hover:bg-danger hover:text-white",
        icon: WarningCircle,
      }
    : current;
  const DisplayIcon = display.icon;

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
        className={`inline-flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-full px-2.5 text-[11px] font-bold transition-colors ${display.className}`}
      >
        <DisplayIcon size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
        {display.label}
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

function SortableHeader({
  label,
  icon: HeaderIcon,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; weight?: "light"; "aria-hidden"?: boolean }>;
  sortKey: TransactionSortKey;
  sort: TransactionSort | null;
  onSort: (key: TransactionSortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-foreground ${
        active ? "text-foreground" : ""
      }`}
      aria-label={`Ordenar por ${label}`}
    >
      <HeaderIcon size={13} weight={FINANCE_ICON_WEIGHT} aria-hidden />
      <span className="truncate">{label}</span>
      {active ? (
        sort?.direction === "asc" ? (
          <CaretUp size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden className="shrink-0" />
        ) : (
          <CaretDown size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden className="shrink-0" />
        )
      ) : (
        <CaretUpDown
          size={12}
          weight={FINANCE_ICON_WEIGHT}
          aria-hidden
          className="shrink-0 opacity-40"
        />
      )}
    </button>
  );
}

function TransactionList({
  entries,
  emptyMessage,
  emptyDescription,
  accent = "default",
  accountNames,
  onEditGroup,
  onDeleteGroup,
  filter,
  groupByMonth = false,
  groupInstallments = false,
  editingId,
  editForm,
  nfseByTransaction,
  onEmitNfse,
  onEditTransaction,
  onDeleteTransaction,
  onChangePaymentStatus,
  onUpdateNotes,
}: {
  entries: FinanceEntry[];
  emptyMessage: string;
  emptyDescription?: string;
  accent?: "default" | "expense";
  accountNames?: Map<string, string>;
  onEditGroup?: (entries: FinanceEntry[]) => void;
  onDeleteGroup?: (entries: FinanceEntry[]) => void;
  filter?: React.ReactNode;
  groupByMonth?: boolean;
  groupInstallments?: boolean;
  editingId?: string | null;
  editForm?: React.ReactNode;
  onEditTransaction?: (entry: FinanceEntry) => void;
  onDeleteTransaction?: (entry: FinanceEntry) => void;
  onChangePaymentStatus?: (entry: FinanceEntry, status: PaymentStatus) => void;
  onUpdateNotes?: (entry: FinanceEntry, notes: string | null) => Promise<void>;
  /** Nota fiscal já emitida deste lançamento, se houver. */
  nfseByTransaction?: Map<string, NfseInvoice>;
  onEmitNfse?: (entry: FinanceEntry) => void;
}) {
  const [page, setPage] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Uma linha aberta por vez: a página já é longa.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Card escolhido como filtro; null mostra tudo. */
  const [activeBucket, setActiveBucket] = useState<SummaryBucket | null>(null);
  const editRowRef = useRef<HTMLDivElement>(null);
  const todayKeyValue = todayDateKey();

  // null mantém a ordem que a página já entrega (lançamento mais recente).
  const [sort, setSort] = useState<TransactionSort | null>(null);

  function toggleSort(key: TransactionSortKey) {
    setSort((current) =>
      current?.key === key
        ? current.direction === "asc"
          ? { key, direction: "desc" }
          : null
        : { key, direction: "asc" }
    );
  }

  const bucketEntries = useMemo(
    () =>
      activeBucket
        ? entries.filter((entry) => entryBucket(entry) === activeBucket)
        : entries,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, activeBucket, todayKeyValue]
  );

  const sortedEntries = useMemo(
    () => (sort ? [...bucketEntries].sort(compareEntries(sort)) : bucketEntries),
    [bucketEntries, sort]
  );

  const listItems = useMemo(() => {
    const entries = sortedEntries;
    if (!groupInstallments) {
      return entries.map((entry) => ({ kind: "single" as const, entry }));
    }
    const items: Array<
      | { kind: "single"; entry: FinanceEntry }
      | { kind: "group"; groupId: string; entries: FinanceEntry[] }
    > = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const groupId = entry.installmentGroupId;
      if (!groupId || (entry.installmentTotal ?? 0) < 2) {
        items.push({ kind: "single", entry });
        continue;
      }
      if (seen.has(groupId)) continue;
      seen.add(groupId);
      const group = entries
        .filter((item) => item.installmentGroupId === groupId)
        .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
      items.push({ kind: "group", groupId, entries: group });
    }
    return items;
  }, [sortedEntries, groupInstallments]);
  const entriesSignature = useMemo(
    () => listItems.map((item) => (item.kind === "single" ? item.entry.id : item.groupId)).join("|"),
    [listItems]
  );

  useEffect(() => {
    setPage(0);
  }, [entriesSignature]);

  const totalPages = Math.ceil(listItems.length / TRANSACTION_PAGE_SIZE);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pagedItems = listItems.slice(
    safePage * TRANSACTION_PAGE_SIZE,
    (safePage + 1) * TRANSACTION_PAGE_SIZE
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    if (!editingId) return;
    editRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editingId]);

  const showPayment = Boolean(onChangePaymentStatus);
  const showNotes = Boolean(onUpdateNotes);
  const labelColumnTitle = accent === "expense" ? "Fornecedor" : "Categoria";
  // Nota fiscal e parcela são conversa de despesa: receita da agenda não tem
  // nem uma nem outra.
  const isExpense = accent === "expense";

  // Resumo do que está na tela: muda junto com o filtro, de propósito.
  /** Em qual card o lançamento é contado. Cancelado não entra em nenhum. */
  function entryBucket(entry: FinanceEntry): SummaryBucket | null {
    if (entry.paymentStatus === "cancelado") return null;
    if (entry.paymentStatus === "pago") return "settled";
    return isOverdue(
      { payment_status: entry.paymentStatus, due_date: entry.dueDate },
      todayKeyValue
    )
      ? "overdue"
      : "upcoming";
  }

  const summary = useMemo(() => {
    const buckets = {
      overdue: { count: 0, total: 0 },
      settled: { count: 0, total: 0 },
      upcoming: { count: 0, total: 0 },
      all: { count: 0, total: 0 },
    };

    for (const entry of entries) {
      buckets.all.count += 1;
      buckets.all.total += entry.amount;

      const bucket = entryBucket(entry);
      if (!bucket) continue;
      buckets[bucket].count += 1;
      buckets[bucket].total += entry.amount;
    }

    return buckets;
  }, [entries, todayKeyValue]);
  const canEditPaymentStatus = (_entry: FinanceEntry) => true;

  // Separate fixed columns so OBS / status / edit stay aligned across rows.
  const gridTemplateColumns = [
    // Cabe "15 out  Recebido 15 out", a combinação mais larga das duas abas.
    "168px",
    "minmax(0, 1fr)",
    isExpense ? "96px" : null,
    "140px",
    isExpense ? "72px" : null,
    "110px",
    showPayment ? "108px" : null,
    "56px",
  ]
    .filter(Boolean)
    .join(" ");

  if (entries.length === 0) {
    return (
      <div className="w-full">
        {filter && <div className="mb-2 flex justify-end px-3">{filter}</div>}
        <EmptyState
          icon={<ClipboardList className="h-5 w-5" />}
          title={emptyMessage}
          description={emptyDescription}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      {filter && (
        <div className="mb-2 flex items-center justify-end gap-2 px-3">{filter}</div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(
          [
            {
              key: "overdue",
              label: "Em atraso",
              bucket: summary.overdue,
              text: "text-danger",
              // Em repouso é igual aos outros: o vermelho fica para o valor e
              // para quando o card está escolhido.
              idle: "border-border bg-card",
              active: "border-danger bg-danger/10 ring-2 ring-danger/30",
            },
            {
              key: "settled",
              label: isExpense ? "Pago" : "Recebido",
              bucket: summary.settled,
              text: "text-success",
              idle: "border-border bg-card",
              active: "border-success bg-success/10 ring-2 ring-success/30",
            },
            {
              key: "upcoming",
              label: isExpense ? "A pagar" : "A receber",
              bucket: summary.upcoming,
              text: "text-warning",
              idle: "border-border bg-card",
              active: "border-warning bg-warning/10 ring-2 ring-warning/30",
            },
            {
              key: "all",
              label: "Total",
              bucket: summary.all,
              text: "text-foreground",
              idle: "border-border bg-card",
              active: "border-primary bg-primary/5 ring-2 ring-primary/25",
            },
          ] as const
        ).map((card) => {
          // "Total" não é um balde: é o estado sem filtro.
          const selected =
            card.key === "all" ? activeBucket === null : activeBucket === card.key;

          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={selected}
              // Card vazio não filtra nada: clicar levaria a uma lista em branco.
              disabled={card.bucket.count === 0 && !selected}
              onClick={() =>
                setActiveBucket((current) => {
                  if (card.key === "all") return null;
                  return current === card.key ? null : card.key;
                })
              }
              className={`rounded-lg border px-3 py-2.5 text-left transition-all disabled:cursor-default ${
                card.text
              } ${selected ? card.active : `${card.idle} hover:border-foreground/20`}`}
            >
              <p className="label-caps text-muted">
                {card.label} ({card.bucket.count})
              </p>
              <p className="mt-0.5 text-base font-bold">
                {formatCurrency(card.bucket.total)}
              </p>
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <div className={isExpense ? "min-w-[1120px]" : "min-w-[960px]"}>
        <div
          className="grid items-center gap-x-4 border-b border-border px-3 py-3 text-xs font-semibold text-muted"
          style={{ gridTemplateColumns }}
        >
          <SortableHeader
            label="Data"
            icon={CalendarBlank}
            sortKey="date"
            sort={sort}
            onSort={toggleSort}
          />
          <SortableHeader
            label="Descrição"
            icon={Note}
            sortKey="description"
            sort={sort}
            onSort={toggleSort}
          />
          {isExpense && <span>Nota fiscal</span>}
          <SortableHeader
            label={labelColumnTitle}
            icon={accent === "expense" ? Wallet : ChartDonut}
            sortKey="label"
            sort={sort}
            onSort={toggleSort}
          />
          {isExpense && <span className="text-center">Parcela</span>}
          <SortableHeader
            label="Valor"
            icon={accent === "expense" ? TrendDown : TrendUp}
            sortKey="amount"
            sort={sort}
            onSort={toggleSort}
          />
          {showPayment && (
            <SortableHeader
              label="Status"
              icon={CheckCircle}
              sortKey="status"
              sort={sort}
              onSort={toggleSort}
            />
          )}
          <span className="text-right">Ações</span>
        </div>
        {(() => {
          type Row =
            | { kind: "header"; key: string; label: string }
            | { kind: "group"; groupId: string; groupEntries: FinanceEntry[] }
            | { kind: "entry"; entry: FinanceEntry; nested?: boolean };
          const rows: Row[] = [];
          let lastMonthKey = "";

          function pushMonthHeader(date: string) {
            if (!groupByMonth) return;
            const key = monthKeyFromDateStr(date);
            if (key === lastMonthKey) return;
            rows.push({ kind: "header", key, label: getMonthYearLabel(date) });
            lastMonthKey = key;
          }

          for (const item of pagedItems) {
            if (item.kind === "group") {
              pushMonthHeader(item.entries[0]?.date ?? "");
              rows.push({ kind: "group", groupId: item.groupId, groupEntries: item.entries });
              if (expandedGroups[item.groupId] !== false) {
                item.entries.forEach((entry) => rows.push({ kind: "entry", entry, nested: true }));
              }
              continue;
            }
            pushMonthHeader(item.entry.date);
            rows.push({ kind: "entry", entry: item.entry });
          }

          const renderEntry = (entry: FinanceEntry, nested?: boolean) => {
          const isRevenue = entry.type === "receita";
          const overdue = isOverdue(
            { payment_status: entry.paymentStatus, due_date: entry.dueDate },
            todayKeyValue
          );
          // A parcela já se identifica pela etiqueta "Parcela" e pela coluna
          // "1/3": repetir o "(1/3)" no nome era a mesma informação três vezes.
          const cleanDescription =
            entry.installmentNumber && entry.installmentTotal
              ? installmentBaseDescription(entry.description)
              : entry.description;
          const nfse = nfseByTransaction?.get(entry.id) ?? null;
          // Nota de serviço é de receita, e só faz sentido depois que o
          // serviço foi prestado e o lançamento existe de fato no banco.
          const canEmitNfse = Boolean(onEmitNfse) && entry.type === "receita";
          const displayTitle =
            entry.kind === "automatic" && entry.clientName
              ? entry.clientName
              : cleanDescription;
          const displaySubtitle =
            entry.kind === "automatic" && entry.serviceName
              ? entry.serviceName
              : undefined;
          // Ao lado da data de lançamento fica a data que ainda interessa:
          // enquanto não há pagamento é o vencimento, em vermelho; assim que o
          // dinheiro se move, é a data em que se moveu — e o vencimento volta
          // para a linha de baixo, onde já morava.
          const settled = Boolean(entry.effectiveDate);
          const sideDate = settled ? entry.effectiveDate : entry.dueDate;
          const sideLabel = settled
            ? isRevenue
              ? "Recebido"
              : "Pago"
            : overdue
              ? "Venceu"
              : "Vence";

          const metaParts: string[] = [];
          if (settled && entry.dueDate) {
            metaParts.push(`Vence ${formatShortDate(entry.dueDate)}`);
          }
          const accountName = entry.accountId
            ? accountNames?.get(entry.accountId)
            : undefined;
          if (accountName) metaParts.push(accountName);

          const isEditing = editingId === entry.id && Boolean(editForm);
          const open = expandedId === entry.id || isEditing;
          const originLabel =
            entry.kind === "automatic"
              ? "Agenda"
              : entry.kind === "fixed"
                ? "Custo fixo"
                : "Manual";
          const details: { label: string; value: string }[] = [
            { label: "Descrição", value: cleanDescription },
            ...(entry.serviceName
              ? [{ label: "Serviço", value: entry.serviceName }]
              : []),
            ...(entry.clientName
              ? [{ label: "Cliente", value: entry.clientName }]
              : []),
            { label: "Categoria", value: entry.category || "-" },
            ...(accent === "expense"
              ? [{ label: "Fornecedor", value: entry.supplierName ?? "-" }]
              : []),
            { label: "Valor", value: formatCurrency(entry.amount) },
            { label: "Lançado em", value: formatShortDate(entry.date) },
            {
              label: "Vencimento",
              value: entry.dueDate ? formatShortDate(entry.dueDate) : "-",
            },
            {
              label: isRevenue ? "Recebido em" : "Pago em",
              value: entry.effectiveDate
                ? formatShortDate(entry.effectiveDate)
                : "-",
            },
            { label: "Conta", value: accountName ?? "Não classificado" },
            ...(entry.installmentNumber && entry.installmentTotal
              ? [
                  {
                    label: "Parcela",
                    value: `${entry.installmentNumber} de ${entry.installmentTotal}`,
                  },
                ]
              : []),
            { label: "Origem", value: originLabel },
          ];
          // Aberta, a linha e o painel viram um card só: o fundo é o mesmo e a
          // borda de baixo sai, sobrando só a que separa um card do próximo.
          const cardBackground = overdue
            ? "bg-danger/5"
            : open
              ? "bg-background"
              : nested
                ? "bg-background/40"
                : "";

          return (
            <Fragment key={entry.id}>
            <article
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => setExpandedId(open ? null : entry.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setExpandedId(open ? null : entry.id);
              }}
              className={`grid cursor-pointer items-center gap-x-4 px-3 py-3 transition-colors ${
                open ? "" : "border-b border-border/70 hover:bg-background/70"
              } ${cardBackground}`}
              style={{ gridTemplateColumns }}
            >
              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold">
                <span className="flex shrink-0 items-center gap-1.5 text-muted">
                  {open ? (
                    <CaretDown size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  ) : (
                    <CaretRight size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                  )}
                  {formatShortDate(entry.date)}
                </span>
                {sideDate && (
                  <span
                    className={`truncate ${
                      settled ? "text-foreground/70" : "text-danger"
                    }`}
                  >
                    {sideLabel} {formatShortDate(sideDate)}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className={`truncate text-sm font-semibold text-foreground ${nested ? "pl-4" : ""}`}>
                    {displayTitle}
                  </p>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      entry.kind === "automatic"
                        ? "bg-success/10 text-success"
                        : entry.kind === "fixed" && !nested
                          ? "bg-premium/10 text-premium"
                          : "bg-primary/10 text-primary"
                    }`}
                  >
                    {entry.kind === "automatic" ? (
                      <>
                        <CalendarBlank size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Agenda
                      </>
                    ) : nested ? (
                      "Parcela"
                    ) : entry.kind === "fixed" ? (
                      <>
                        <ArrowsClockwise size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                        Custo fixo
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
                <p
                  className={`mt-1 truncate text-xs font-medium ${
                    overdue ? "font-semibold text-danger" : "text-foreground/80"
                  }`}
                >
                  {metaParts.join(" · ")}
                </p>
              </div>
              {isExpense && (
                <div className="min-w-0 truncate text-sm text-muted">
                  {entry.invoiceNumber || "-"}
                </div>
              )}
              <div className="min-w-0 truncate text-sm font-medium text-foreground">
                {accent === "expense" ? entry.supplierName ?? "-" : entry.category}
              </div>
              {isExpense && (
                <div className="text-center text-sm text-muted">
                  {entry.installmentNumber && entry.installmentTotal
                    ? `${entry.installmentNumber}/${entry.installmentTotal}`
                    : "-"}
                </div>
              )}
              <div
                className={`text-sm font-bold ${
                  isRevenue ? "text-success" : "text-danger"
                }`}
              >
                {formatCurrency(entry.amount)}
              </div>
              {showPayment && (
                <div
                  className="flex min-w-0 items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  {canEditPaymentStatus(entry) ? (
                    <PaymentStatusSelect
                      value={entry.paymentStatus}
                      overdue={overdue}
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
              {/* Editar mudou de lugar: fica dentro do card que abre abaixo. */}
              <div
                className="flex items-center justify-end"
                onClick={(event) => event.stopPropagation()}
              >
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
                  <span className="text-xs font-semibold text-muted">-</span>
                )}
              </div>
            </article>
            {open && (
              <div
                ref={isEditing ? editRowRef : undefined}
                className={`border-b border-border px-3 pb-4 ${cardBackground} ${
                  nested ? "pl-7" : ""
                }`}
              >
                {isEditing ? (
                  editForm
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                      {details.map((item) => (
                        <div key={item.label} className="min-w-0">
                          <dt className="label-caps">{item.label}</dt>
                          <dd className="mt-0.5 break-words text-sm font-semibold text-foreground">
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {entry.items && entry.items.length > 0 && (
                      <div className="mt-4">
                        <p className="label-caps">Itens da nota</p>
                        <div className="mt-1.5 space-y-1">
                          {entry.items.map((item) => {
                            const quantity =
                              parseFilterAmount(item.quantity) ?? 1;
                            const unit =
                              parseFilterAmount(item.unitAmount) ?? 0;
                            return (
                              <div
                                key={item.uiKey}
                                className="flex items-baseline justify-between gap-3 text-sm"
                              >
                                <span className="min-w-0 text-foreground">
                                  {quantity > 1 ? `${quantity}× ` : ""}
                                  {item.description || "Item"}
                                  {item.volumeMl ? (
                                    <span className="text-muted"> · {item.volumeMl} ml</span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 font-semibold text-foreground">
                                  {formatCurrency(quantity * unit)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {showNotes && onUpdateNotes ? (
                      <TransactionNotesField
                        notes={entry.notes ?? ""}
                        onUpdateNotes={(notes) => onUpdateNotes(entry, notes)}
                      />
                    ) : (
                      entry.notes && (
                        <div className="mt-3">
                          <p className="label-caps">Observação</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                            {entry.notes}
                          </p>
                        </div>
                      )
                    )}
                    {(onEditTransaction || nfse || canEmitNfse) && (
                      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                        {nfse ? (
                          // Nota já existe: o que serve agora é o documento,
                          // não o botão de emitir de novo.
                          <span className="mr-auto inline-flex flex-wrap items-center gap-2 text-xs font-semibold">
                            <span
                              className={
                                nfse.status === "issued"
                                  ? "text-success"
                                  : nfse.status === "error"
                                    ? "text-danger"
                                    : "text-muted"
                              }
                            >
                              {nfse.status === "issued"
                                ? `NFS-e ${nfse.numero ?? "emitida"}`
                                : nfse.status === "error"
                                  ? "NFS-e recusada"
                                  : "NFS-e em emissão"}
                            </span>
                            {nfse.pdfUrl && (
                              <a
                                href={nfse.pdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                PDF
                              </a>
                            )}
                            {nfse.status === "error" && onEmitNfse && (
                              <button
                                type="button"
                                onClick={() => onEmitNfse(entry)}
                                className="text-primary hover:underline"
                              >
                                tentar de novo
                              </button>
                            )}
                          </span>
                        ) : (
                          canEmitNfse && (
                            <button
                              type="button"
                              onClick={() => onEmitNfse?.(entry)}
                              className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                            >
                              <FileText size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                              Emitir NFS-e
                            </button>
                          )
                        )}
                        {onEditTransaction && (
                          <button
                            type="button"
                            onClick={() => onEditTransaction(entry)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                          >
                            <PencilSimple
                              size={14}
                              weight={FINANCE_ICON_WEIGHT}
                              aria-hidden
                            />
                            Editar lançamento
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            </Fragment>
          );
          };

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
            if (row.kind === "group") {
              const paidCount = row.groupEntries.filter((entry) => entry.paymentStatus === "pago").length;
              const total = row.groupEntries[0]?.installmentTotal ?? row.groupEntries.length;
              const amount = row.groupEntries.reduce((sum, entry) => sum + entry.amount, 0);
              const expanded = expandedGroups[row.groupId] !== false;
              const title = installmentBaseDescription(row.groupEntries[0]?.description ?? "Compra");
              const hasOverdue = row.groupEntries.some((entry) =>
                isOverdue(
                  { payment_status: entry.paymentStatus, due_date: entry.dueDate },
                  todayKeyValue
                )
              );
              return (
                <button
                  key={`group-${row.groupId}`}
                  type="button"
                  onClick={() =>
                    setExpandedGroups((prev) => ({
                      ...prev,
                      [row.groupId]: prev[row.groupId] === false,
                    }))
                  }
                  className={`grid w-full items-center gap-x-4 border-b border-border px-3 py-3 text-left transition-colors hover:bg-background/70 ${
                    hasOverdue ? "bg-danger/5" : "bg-background/50"
                  }`}
                  style={{ gridTemplateColumns }}
                >
                          <div
                    className={`flex items-center gap-1.5 text-xs font-semibold ${
                      hasOverdue ? "text-danger" : "text-muted"
                    }`}
                  >
                    {expanded ? (
                      <CaretDown size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    ) : (
                      <CaretRight size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    )}
                    {formatShortDate(row.groupEntries[0]?.date ?? "")}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {title} ({total}x)
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {/* O filtro pode esconder parcelas do grupo. Contar as
                          visíveis como se fossem todas dizia "1/1 pagas" ao
                          lado de um "(3x)". */}
                      {paidCount}/{row.groupEntries.length} pagas
                      {row.groupEntries.length < total
                        ? ` · ${total - row.groupEntries.length} fora do filtro`
                        : ""}
                      {hasOverdue ? " · parcela vencida" : ""}
                    </p>
                  </div>
                  {isExpense && (
                    <div className="min-w-0 truncate text-sm text-muted">
                      {row.groupEntries[0]?.invoiceNumber || "-"}
                    </div>
                  )}
                  <div className="text-sm font-medium text-foreground">
                    {row.groupEntries[0]?.supplierName ?? "-"}
                  </div>
                  {isExpense && (
                    <div className="text-center text-sm text-muted">{total}x</div>
                  )}
                  <div className="text-sm font-bold text-danger">{formatCurrency(amount)}</div>
                  {showPayment && <span />}
                  <span className="flex items-center justify-end gap-0.5">
                    {onEditGroup && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditGroup(row.groupEntries);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            onEditGroup(row.groupEntries);
                          }
                        }}
                        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted/70 transition-colors hover:bg-background hover:text-foreground"
                        title="Editar parcelamento"
                        aria-label={`Editar parcelamento ${title}`}
                      >
                        <PencilSimple size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                      </span>
                    )}
                    {onDeleteGroup && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteGroup(row.groupEntries);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteGroup(row.groupEntries);
                          }
                        }}
                        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted/70 transition-colors hover:bg-background hover:text-danger"
                        title="Excluir parcelamento"
                        aria-label={`Excluir parcelamento ${title}`}
                      >
                        <Trash size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                      </span>
                    )}
                  </span>
                </button>
              );
            }
            return renderEntry(row.entry, row.nested);
          });
        })()}
        {pagedItems.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-muted">
            Nenhum lançamento neste filtro.
          </p>
        )}
        </div>
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t border-border px-3 pt-4">
          <p className="text-xs text-muted">
            {safePage * TRANSACTION_PAGE_SIZE + 1}–{Math.min((safePage + 1) * TRANSACTION_PAGE_SIZE, listItems.length)} de {listItems.length} lançamentos
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

/** Soma dos itens, ignorando linha em branco e número que não dá número. */
function sumTransactionItems(items: TransactionItem[]) {
  return items.reduce((total, item) => {
    const quantity = parseFilterAmount(item.quantity) ?? 1;
    const unit = parseFilterAmount(item.unitAmount) ?? 0;
    return total + quantity * unit;
  }, 0);
}

function createTransactionItem(): TransactionItem {
  return {
    uiKey:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `item-${Date.now()}-${Math.random()}`,
    description: "",
    quantity: "1",
    unitAmount: "",
    productId: "",
    volumeMl: "",
  };
}

/** Itens do banco (JSONB) para o formato do formulário. */
function transactionItemsFromRow(value: unknown): TransactionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const quantity = Number(item.quantity);
    const unit = Number(item.unitAmount);
    return {
      ...createTransactionItem(),
      description: typeof item.description === "string" ? item.description : "",
      quantity: Number.isFinite(quantity) && quantity > 0
        ? formatMoneyInput(quantity).replace(",00", "")
        : "1",
      unitAmount: Number.isFinite(unit) ? formatMoneyInput(unit) : "",
      productId: typeof item.productId === "string" ? item.productId : "",
      volumeMl: typeof item.volumeMl === "string" ? item.volumeMl : "",
    };
  });
}

/** Do formulário para o banco. Linha sem descrição e sem valor é descartada. */
function transactionItemsToRow(items: TransactionItem[]) {
  return items
    .filter((item) => item.description.trim() || parseFilterAmount(item.unitAmount))
    .map((item) => ({
      description: item.description.trim(),
      quantity: parseFilterAmount(item.quantity) ?? 1,
      unitAmount: parseFilterAmount(item.unitAmount) ?? 0,
      productId: item.productId || undefined,
      volumeMl: item.volumeMl.trim() || undefined,
    }));
}

/**
 * O campo de produto da linha da nota. Continua aceitando texto livre — nem
 * tudo que entra numa nota está no estoque — mas enquanto você digita ele
 * oferece o que já existe lá, e escolher traz nome, volume e último custo.
 */
function ProductPicker({
  item,
  products,
  onPick,
  onType,
}: {
  item: TransactionItem;
  products: StockProduct[];
  onPick: (product: StockProduct) => void;
  onType: (description: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const matches = useMemo(() => {
    const term = item.description.trim().toLowerCase();
    const base = term
      ? products.filter((product) => product.name.toLowerCase().includes(term))
      : products;
    return base.slice(0, 8);
  }, [item.description, products]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const exactPick =
    item.productId &&
    products.find((product) => product.id === item.productId)?.name ===
      item.description.trim();

  return (
    <div
      className="relative"
      onBlur={() => {
        // Espera o clique na sugestão acontecer antes de fechar a lista.
        closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 120);
      }}
      onFocus={() => {
        if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
        setOpen(true);
      }}
    >
      <Input
        id={`item-${item.uiKey}-produto`}
        label="Produto ou serviço"
        value={item.description}
        onChange={(event) => onType(event.target.value)}
        placeholder="Comece a digitar e escolha do estoque"
        compact
        suffix={
          exactPick ? (
            <Package size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
          ) : undefined
        }
      />
      {open && products.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-card-hover">
          {matches.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted">
              Nada no estoque com esse nome. Pode seguir digitando: vai entrar
              como item avulso.
            </p>
          ) : (
            matches.map((product) => (
              <button
                key={product.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(product);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-background"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {product.name}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted">
                  {[
                    product.volumeMl ? `${product.volumeMl} ml` : "",
                    product.stockRemaining ? `${product.stockRemaining} em estoque` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Um bloco do formulário: título e campos, separados por um fio. Sem caixa
 * dentro de caixa — o lançamento já é um card, e cada seção virar outro
 * deixava a tela pesada.
 */
function FormSection({
  title,
  aside,
  first = false,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={first ? "" : "mt-6 border-t border-border pt-5"}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TransactionFormCard({
  title,
  description,
  form,
  categories,
  accountOptions,
  supplierOptions,
  onCreateCategory,
  onManageCategories,
  onCreateSupplier,
  stockProducts = [],
  loading,
  error,
  buttonLabel,
  allowInstallments = false,
  allowItems = false,
  embedded = false,
  sharedFieldsOnly = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  form: TransactionForm;
  categories: { value: string; label: string }[];
  accountOptions: { value: string; label: string }[];
  /** Cadastra a categoria pelo próprio dropdown. Devolve mensagem se não deu. */
  onCreateCategory?: (name: string) => Promise<string | void>;
  /** Renomear e desativar, pelo rodapé do mesmo dropdown. */
  onManageCategories?: () => void;
  supplierOptions?: { value: string; label: string }[];
  /** Abre o cadastro rápido a partir do próprio dropdown. */
  onCreateSupplier?: () => void;
  /** Catálogo para sugerir nas linhas da nota. Vazio: só texto livre. */
  stockProducts?: StockProduct[];
  loading: boolean;
  error: string | null;
  buttonLabel: string;
  allowInstallments?: boolean;
  /** Lista de itens, como as linhas de uma nota fiscal. */
  allowItems?: boolean;
  embedded?: boolean;
  /** Edição do parcelamento inteiro: valor, datas e status são de cada parcela. */
  sharedFieldsOnly?: boolean;
  onChange: (patch: Partial<TransactionForm>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const showItems = allowItems && !sharedFieldsOnly;
  const itemsTotal = sumTransactionItems(form.items);
  const showPayment = !sharedFieldsOnly;
  const installmentsTotal = sumInstallments(form.installments);
  const amountValue = parseFilterAmount(form.amount) ?? 0;
  // Centavo de diferença não é erro: o usuário mexeu numa parcela e as contas
  // pararam de fechar com o valor total.
  const installmentsMismatch =
    form.installmentsEnabled &&
    form.installments.length > 0 &&
    Math.abs(installmentsTotal - amountValue) >= 0.01;
  const netTotal = form.installmentsEnabled ? installmentsTotal : amountValue;

  function updateItem(uiKey: string, patch: Partial<TransactionItem>) {
    const items = form.items.map((item) =>
      item.uiKey === uiKey ? { ...item, ...patch } : item
    );
    // O valor do lançamento segue a soma da nota. Continua editável depois,
    // para quem precisa somar frete ou abater desconto.
    const amount = formatMoneyInput(sumTransactionItems(items));
    onChange({ items, amount, ...regenerate({ amount }) });
  }

  function removeItem(uiKey: string) {
    const items = form.items.filter((item) => item.uiKey !== uiKey);
    if (items.length === 0) {
      onChange({ items });
      return;
    }
    const amount = formatMoneyInput(sumTransactionItems(items));
    onChange({ items, amount, ...regenerate({ amount }) });
  }

  /**
   * Mexeu no total, na quantidade, no intervalo ou no primeiro vencimento: a
   * tabela de parcelas é refeita. Edição de uma parcela sozinha fica de pé
   * até um desses quatro mudar.
   */
  function regenerate(patch: {
    amount?: string;
    installmentCount?: string;
    installmentPeriod?: InstallmentPeriod;
    dueDate?: string;
  }): Partial<TransactionForm> {
    if (!form.installmentsEnabled) return {};
    const total = parseFilterAmount(patch.amount ?? form.amount) ?? 0;
    const count = Number(patch.installmentCount ?? form.installmentCount) || 0;
    if (count < 1) return {};
    return {
      installments: buildInstallments(
        total,
        count,
        patch.installmentPeriod ?? form.installmentPeriod,
        patch.dueDate ?? form.dueDate ?? form.date
      ),
    };
  }

  function updateInstallment(uiKey: string, patch: Partial<InstallmentDraft>) {
    onChange({
      installments: form.installments.map((row) =>
        row.uiKey === uiKey ? { ...row, ...patch } : row
      ),
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      autoComplete="off"
      className={
        embedded
          ? "finance-manual-form-enter rounded-lg border border-premium/30 bg-card p-4 shadow-card sm:p-5"
          : "finance-manual-form-enter rounded-lg border border-border bg-card p-4 shadow-card sm:p-5"
      }
    >
      <div className="mb-5">
        <h2 className="section-title">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>

      <FormSection title="Informações gerais" first>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Data do lançamento"
            type="date"
            value={form.date}
            onChange={(event) =>
              onChange({
                date: event.target.value,
                effectiveDate:
                  form.paymentStatus === "pago" && !form.effectiveDate
                    ? event.target.value
                    : form.effectiveDate,
                dueDate: form.dueDate || event.target.value,
              })
            }
          />
          {supplierOptions && (
            <Dropdown
              label="Fornecedor (opcional)"
              value={form.supplierId}
              options={supplierOptions}
              onChange={(supplierId) => onChange({ supplierId })}
              actionLabel={onCreateSupplier ? "Novo fornecedor" : undefined}
              actionPlacement="top"
              onAction={onCreateSupplier}
            />
          )}
          {showItems && (
            <Input
              label="Nota fiscal (opcional)"
              value={form.invoiceNumber}
              onChange={(event) => onChange({ invoiceNumber: event.target.value })}
              placeholder="1259"
              maxLength={50}
            />
          )}
          <Dropdown
            label="Categoria"
            value={form.categoryId}
            options={categories}
            onChange={(categoryId) => onChange({ categoryId })}
            placeholder="Selecione a categoria"
            actionLabel={onCreateCategory ? "Nova categoria" : undefined}
            actionPlacement="top"
            onCreateOption={onCreateCategory}
            createPlaceholder="Nome da categoria"
            footerLabel={onManageCategories ? "Gerenciar categorias" : undefined}
            onFooterAction={onManageCategories}
          />
          <div className="md:col-span-2">
            <Input
              label="Descrição"
              value={form.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </div>
        </div>
      </FormSection>

      {showItems && (
        <FormSection
          title="Produtos e serviços"
          aside={
            form.items.length > 0 ? (
              <span className="text-sm font-bold text-foreground">
                {formatCurrency(itemsTotal)}
              </span>
            ) : null
          }
        >
          {form.items.length > 0 && (
            <div className="space-y-2">
              {form.items.map((item) => {
                const quantity = parseFilterAmount(item.quantity) ?? 1;
                const unit = parseFilterAmount(item.unitAmount) ?? 0;
                return (
                  <div
                    key={item.uiKey}
                    className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <ProductPicker
                        item={item}
                        products={stockProducts}
                        onType={(description) =>
                          // Digitou por cima: a linha deixa de apontar para o
                          // produto do estoque até escolher de novo.
                          updateItem(item.uiKey, { description, productId: "" })
                        }
                        onPick={(product) =>
                          updateItem(item.uiKey, {
                            description: product.name,
                            productId: product.id,
                            volumeMl: product.volumeMl,
                            // Só sugere o custo se o campo ainda está vazio.
                            // O catálogo guarda "89"; o campo quer "89,00".
                            unitAmount:
                              item.unitAmount.trim() ||
                              (parseFilterAmount(product.totalCost) !== null
                                ? formatMoneyInput(parseFilterAmount(product.totalCost)!)
                                : ""),
                          })
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-20">
                        <Input
                          id={`item-${item.uiKey}-ml`}
                          label="ML"
                          inputMode="decimal"
                          value={item.volumeMl}
                          onChange={(event) =>
                            updateItem(item.uiKey, { volumeMl: event.target.value })
                          }
                          placeholder="500"
                          compact
                        />
                      </div>
                      <div className="w-16">
                        <Input
                          id={`item-${item.uiKey}-qtd`}
                          label="Qtd"
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.uiKey, { quantity: event.target.value })
                          }
                          compact
                        />
                      </div>
                      <div className="w-28">
                        <Input
                          id={`item-${item.uiKey}-valor`}
                          label="Valor"
                          prefix="R$"
                          inputMode="decimal"
                          value={item.unitAmount}
                          onChange={(event) =>
                            updateItem(item.uiKey, { unitAmount: event.target.value })
                          }
                          compact
                          className="pl-9"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.uiKey)}
                        className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                        aria-label={`Remover ${item.description || "item"}`}
                        title="Remover item"
                      >
                        <Trash size={15} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                      </button>
                    </div>
                    {quantity > 1 && unit > 0 && (
                      <p className="-mt-1 text-right text-xs text-muted sm:sr-only">
                        {formatCurrency(quantity * unit)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() =>
              onChange({ items: [...form.items, createTransactionItem()] })
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-success/50 bg-success/5 px-3 py-2 text-xs font-semibold text-success transition-colors hover:border-success hover:bg-success/10 ${
              form.items.length > 0 ? "mt-3" : ""
            }`}
          >
            <Plus size={14} weight={FINANCE_ICON_WEIGHT} aria-hidden />
            Incluir produto ou serviço
          </button>
        </FormSection>
      )}

      {!sharedFieldsOnly && (
        <FormSection title="Valores">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Valor total"
              prefix="R$"
              value={form.amount}
              onChange={(event) => {
                const amount = event.target.value;
                onChange({ amount, ...regenerate({ amount }) });
              }}
            />
          </div>
        </FormSection>
      )}

      {showPayment && (
        <FormSection title="Pagamento">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Dropdown
              label="Conta"
              value={form.accountId}
              options={accountOptions}
              onChange={(accountId) => onChange({ accountId })}
              placeholder="Selecione a conta"
            />
            {allowInstallments ? (
              <Dropdown
                label="Forma de pagamento"
                value={form.installmentsEnabled ? "aprazo" : "avista"}
                options={[
                  { value: "avista", label: "À vista" },
                  { value: "aprazo", label: "A prazo (parcelado)" },
                ]}
                onChange={(value) => {
                  const enabled = value === "aprazo";
                  const current = form.dueDate || form.date;
                  // Compra a prazo não vence no dia da compra: se o vencimento
                  // ainda é o padrão, joga para o fim do primeiro período.
                  const dueDate =
                    enabled && current === form.date
                      ? addPeriodToDateKey(form.date, form.installmentPeriod, 1)
                      : current;
                  onChange({
                    installmentsEnabled: enabled,
                    paymentStatus: enabled ? "pendente" : form.paymentStatus,
                    dueDate,
                    installments: enabled
                      ? buildInstallments(
                          parseFilterAmount(form.amount) ?? 0,
                          Number(form.installmentCount) || 3,
                          form.installmentPeriod,
                          dueDate
                        )
                      : [],
                  });
                }}
              />
            ) : null}
            {!form.installmentsEnabled && (
              <Dropdown
                label="Status"
                value={form.paymentStatus}
                options={[
                  { value: "pago", label: "Pago" },
                  { value: "pendente", label: "Pendente" },
                  { value: "parcial", label: "Parcial" },
                ]}
                onChange={(paymentStatus) =>
                  onChange({
                    paymentStatus: paymentStatus as PaymentStatus,
                    effectiveDate:
                      paymentStatus === "pago" ? form.effectiveDate || form.date : "",
                    dueDate: form.dueDate || form.date,
                  })
                }
              />
            )}
            {!form.installmentsEnabled && form.paymentStatus === "pago" && (
              <Input
                label="Data de pagamento"
                type="date"
                value={form.effectiveDate}
                onChange={(event) => onChange({ effectiveDate: event.target.value })}
              />
            )}
            {!form.installmentsEnabled && form.paymentStatus !== "pago" && (
              <Input
                label="Vencimento"
                type="date"
                value={form.dueDate || form.date}
                onChange={(event) => onChange({ dueDate: event.target.value })}
              />
            )}
            {form.installmentsEnabled && (
              <>
                <Input
                  label="Quantidade de parcelas"
                  type="number"
                  min={2}
                  max={60}
                  value={form.installmentCount}
                  onChange={(event) => {
                    const next = event.target.value;
                    onChange({
                      installmentCount: next,
                      ...regenerate({ installmentCount: next }),
                    });
                  }}
                />
                <Dropdown
                  label="Periodicidade"
                  value={form.installmentPeriod}
                  options={INSTALLMENT_PERIODS}
                  onChange={(value) => {
                    const installmentPeriod = value as InstallmentPeriod;
                    onChange({
                      installmentPeriod,
                      ...regenerate({ installmentPeriod }),
                    });
                  }}
                />
                <Input
                  label="Primeiro vencimento"
                  type="date"
                  value={form.dueDate || form.date}
                  onChange={(event) => {
                    const dueDate = event.target.value;
                    onChange({ dueDate, ...regenerate({ dueDate }) });
                  }}
                />
              </>
            )}
          </div>

          {form.installmentsEnabled && form.installments.length > 0 && (
            <div className="mt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="label-caps">Valores a pagar</span>
                <span
                  className={`text-xs font-semibold ${
                    installmentsMismatch ? "text-warning" : "text-muted"
                  }`}
                >
                  {formatCurrency(installmentsTotal)}
                  {installmentsMismatch
                    ? ` · difere do total em ${formatCurrency(
                        Math.abs(installmentsTotal - amountValue)
                      )}`
                    : ""}
                </span>
              </div>
              <div className="mt-2">
                {form.installments.map((row, index) => (
                  <div
                    key={row.uiKey}
                    className="flex flex-col gap-2 border-t border-border py-3 sm:flex-row sm:items-end sm:gap-3"
                  >
                    <span className="shrink-0 text-xs font-bold tabular-nums text-muted sm:w-10 sm:pb-2.5">
                      {index + 1}/{form.installments.length}
                    </span>
                    <div className="sm:w-40">
                      <Input
                        id={`parcela-${row.uiKey}-vencimento`}
                        label="Vencimento"
                        type="date"
                        value={row.dueDate}
                        onChange={(event) =>
                          updateInstallment(row.uiKey, { dueDate: event.target.value })
                        }
                        compact
                      />
                    </div>
                    <div className="sm:w-32">
                      <Input
                        id={`parcela-${row.uiKey}-valor`}
                        label="Valor"
                        prefix="R$"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(event) =>
                          updateInstallment(row.uiKey, { amount: event.target.value })
                        }
                        compact
                        className="pl-9"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Input
                        id={`parcela-${row.uiKey}-obs`}
                        label="Observações"
                        value={row.notes}
                        onChange={(event) =>
                          updateInstallment(row.uiKey, { notes: event.target.value })
                        }
                        placeholder="Opcional"
                        maxLength={100}
                        compact
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateInstallment(row.uiKey, { paid: !row.paid })
                      }
                      aria-pressed={row.paid}
                      className={`shrink-0 rounded-md border px-3 py-2 text-xs font-bold transition-colors sm:mb-0 ${
                        row.paid
                          ? "border-success bg-success/10 text-success"
                          : "border-border bg-card text-muted hover:text-foreground"
                      }`}
                    >
                      {row.paid ? "Pago" : "Pagar"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </FormSection>
      )}

      {!sharedFieldsOnly && (
        <FormSection title="Observações">
          <textarea
            id="transaction-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            placeholder="Condição de pagamento, o que mais precisar lembrar."
            maxLength={5000}
            className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </FormSection>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        {!sharedFieldsOnly ? (
          <div>
            <span className="label-caps">Valor líquido</span>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {formatCurrency(netTotal)}
            </p>
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
      </div>
    </form>
  );
}

// MonthlyBarChart is now RevenueExpenseChart from revenue-expense-chart.tsx

export function FinancePage() {
  const supabase = useMemo(() => createClient(), []);
  const [today, setToday] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Keep the same instance while the day holds, or every memo keyed on
      // `today` recomputes each tick.
      setToday((current) => {
        const current0h = startOfDay(new Date());
        return current0h.getTime() === current.getTime() ? current : current0h;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [activeTab, setActiveTab] = useState<FinanceTab>("overview");
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [transfers, setTransfers] = useState<FinancialTransfer[]>([]);
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [stockProducts, setStockProducts] = useState<StockProduct[]>([]);
  /** Notas por lançamento, para a linha saber se já tem NFS-e. */
  const [nfseByTransaction, setNfseByTransaction] = useState<Map<string, NfseInvoice>>(
    new Map()
  );
  const [nfseEntry, setNfseEntry] = useState<FinanceEntry | null>(null);
  const [nfseClients, setNfseClients] = useState<
    { id: string; name: string; document: string | null }[]
  >([]);
  /** Conta aberta no extrato. Fica aqui porque a projeção some enquanto há uma. */
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  /** Tipo cujas categorias estão abertas para renomear/desativar. */
  const [managingCategories, setManagingCategories] =
    useState<TransactionType | null>(null);
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = readStoredFixedCosts().map((cost) =>
      normalizeFixedCost(cost as unknown as Record<string, unknown>)
    );
    stored.forEach((cost) => {
      if (cost.payment_day) {
        writeStoredPaymentDay(cost.id, cost.payment_day);
      }
    });
    return applyStoredPaymentDays(stored);
  });
  const fixedCostsRef = useRef(fixedCosts);
  const initialFinanceLoadRef = useRef(true);
  /**
   * A sincronização de custos fixos insere lançamentos, e cada inserção volta
   * pelo realtime como um pedido de recarga. Sem trava, duas cargas rodam
   * sobrepostas, cada uma com sua foto dos lançamentos, e as duas concluem que
   * o custo daquele mês ainda não existe — daí o lançamento duplicado.
   */
  const financeLoadInFlightRef = useRef(false);
  const financeLoadQueuedRef = useRef(false);
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
  // Quando preenchido, salvar propaga os campos comuns para todas as parcelas.
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [showRevenueFilter, setShowRevenueFilter] = useState(false);
  const [showExpenseFilter, setShowExpenseFilter] = useState(false);
  const [savingRevenue, setSavingRevenue] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [revenueFilters, setRevenueFilters] = useState<FinanceFilterState>(() =>
    createFinanceFilterState(dateKey(startOfMonth(today)), dateKey(today))
  );
  const [expenseFilters, setExpenseFilters] = useState<FinanceFilterState>(() =>
    createFinanceFilterState(
      dateKey(startOfMonth(today)),
      dateKey(today),
      "dueDate"
    )
  );
  const [showFixedCostForm, setShowFixedCostForm] = useState(false);
  const [editingFixedCostId, setEditingFixedCostId] = useState<string | null>(null);
  const [fixedCostForm, setFixedCostForm] = useState<FixedCostForm>(initialFixedCostForm);
  const [fixedCostError, setFixedCostError] = useState<string | null>(null);
  const [savingFixedCost, setSavingFixedCost] = useState(false);
  const [launchDrafts, setLaunchDrafts] = useState<Record<string, string>>({});
  const [launchingCostId, setLaunchingCostId] = useState<string | null>(null);
  const [launchErrors, setLaunchErrors] = useState<Record<string, string>>({});
  const [overviewChartInterval, setOverviewChartInterval] = useState<ChartInterval>("6m");
  const [overviewChartMode, setOverviewChartMode] = useState<ChartMode>("bars");
  const [showAllServiceRanking, setShowAllServiceRanking] = useState(false);
  const [showAllClientRanking, setShowAllClientRanking] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [paidConfirm, setPaidConfirm] = useState<FinanceEntry | null>(null);
  const [savingPaid, setSavingPaid] = useState(false);

  const runFinanceLoad = useCallback(async () => {
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
      productsResult,
      nfseResult,
      clientsResult,
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
          .select("id, name, trade_name")
          .eq("workshop_id", profileWorkshopId)
          .order("name", { ascending: true }),
        supabase
          .from("fixed_costs")
          .select(FIXED_COST_SELECT_FULL)
          .eq("workshop_id", profileWorkshopId)
          .order("name", { ascending: true }),
        // Só o que a linha da nota precisa: nome, volume, custo e saldo.
        supabase
          .from("products")
          .select("id, name, volume_ml, total_cost, stock_remaining")
          .eq("workshop_id", profileWorkshopId)
          .order("name", { ascending: true }),
        supabase
          .from("nfse_invoices")
          .select(
            "transaction_id, invoice_id, status, numero_nfse, pdf_url, xml_url, error_message"
          )
          .eq("workshop_id", profileWorkshopId),
        supabase
          .from("clients")
          .select("id, name, document")
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

    try {
      const [loadedAccounts, loadedCategories] = await Promise.all([
        loadFinancialAccounts(supabase, profileWorkshopId),
        loadFinancialCategories(supabase, profileWorkshopId),
      ]);
      setAccounts(loadedAccounts);
      setCategories(loadedCategories);
    } catch (cashflowError) {
      setAccounts([]);
      setCategories([]);
      setError(
        cashflowError instanceof Error
          ? `${cashflowError.message} Aplique as migrations 030–033 no Supabase (SQL Editor) para contas, categorias e fluxo de caixa.`
          : "Aplique as migrations 030–033 no Supabase (SQL Editor)."
      );
    }

    const { data: transferData, error: transferError } = await supabase
      .from("financial_transfers")
      .select(
        "id, workshop_id, from_account_id, to_account_id, amount, transfer_date, description, created_at"
      )
      .eq("workshop_id", profileWorkshopId)
      .order("transfer_date", { ascending: false });

    if (!transferError) {
      setTransfers(
        ((transferData ?? []) as FinancialTransfer[]).map((row) => ({
          ...row,
          amount: Number(row.amount) || 0,
        }))
      );
    } else {
      setTransfers([]);
    }

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

    // Estoque é conveniência na hora de lançar: se falhar, o campo de produto
    // vira texto livre e o lançamento segue.
    if (productsResult.error) {
      setStockProducts([]);
    } else {
      setStockProducts(
        ((productsResult.data as Record<string, unknown>[] | null) ?? []).map(
          (row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            volumeMl: typeof row.volume_ml === "string" ? row.volume_ml : "",
            totalCost: typeof row.total_cost === "string" ? row.total_cost : "",
            stockRemaining:
              typeof row.stock_remaining === "string" ? row.stock_remaining : "",
          })
        )
      );
    }

    // Sem a 046 a tabela não existe: a emissão fica indisponível e o resto da
    // página segue igual.
    if (nfseResult.error) {
      setNfseByTransaction(new Map());
    } else {
      const byTransaction = new Map<string, NfseInvoice>();
      ((nfseResult.data as Record<string, unknown>[] | null) ?? []).forEach((row) => {
        const transactionId = row.transaction_id;
        if (typeof transactionId !== "string") return;
        byTransaction.set(transactionId, {
          invoiceId: (row.invoice_id as string | null) ?? null,
          status: row.status as NfseInvoice["status"],
          numero: (row.numero_nfse as string | null) ?? null,
          pdfUrl: (row.pdf_url as string | null) ?? null,
          xmlUrl: (row.xml_url as string | null) ?? null,
          errorMessage: (row.error_message as string | null) ?? null,
        });
      });
      setNfseByTransaction(byTransaction);
    }

    setNfseClients(
      clientsResult.error
        ? []
        : ((clientsResult.data as Record<string, unknown>[] | null) ?? []).map(
            (row) => ({
              id: String(row.id),
              name: String(row.name ?? ""),
              document: (row.document as string | null) ?? null,
            })
          )
    );

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

  const loadFinanceData = useCallback(async () => {
    // Já tem carga rodando: anota o pedido e sai. Quem está rodando recomeça no
    // fim — uma vez só, por mais pedidos que tenham chegado no meio.
    if (financeLoadInFlightRef.current) {
      financeLoadQueuedRef.current = true;
      return;
    }

    financeLoadInFlightRef.current = true;
    try {
      do {
        financeLoadQueuedRef.current = false;
        await runFinanceLoad();
      } while (financeLoadQueuedRef.current);
    } finally {
      financeLoadInFlightRef.current = false;
    }
  }, [runFinanceLoad]);

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
        kind: transaction.service_order_id
          ? "automatic"
          : isFixedCostSource(transaction.source)
            ? "fixed"
            : "manual",
        type: transaction.type,
        description: transaction.description,
        amount: toCurrencyNumber(transaction.amount),
        category: transaction.category ?? "Outros",
        categoryId: transaction.category_id ?? undefined,
        accountId: transaction.account_id ?? undefined,
        date: transaction.transaction_date,
        effectiveDate: transaction.effective_date,
        dueDate: transaction.due_date,
        createdAt: transaction.created_at ?? transaction.transaction_date,
        clientName: order ? firstRelation(order.clients)?.name : undefined,
        serviceName: serviceNames,
        supplierId: transaction.supplier_id ?? undefined,
        supplierName: transaction.supplier_id
          ? supplierDisplayName(suppliersById.get(transaction.supplier_id))
          : undefined,
        source: transaction.source ?? undefined,
        serviceOrderId: transaction.service_order_id ?? undefined,
        paymentStatus,
        notes: transaction.notes ?? "",
        items: transactionItemsFromRow(transaction.items),
        invoiceNumber: transaction.invoice_number ?? undefined,
        installmentGroupId: transaction.installment_group_id,
        installmentNumber: transaction.installment_number,
        installmentTotal: transaction.installment_total,
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
  const currentMonthStart = dateKey(currentMonthRange.start);
  const currentMonthEnd = dateKey(currentMonthRange.end);
  const monthRevenueTotal = sumPaidRevenueInRange(
    revenueEntries.map((entry) => ({
      type: entry.type,
      amount: entry.amount,
      payment_status: entry.paymentStatus,
      effective_date: entry.effectiveDate,
      transaction_date: entry.date,
    })),
    currentMonthStart,
    currentMonthEnd
  );
  const monthExpenseTotal = expenseEntries.reduce((sum, entry) => {
    if (!isPaidCashStatus(entry.paymentStatus)) return sum;
    const date = cashflowDate({
      effective_date: entry.effectiveDate,
      transaction_date: entry.date,
    });
    if (date < currentMonthStart || date > currentMonthEnd) return sum;
    return sum + entry.amount;
  }, 0);
  const monthProfit = monthRevenueTotal - monthExpenseTotal;
  const previousMonthStart = dateKey(previousMonthRange.start);
  const previousMonthEnd = dateKey(previousMonthRange.end);
  const previousMonthRevenueTotal = sumPaidRevenueInRange(
    revenueEntries.map((entry) => ({
      type: entry.type,
      amount: entry.amount,
      payment_status: entry.paymentStatus,
      effective_date: entry.effectiveDate,
      transaction_date: entry.date,
    })),
    previousMonthStart,
    previousMonthEnd
  );
  const previousMonthExpenseTotal = expenseEntries.reduce((sum, entry) => {
    if (!isPaidCashStatus(entry.paymentStatus)) return sum;
    const date = cashflowDate({
      effective_date: entry.effectiveDate,
      transaction_date: entry.date,
    });
    if (date < previousMonthStart || date > previousMonthEnd) return sum;
    return sum + entry.amount;
  }, 0);
  const previousMonthProfit = previousMonthRevenueTotal - previousMonthExpenseTotal;
  const accountBalances = useMemo(() => {
    const rows = transactionEntries.map((entry) => ({
      type: entry.type,
      amount: entry.amount,
      payment_status: entry.paymentStatus,
      effective_date: entry.effectiveDate,
      transaction_date: entry.date,
      account_id: entry.accountId ?? null,
    }));
    return Object.fromEntries(
      accounts.map((account) => [account.id, accountBalance(account, rows, transfers)])
    ) as Record<string, number>;
  }, [accounts, transactionEntries, transfers]);
  const currentCashBalance = useMemo(
    () =>
      accounts
        .filter((account) => account.active)
        .reduce((sum, account) => sum + (accountBalances[account.id] ?? 0), 0),
    [accountBalances, accounts]
  );

  function statementLinesForAccount(accountId: string): AccountStatementLine[] {
    const txLines: AccountStatementLine[] = transactionEntries
      .filter((entry) => entry.accountId === accountId)
      .map((entry) => ({
        id: `tx-${entry.id}`,
        date: cashflowDate({
          effective_date: entry.effectiveDate,
          transaction_date: entry.date,
        }),
        description: entry.description,
        amount: entry.type === "receita" ? entry.amount : -entry.amount,
        kind: entry.type,
        overdue: isOverdue(
          { payment_status: entry.paymentStatus, due_date: entry.dueDate },
          dateKey(today)
        ),
      }));
    const transferLines: AccountStatementLine[] = transfers
      .filter(
        (transfer) =>
          transfer.from_account_id === accountId || transfer.to_account_id === accountId
      )
      .map((transfer) => {
        const incoming = transfer.to_account_id === accountId;
        const counterpartId = incoming
          ? transfer.from_account_id
          : transfer.to_account_id;
        const counterpart =
          accounts.find((account) => account.id === counterpartId)?.name ?? "conta";
        return {
          id: `tr-${transfer.id}`,
          date: transfer.transfer_date,
          description:
            transfer.description?.trim() ||
            (incoming ? `Transferência de ${counterpart}` : `Transferência para ${counterpart}`),
          amount: incoming ? transfer.amount : -transfer.amount,
          kind: incoming ? "transfer_in" : "transfer_out",
        };
      });
    return [...txLines, ...transferLines].sort((a, b) => b.date.localeCompare(a.date));
  }
  const monthGrowth =
    previousMonthProfit === 0
      ? monthProfit > 0
        ? 100
        : 0
      : ((monthProfit - previousMonthProfit) / Math.abs(previousMonthProfit)) * 100;
  const growthPositive = monthGrowth >= 0;

  const revenueRange = resolveDateRange(
    revenueFilters.granularity,
    revenueFilters.anchor,
    revenueFilters.customStart,
    revenueFilters.customEnd,
    today
  );
  const expenseRange = resolveDateRange(
    expenseFilters.granularity,
    expenseFilters.anchor,
    expenseFilters.customStart,
    expenseFilters.customEnd,
    today
  );
  // O mesmo nome que aparece na lista de lançamentos: fantasia quando tem.
  const supplierChoices = suppliers.map((supplier) => ({
    value: supplier.id,
    label: supplierDisplayName(supplier),
  }));
  const expenseSupplierFilterOptions = [
    { value: categoryFilterAll, label: "Todos" },
    ...supplierChoices,
  ];
  const expenseSupplierOptions = [
    { value: categoryFilterAll, label: "Sem fornecedor" },
    ...supplierChoices,
  ];
  const activeAccountOptions = accounts
    .filter((account) => account.active)
    .map((account) => ({ value: account.id, label: account.name }));
  const revenueCategorySelectOptions = categoriesOfType(categories, "receita").map(
    (category) => ({ value: category.id, label: category.name })
  );
  const expenseCategorySelectOptions = categoriesOfType(categories, "despesa").map(
    (category) => ({ value: category.id, label: category.name })
  );
  const revenueCategoryFilterOptions = [
    { value: categoryFilterAll, label: "Todas" },
    ...[...new Set(revenueEntries.map((entry) => entry.category))].map((name) => ({
      value: name,
      label: name,
    })),
  ];
  // Cliente só existe nas receitas que vieram da agenda, e vem como nome.
  const revenueClientFilterOptions = [
    { value: categoryFilterAll, label: "Todos" },
    ...[
      ...new Set(
        revenueEntries
          .map((entry) => entry.clientName)
          .filter((name): name is string => Boolean(name))
      ),
    ]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name })),
  ];
  const accountFilterOptions = [
    { value: categoryFilterAll, label: "Todas" },
    { value: unassignedAccountFilter, label: "Sem conta definida" },
    ...accounts.map((account) => ({ value: account.id, label: account.name })),
  ];
  const expenseCategoryFilterOptions = [
    { value: categoryFilterAll, label: "Todas" },
    ...[...new Set(expenseEntries.map((entry) => entry.category))].map((name) => ({
      value: name,
      label: name,
    })),
  ];
  const todayKeyForFilters = dateKey(today);
  const filteredRevenueEntries = revenueEntries.filter((entry) =>
    matchesFinanceFilter(
      entry,
      revenueFilters,
      revenueRange,
      todayKeyForFilters,
      (item) => item.clientName
    )
  );
  const filteredExpenseEntries = expenseEntries.filter((entry) =>
    matchesFinanceFilter(
      entry,
      expenseFilters,
      expenseRange,
      todayKeyForFilters,
      (item) => item.supplierId
    )
  );

  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  );

  const upcomingDueItems = useMemo(() => {
    const todayKeyValue = dateKey(today);
    return transactionEntries
      .filter((entry) =>
        inDueAlertWindow(
          { payment_status: entry.paymentStatus, due_date: entry.dueDate },
          todayKeyValue
        )
      )
      .sort((a, b) => {
        const aOverdue = isOverdue(
          { payment_status: a.paymentStatus, due_date: a.dueDate },
          todayKeyValue
        );
        const bOverdue = isOverdue(
          { payment_status: b.paymentStatus, due_date: b.dueDate },
          todayKeyValue
        );
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      })
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
      }));
  }, [accountNames, today, transactionEntries]);

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
    const bucket = (label: string, start: Date, end: Date) => {
      const range = { start, end };
      return {
        label,
        revenue: sumEntries(
          revenueEntries.filter((e) => isDateInRange(e.date, range))
        ),
        expense: sumEntries(
          expenseEntries.filter((e) => isDateInRange(e.date, range))
        ),
      };
    };

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
    // Em linha o período vira semanas: o mês a mês não mostra o movimento
    // dentro do mês, e a linha aguenta a série longa que a barra não aguenta.
    if (overviewChartMode === "line") {
      const monthsBack =
        overviewChartInterval === "1m"
          ? 0
          : overviewChartInterval === "3m"
            ? 2
            : overviewChartInterval === "1a"
              ? 11
              : 5;
      const periodStart = startOfMonth(addMonths(today, -monthsBack));
      // Para no dia de hoje: semanas futuras entrariam zeradas e a linha
      // despencaria no fim por falta de dado, não por queda de verdade.
      const periodEnd = endOfDay(today);
      const weeks: { label: string; start: Date; end: Date }[] = [];
      const cursor = new Date(periodStart);

      while (cursor <= periodEnd) {
        const weekEnd = new Date(cursor);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weeks.push({
          label: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
          start: new Date(cursor),
          end: endOfDay(weekEnd > periodEnd ? periodEnd : weekEnd),
        });
        cursor.setDate(cursor.getDate() + 7);
      }

      return weeks.map(({ label, start, end }) => bucket(label, start, end));
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
  }, [overviewChartInterval, overviewChartMode, revenueEntries, expenseEntries, today, monthlyReport]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const storedUnit = toCurrencyNumber(item.unit_price);
      const catalogPrice = toCurrencyNumber(service?.price);
      const unitPrice = storedUnit > 0 ? storedUnit : catalogPrice;
      const subtotal = unitPrice * (Number(item.quantity) || 1);
      acc[serviceName] = (acc[serviceName] ?? 0) + subtotal;
    });
    return acc;
  }, {});
  const serviceRankingAll = Object.entries(serviceRevenue)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  // O donut continua sendo os cinco primeiros: fatia por fatia, mais que isso
  // vira rodela ilegível.
  const serviceRanking = serviceRankingAll.slice(0, RANKING_PREVIEW_SIZE);
  const serviceTotal = serviceRanking.reduce((total, item) => total + item.amount, 0);
  const donutSegments = serviceRanking.reduce<
    { name: string; amount: number; dash: number; offset: number }[]
  >((segments, item) => {
    const previous = segments.reduce((total, segment) => total + segment.dash, 0);
    const dash = serviceTotal > 0 ? (item.amount / serviceTotal) * 100 : 0;
    return [...segments, { ...item, dash, offset: -previous }];
  }, []);

  const clientRankingAll = Object.values(
    reportOrders.reduce<Record<string, { name: string; amount: number }>>((acc, order) => {
      const clientName = firstRelation(order.clients)?.name ?? "Cliente não encontrado";
      acc[clientName] = {
        name: clientName,
        amount: (acc[clientName]?.amount ?? 0) + toCurrencyNumber(order.total_amount),
      };
      return acc;
    }, {})
  ).sort((a, b) => b.amount - a.amount);
  const clientRanking = clientRankingAll.slice(0, RANKING_PREVIEW_SIZE);

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
  const fixedCostTransactionsBySource = useMemo(
    () => getFixedCostTransactionsBySource(transactions),
    [transactions]
  );
  const currentMonthSourceKey = yearMonthKey(today.getFullYear(), today.getMonth());
  const fixedMonthlyTotal = activeFixedCosts.reduce((total, cost) => {
    if (cost.kind === "estimated") {
      const launched = fixedCostTransactionsBySource.get(
        fixedCostExpenseSource(cost.id, currentMonthSourceKey)
      );
      return (
        total +
        (launched
          ? toCurrencyNumber(launched.amount)
          : toCurrencyNumber(cost.amount))
      );
    }
    return total + toCurrencyNumber(cost.amount);
  }, 0);
  const monthlyServiceCount = reportOrders.filter((order) => {
    const orderDate = getOrderDate(order);
    return orderDate ? isDateInRange(orderDate, currentMonthRange) : false;
  }).length;
  const costPerService =
    monthlyServiceCount > 0 ? monthExpenseTotal / monthlyServiceCount : 0;

  function resetForm(type: TransactionType) {
    const accountId = defaultAccountId(accounts);
    if (type === "receita") {
      setRevenueForm({
        ...initialRevenueForm,
        date: dateKey(today),
        effectiveDate: dateKey(today),
        dueDate: dateKey(today),
        accountId,
        categoryId:
          matchCategoryId(categories, "receita", "Serviço") ||
          revenueCategorySelectOptions[0]?.value ||
          "",
      });
      setEditingRevenueId(null);
      return;
    }

    setExpenseForm({
      ...initialExpenseForm,
      date: dateKey(today),
      effectiveDate: dateKey(today),
      dueDate: dateKey(today),
      accountId,
      categoryId:
        matchCategoryId(categories, "despesa", "Produtos") ||
        expenseCategorySelectOptions[0]?.value ||
        "",
    });
    setEditingExpenseId(null);
    setEditingGroupId(null);
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

    if (!form.accountId) {
      setFormError("Selecione a conta do lançamento.");
      return;
    }
    if (!form.categoryId) {
      setFormError("Selecione a categoria.");
      return;
    }

    const categoryName =
      (type === "receita"
        ? revenueCategorySelectOptions
        : expenseCategorySelectOptions
      ).find((option) => option.value === form.categoryId)?.label ?? "Outros";

    let amount: number;
    try {
      amount = parseMoney(form.amount, { min: 0 });
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
    const paymentStatus = form.installmentsEnabled ? "pendente" : form.paymentStatus;
    const effectiveDate =
      paymentStatus === "pago" ? form.effectiveDate || form.date : null;
    const dueDate =
      paymentStatus === "pago" ? form.dueDate || null : form.dueDate || form.date;
    const transactionPayload = {
      description: form.description.trim(),
      amount,
      category: categoryName,
      category_id: form.categoryId,
      account_id: form.accountId,
      payment_status: paymentStatus,
      effective_date: effectiveDate,
      due_date: dueDate,
      transaction_date: form.date,
      items: transactionItemsToRow(form.items),
      invoice_number: form.invoiceNumber.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (transactionId) {
      // Editando pelo cabeçalho do parcelamento: só os campos comuns mudam em
      // todas as parcelas. Valor, vencimento e status são de cada uma.
      if (type === "despesa" && editingGroupId) {
        const base = installmentBaseDescription(form.description.trim());
        const shared = {
          category: categoryName,
          category_id: form.categoryId,
          account_id: form.accountId,
          supplier_id: supplierId,
          transaction_date: form.date,
        };
        const groupEntries = expenseEntries.filter(
          (item) => item.installmentGroupId === editingGroupId
        );

        // Todas de uma vez: o "(n/total)" saiu da descrição, então as parcelas
        // do grupo passam a ter exatamente o mesmo nome.
        const { error: groupError } = await supabase
          .from("financial_transactions")
          .update({ ...shared, description: base })
          .in("id", groupEntries.map((item) => item.id))
          .eq("workshop_id", workshopId);

        setSaving(false);
        if (groupError) {
          setFormError(formatSupplierSaveError(groupError.message));
          return;
        }

        setEditingGroupId(null);
        closeManualForm(type);
        void loadFinanceData();
        return;
      }

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

      if (
        updateError &&
        (isMissingColumnError(updateError, "category_id") ||
          isMissingColumnError(updateError, "account_id") ||
          isMissingColumnError(updateError, "effective_date") ||
          isMissingColumnError(updateError, "due_date") ||
          isMissingColumnError(updateError, "items") ||
          isMissingColumnError(updateError, "invoice_number"))
      ) {
        const { category_id: _categoryId, account_id: _accountId, effective_date: _effectiveDate, due_date: _dueDate, items: _items, invoice_number: _invoiceNumber, ...legacyPayload } =
          transactionPayload;
        const legacyCashflow = await supabase
          .from("financial_transactions")
          .update({ ...legacyPayload, supplier_id: supplierId })
          .eq("id", transactionId)
          .eq("workshop_id", workshopId);
        updateError = legacyCashflow.error;
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

    if (type === "despesa" && form.installmentsEnabled) {
      const count = Number(form.installmentCount);
      if (!Number.isInteger(count) || count < 2 || count > 60) {
        setSaving(false);
        setFormError("Informe entre 2 e 60 parcelas.");
        return;
      }

      // A tabela da tela é a verdade: vencimento, valor e observação de cada
      // parcela podem ter sido mexidos à mão antes de salvar.
      const firstDue = dueDate || form.date;
      const drafts =
        form.installments.length === count
          ? form.installments
          : buildInstallments(amount, count, form.installmentPeriod, firstDue);

      const parcelAmounts = drafts.map((row) => parseFilterAmount(row.amount) ?? 0);
      if (parcelAmounts.some((value) => value <= 0)) {
        setSaving(false);
        setFormError("Cada parcela precisa de um valor maior que zero.");
        return;
      }

      const groupId = crypto.randomUUID();
      const rows = drafts.map((row, index) => ({
        workshop_id: workshopId,
        type: "despesa" as const,
        description: form.description.trim(),
        amount: parcelAmounts[index],
        category: categoryName,
        category_id: form.categoryId,
        account_id: form.accountId,
        supplier_id: supplierId,
        payment_status: (row.paid ? "pago" : "pendente") as PaymentStatus,
        // Marcada como paga aqui, a data do pagamento é o próprio vencimento;
        // dá para corrigir depois no card do lançamento.
        effective_date: row.paid ? row.dueDate : null,
        due_date: row.dueDate,
        notes: row.notes.trim() || null,
        transaction_date: form.date,
        installment_group_id: groupId,
        installment_number: index + 1,
        installment_total: count,
      }));

      const { error: groupError } = await supabase
        .from("financial_transactions")
        .insert(rows);

      setSaving(false);
      if (groupError) {
        setFormError(
          isMissingColumnError(groupError, "installment_group_id") ||
            isMissingColumnError(groupError, "due_date")
            ? "Aplique as migrations 034 e 035 no Supabase (SQL Editor) para vencimento e parcelamento."
            : formatSupplierSaveError(groupError.message)
        );
        return;
      }

      void loadFinanceData();
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

    if (
      insertError &&
      (isMissingColumnError(insertError, "category_id") ||
        isMissingColumnError(insertError, "account_id") ||
        isMissingColumnError(insertError, "effective_date") ||
        isMissingColumnError(insertError, "due_date") ||
        isMissingColumnError(insertError, "items") ||
        isMissingColumnError(insertError, "invoice_number"))
    ) {
      const { category_id: _categoryId, account_id: _accountId, effective_date: _effectiveDate, due_date: _dueDate, items: _items, invoice_number: _invoiceNumber, ...legacyPayload } =
        transactionPayload;
      const legacyCashflow = await supabase
        .from("financial_transactions")
        .insert({
          workshop_id: workshopId,
          type,
          ...legacyPayload,
          supplier_id: supplierId,
        })
        .select("id")
        .single();
      insertedRow = legacyCashflow.data;
      insertError = legacyCashflow.error;
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
      effectiveDate: entry.effectiveDate || entry.date,
      dueDate: entry.dueDate || entry.date,
      categoryId:
        entry.categoryId ||
        matchCategoryId(categories, "receita", entry.category),
      accountId: entry.accountId || defaultAccountId(accounts),
      paymentStatus: entry.paymentStatus ?? "pago",
      supplierId: categoryFilterAll,
      installmentsEnabled: false,
      installmentCount: "3",
      installmentPeriod: "mensal",
      installments: [],
      invoiceNumber: entry.invoiceNumber ?? "",
      items: entry.items ?? [],
      notes: entry.notes ?? "",
    });
    setRevenueError(null);
    setShowRevenueForm(false);
    setEditingRevenueId(entry.id);
  }

  function handleChangePaymentStatus(
    entry: FinanceEntry,
    nextStatus: PaymentStatus
  ) {
    if (entry.paymentStatus === nextStatus) return;
    if (nextStatus === "pago") {
      setPaidConfirm(entry);
      return;
    }
    void applyPaymentStatus(entry, nextStatus, null);
  }

  async function applyPaymentStatus(
    entry: FinanceEntry,
    nextStatus: PaymentStatus,
    effectiveDate: string | null,
    accountId?: string
  ) {
    const previousStatus = entry.paymentStatus ?? "pendente";
    const previousEffective = entry.effectiveDate ?? null;
    const previousAccount = entry.accountId ?? null;
    const nextEffective =
      nextStatus === "pago" ? effectiveDate || dateKey(today) : null;
    const nextAccount =
      nextStatus === "pago" ? accountId || previousAccount : previousAccount;
    setError(null);

    if (entry.serviceOrderId) {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === entry.serviceOrderId
            ? { ...order, payment_status: nextStatus }
            : order
        )
      );
    }

    writeStoredTxPaymentStatus(entry.id, nextStatus);
    setTransactions((prev) =>
      prev.map((transaction) =>
        transaction.id === entry.id
          ? {
              ...transaction,
              payment_status: nextStatus,
              effective_date: nextEffective,
              account_id: nextAccount,
            }
          : transaction
      )
    );

    if (entry.serviceOrderId) {
      const { error: orderError } = await supabase
        .from("service_orders")
        .update({ payment_status: nextStatus })
        .eq("id", entry.serviceOrderId);

      if (orderError) {
        setOrders((prev) =>
          prev.map((order) =>
            order.id === entry.serviceOrderId
              ? { ...order, payment_status: previousStatus }
              : order
          )
        );
        writeStoredTxPaymentStatus(entry.id, previousStatus);
        setTransactions((prev) =>
          prev.map((transaction) =>
            transaction.id === entry.id
              ? {
                  ...transaction,
                  payment_status: previousStatus,
                  effective_date: previousEffective,
                  account_id: previousAccount,
                }
              : transaction
          )
        );
        setError(orderError.message);
        return;
      }
    }

    const payload = {
      payment_status: nextStatus,
      effective_date: nextEffective,
      ...(nextAccount ? { account_id: nextAccount } : {}),
    };

    let { error: updateError } = await supabase
      .from("financial_transactions")
      .update(payload)
      .eq("id", entry.id)
      .eq("workshop_id", workshopId);

    if (
      isMissingColumnError(updateError, "effective_date") ||
      isMissingColumnError(updateError, "account_id")
    ) {
      const fallback = await supabase
        .from("financial_transactions")
        .update({ payment_status: nextStatus })
        .eq("id", entry.id)
        .eq("workshop_id", workshopId);
      updateError = fallback.error;
    }

    if (!updateError) {
      clearStoredTxPaymentStatus(entry.id);
      return;
    }

    if (isMissingColumnError(updateError, "payment_status")) {
      return;
    }

    if (entry.serviceOrderId) {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === entry.serviceOrderId
            ? { ...order, payment_status: previousStatus }
            : order
        )
      );
    }
    writeStoredTxPaymentStatus(entry.id, previousStatus);
    setTransactions((prev) =>
      prev.map((transaction) =>
        transaction.id === entry.id
          ? {
              ...transaction,
              payment_status: previousStatus,
              effective_date: previousEffective,
              account_id: previousAccount,
            }
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
      effectiveDate: entry.effectiveDate || entry.date,
      dueDate: entry.dueDate || entry.date,
      categoryId:
        entry.categoryId ||
        matchCategoryId(categories, "despesa", entry.category),
      accountId: entry.accountId || defaultAccountId(accounts),
      paymentStatus: entry.paymentStatus ?? "pago",
      supplierId: entry.supplierId ?? categoryFilterAll,
      installmentsEnabled: false,
      installmentCount: "3",
      installmentPeriod: "mensal",
      installments: [],
      invoiceNumber: entry.invoiceNumber ?? "",
      items: entry.items ?? [],
      notes: entry.notes ?? "",
    });
    setExpenseError(null);
    setShowExpenseForm(false);
    setEditingExpenseId(entry.id);
    setEditingGroupId(null);
  }

  /** Edita o parcelamento pelo cabeçalho: vale para todas as parcelas. */
  function handleEditInstallmentGroup(entries: FinanceEntry[]) {
    const first = entries[0];
    if (!first) return;
    handleEditExpense(first);
    setEditingGroupId(first.installmentGroupId ?? null);
  }

  function resetFixedCostForm() {
    setEditingFixedCostId(null);
    setFixedCostForm(initialFixedCostForm);
    setFixedCostError(null);
    setShowFixedCostForm(false);
  }

  function handleEditFixedCost(cost: FixedCost) {
    setEditingFixedCostId(cost.id);
    const storedAmount = toCurrencyNumber(cost.amount);
    setFixedCostForm({
      name: cost.name,
      kind: cost.kind,
      amount: storedAmount > 0 ? formatMoneyInput(storedAmount) : "",
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

    let amount = 0;
    try {
      amount =
        fixedCostForm.kind === "real"
          ? parseMoney(fixedCostForm.amount)
          : parseOptionalMoney(fixedCostForm.amount);
    } catch (err) {
      setFixedCostError(
        err instanceof Error ? err.message : "Informe um valor válido."
      );
      return;
    }

    const paymentDay = Number(fixedCostForm.paymentDay);
    if (!Number.isFinite(paymentDay) || paymentDay < 1 || paymentDay > 31) {
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
      payment_day: paymentDay,
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

  async function handleLaunchEstimatedCost(cost: FixedCost) {
    if (!workshopId) {
      setLaunchErrors((prev) => ({
        ...prev,
        [cost.id]: "Oficina não encontrada.",
      }));
      return;
    }

    const pending = getPendingEstimatedLaunch(
      cost,
      fixedCostTransactionsBySource,
      today
    );
    if (!pending) {
      setLaunchErrors((prev) => ({
        ...prev,
        [cost.id]: "Nenhum lançamento pendente.",
      }));
      return;
    }

    const lastAmount = getLastLaunchedEstimatedAmount(
      cost,
      fixedCostTransactionsBySource
    );
    const draft =
      launchDrafts[cost.id] ??
      (lastAmount > 0 ? formatMoneyInput(lastAmount) : "");

    let amount: number;
    try {
      amount = parseMoney(draft);
    } catch (err) {
      setLaunchErrors((prev) => ({
        ...prev,
        [cost.id]:
          err instanceof Error ? err.message : "Informe um valor válido.",
      }));
      return;
    }

    setLaunchingCostId(cost.id);
    setLaunchErrors((prev) => {
      const next = { ...prev };
      delete next[cost.id];
      return next;
    });

    const defaults = await resolveDefaultCashflowIds(
      supabase,
      workshopId,
      "despesa",
      FIXED_COST_CATEGORY_NAME
    );

    const { data, error } = await supabase
      .from("financial_transactions")
      .insert({
        workshop_id: workshopId,
        type: "despesa",
        description: cost.name,
        amount,
        category: FIXED_COST_CATEGORY_NAME,
        transaction_date: pending.paymentDate,
        source: pending.source,
        ...(defaults.accountId ? { account_id: defaults.accountId } : {}),
        ...(defaults.categoryId ? { category_id: defaults.categoryId } : {}),
        payment_status: "pendente",
        due_date: pending.paymentDate,
      })
      .select(TRANSACTION_SELECT_PHASE2)
      .single();

    let saved: unknown = data;
    let saveError = error;

    if (isDuplicateRowError(saveError)) {
      // Alguém já lançou este mês — clique repetido ou outra aba aberta.
      setLaunchingCostId(null);
      setLaunchErrors((prev) => ({
        ...prev,
        [cost.id]: "Este mês já foi lançado.",
      }));
      void loadFinanceData();
      return;
    }

    if (saveError) {
      const legacyInsert = await supabase
        .from("financial_transactions")
        .insert({
          workshop_id: workshopId,
          type: "despesa",
          description: cost.name,
          amount,
          category: "Custo Fixo",
          transaction_date: pending.paymentDate,
          source: pending.source,
          payment_status: "pendente",
        })
        .select(TRANSACTION_SELECT_FULL)
        .single();

      saved = legacyInsert.data;
      saveError = legacyInsert.error;
    }

    setLaunchingCostId(null);

    if (saveError || !saved) {
      setLaunchErrors((prev) => ({
        ...prev,
        [cost.id]: saveError?.message ?? "Não foi possível lançar a despesa.",
      }));
      return;
    }

    const normalized = normalizeTransactionRow(saved as Record<string, unknown>);
    setTransactions((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      byId.set(normalized.id, normalized);
      return Array.from(byId.values());
    });
    setLaunchDrafts((prev) => {
      const next = { ...prev };
      delete next[cost.id];
      return next;
    });
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
    if (entry.installmentGroupId) {
      const remaining = expenseEntries.filter(
        (item) =>
          item.installmentGroupId === entry.installmentGroupId &&
          item.paymentStatus !== "pago"
      );
      if (remaining.length > 1) {
        setDeleteConfirm({ type: "installmentGroup", entry, remaining });
        return;
      }
    }
    setDeleteConfirm({ type: "transaction", entry });
  }

  async function executeDeleteWholeInstallment(entries: FinanceEntry[]) {
    setDeletingFinanceItem(true);
    setError(null);
    const ids = entries.map((item) => item.id);
    try {
      const { error: deleteError } = await supabase
        .from("financial_transactions")
        .delete()
        .in("id", ids);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      setTransactions((prev) =>
        prev.filter((transaction) => !ids.includes(transaction.id))
      );
      setDeleteConfirm(null);
    } finally {
      setDeletingFinanceItem(false);
    }
  }

  async function executeDeleteInstallmentGroup(remaining: FinanceEntry[]) {
    setDeletingFinanceItem(true);
    setError(null);
    const ids = remaining.map((item) => item.id);
    try {
      const { error: deleteError } = await supabase
        .from("financial_transactions")
        .delete()
        .in("id", ids);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }
      setTransactions((prev) => prev.filter((item) => !ids.includes(item.id)));
      setDeleteConfirm(null);
    } finally {
      setDeletingFinanceItem(false);
    }
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

  async function handleSaveAccount(input: {
    id?: string;
    name: string;
    type: FinancialAccount["type"];
    initialBalance: string;
  }) {
    if (!workshopId) throw new Error("Oficina não encontrada.");
    const normalized = input.initialBalance.replace(/\./g, "").replace(",", ".");
    const initialBalance = Number(normalized || 0);
    if (!Number.isFinite(initialBalance)) {
      throw new Error("Informe um saldo inicial válido.");
    }
    // Editando: ativa/inativa e conta padrão não são deste formulário, então
    // o que está salvo manda — senão salvar o nome reativaria a conta.
    const existing = input.id
      ? accounts.find((account) => account.id === input.id)
      : undefined;
    const saved = await saveFinancialAccount(supabase, workshopId, {
      id: input.id,
      name: input.name,
      type: input.type,
      initial_balance: initialBalance,
      active: existing?.active ?? true,
    });
    setAccounts((prev) =>
      [...prev.filter((account) => account.id !== saved.id), saved].sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR")
      )
    );
  }

  async function handleSetDefaultAccount(accountId: string) {
    if (!workshopId) return;
    await setDefaultFinancialAccount(supabase, workshopId, accountId);
    setAccounts((prev) =>
      prev.map((account) => ({
        ...account,
        is_default: account.id === accountId,
      }))
    );
  }

  async function handleToggleAccount(account: FinancialAccount) {
    if (!workshopId) return;
    const saved = await saveFinancialAccount(supabase, workshopId, {
      id: account.id,
      name: account.name,
      type: account.type,
      initial_balance: account.initial_balance,
      active: !account.active,
    });
    setAccounts((prev) =>
      prev.map((item) => (item.id === saved.id ? saved : item))
    );
  }

  /**
   * Cadastro de categoria pelo dropdown do lançamento, que é onde a falta
   * aparece. O tipo vem da página: em Receitas nasce receita, em Despesas
   * despesa — não há o que escolher. Já sai selecionada.
   */
  async function handleCreateCategory(name: string, type: TransactionType) {
    const trimmed = name.trim();
    const repeated = categories.find(
      (category) =>
        category.type === type &&
        category.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (repeated) {
      // Já existe mas estava desativada: reativa em vez de duplicar.
      if (!repeated.active) {
        try {
          await handleSaveCategory({
            id: repeated.id,
            name: repeated.name,
            type: repeated.type,
            active: true,
          });
        } catch (err) {
          return err instanceof Error ? err.message : "Não foi possível criar.";
        }
      }
      selectCategory(repeated.id, type);
      return;
    }

    if (!workshopId) return "Oficina não encontrada.";

    try {
      const saved = await saveFinancialCategory(supabase, workshopId, {
        name: trimmed,
        type,
        active: true,
      });
      setCategories((prev) =>
        [...prev.filter((category) => category.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR")
        )
      );
      selectCategory(saved.id, type);
    } catch (err) {
      return err instanceof Error ? err.message : "Não foi possível criar.";
    }
  }

  function selectCategory(categoryId: string, type: TransactionType) {
    const setForm = type === "receita" ? setRevenueForm : setExpenseForm;
    setForm((prev) => ({ ...prev, categoryId }));
  }

  async function handleSaveCategory(input: {
    id?: string;
    name: string;
    type: TransactionType;
    active: boolean;
  }) {
    if (!workshopId) throw new Error("Oficina não encontrada.");
    const saved = await saveFinancialCategory(supabase, workshopId, input);
    setCategories((prev) => {
      const next = [...prev.filter((category) => category.id !== saved.id), saved];
      return next.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    });
  }

  async function handleSubmitTransfer(input: {
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    date: string;
    description: string;
  }) {
    if (!workshopId) {
      setTransferError("Oficina não encontrada.");
      return;
    }
    if (!input.fromAccountId || !input.toAccountId) {
      setTransferError("Selecione as contas de origem e destino.");
      return;
    }
    if (input.fromAccountId === input.toAccountId) {
      setTransferError("Origem e destino precisam ser contas diferentes.");
      return;
    }

    let amount: number;
    try {
      amount = parseMoney(input.amount);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Informe um valor válido.");
      return;
    }

    setSavingTransfer(true);
    setTransferError(null);
    const { data, error: insertError } = await supabase
      .from("financial_transfers")
      .insert({
        workshop_id: workshopId,
        from_account_id: input.fromAccountId,
        to_account_id: input.toAccountId,
        amount,
        transfer_date: input.date,
        description: input.description.trim() || null,
      })
      .select(
        "id, workshop_id, from_account_id, to_account_id, amount, transfer_date, description, created_at"
      )
      .single();

    setSavingTransfer(false);

    if (insertError || !data) {
      setTransferError(
        insertError?.message ?? "Não foi possível registrar a transferência."
      );
      return;
    }

    setTransfers((prev) => [
      { ...data, amount: Number(data.amount) || 0 } as FinancialTransfer,
      ...prev,
    ]);
    setShowTransfer(false);
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
        {/* Cabem quantas couberem numa linha só: a escada fixa de colunas era
            para sete abas e deixava a Caixa sozinha embaixo depois que
            sobraram cinco. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-1.5">
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
                    <span className="icon-chip h-10 w-10">
                      <CalendarCheck size={20} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    </span>
                    <div>
                      <h2 className="section-title">
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

                <UpcomingDuesSection
                  items={upcomingDueItems}
                  today={dateKey(today)}
                  onMarkPaid={(item) => {
                    const entry = transactionEntries.find((row) => row.id === item.id);
                    if (entry) handleChangePaymentStatus(entry, "pago");
                  }}
                />

                <section className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="icon-chip h-10 w-10 bg-success/12 text-success">
                        <ChartBar size={20} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                      </span>
                      <div>
                        <h2 className="section-title">
                          Receita vs despesa
                        </h2>
                        <p className="text-sm text-muted">
                          {chartIntervalOptions.find((o) => o.value === overviewChartInterval)?.title ?? ""}
                          {/* 7D já é dia a dia e 1M já é por semana no título. */}
                          {overviewChartMode === "line" &&
                          overviewChartInterval !== "7d" &&
                          overviewChartInterval !== "1m"
                            ? " · semana a semana"
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
                        {(
                          [
                            { value: "bars", label: "Barras", icon: ChartBar },
                            { value: "line", label: "Linha", icon: ChartLine },
                          ] as const
                        ).map((opt) => {
                          const ModeIcon = opt.icon;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setOverviewChartMode(opt.value)}
                              className={`flex h-7 w-8 items-center justify-center rounded-md transition-all ${
                                overviewChartMode === opt.value
                                  ? "bg-primary text-white shadow-sm"
                                  : "text-muted hover:text-foreground"
                              }`}
                              aria-pressed={overviewChartMode === opt.value}
                              aria-label={`Ver em ${opt.label.toLowerCase()}`}
                              title={`Ver em ${opt.label.toLowerCase()}`}
                            >
                              <ModeIcon
                                size={15}
                                weight={FINANCE_ICON_WEIGHT}
                                aria-hidden
                              />
                            </button>
                          );
                        })}
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
                  </div>
                  <RevenueExpenseChart
                    data={overviewChartData}
                    maxValue={overviewChartMaxValue}
                    mode={overviewChartMode}
                    compact
                  />
                </section>

                <section className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="icon-chip h-10 w-10">
                      <ChartDonut size={20} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                    </span>
                    <div>
                      <h2 className="section-title">
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
                      <div>
                        <div
                          className={`space-y-3 ${
                            showAllServiceRanking
                              ? "max-h-80 overflow-y-auto pr-1"
                              : ""
                          }`}
                        >
                          {(showAllServiceRanking
                            ? serviceRankingAll
                            : serviceRanking
                          ).map((item, index) => (
                            <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg bg-background px-4 py-3">
                              <span className="flex min-w-0 items-center gap-2.5 truncate text-sm font-semibold text-foreground">
                                {/* Fora dos cinco do donut a bolinha some: repetir
                                    a cor diria que o item é aquela fatia. */}
                                <span
                                  className={`h-3 w-3 shrink-0 rounded-full ${
                                    index < RANKING_PREVIEW_SIZE ? "" : "bg-border"
                                  }`}
                                  style={
                                    index < RANKING_PREVIEW_SIZE
                                      ? { background: DONUT_COLORS[index % DONUT_COLORS.length] }
                                      : undefined
                                  }
                                />
                                {index + 1}. {item.name}
                              </span>
                              <span className="shrink-0 text-sm font-bold text-foreground">
                                {formatCurrency(item.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                        {serviceRankingAll.length > RANKING_PREVIEW_SIZE && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowAllServiceRanking((value) => !value)
                            }
                            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                          >
                            {showAllServiceRanking ? (
                              <>
                                <CaretUp size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                                Ver menos
                              </>
                            ) : (
                              <>
                                <CaretDown size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                                Ver todos os {serviceRankingAll.length} serviços
                              </>
                            )}
                          </button>
                        )}
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
                <h2 className="section-title">
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
                  <div
                    className={`space-y-1.5 ${
                      showAllClientRanking ? "max-h-72 overflow-y-auto pr-1" : ""
                    }`}
                  >
                    {clientRanking.length > 0 ? (
                      (showAllClientRanking
                        ? clientRankingAll
                        : clientRanking
                      ).map((client, index) => (
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
                  {clientRankingAll.length > RANKING_PREVIEW_SIZE && (
                    <button
                      type="button"
                      onClick={() => setShowAllClientRanking((value) => !value)}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                    >
                      {showAllClientRanking ? (
                        <>
                          <CaretUp size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                          Ver menos
                        </>
                      ) : (
                        <>
                          <CaretDown size={12} weight={FINANCE_ICON_WEIGHT} aria-hidden />
                          Ver todos os {clientRankingAll.length} clientes
                        </>
                      )}
                    </button>
                  )}
                </section>
              </div>
            </div>
          )}

          {activeTab === "revenues" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="section-title">
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
              {showRevenueForm && !editingRevenueId && (
                <TransactionFormCard
                  title="Lançar receita manual"
                  description="Use para gorjetas, receitas avulsas ou ajustes."
                  form={revenueForm}
                  categories={revenueCategorySelectOptions}
                  onCreateCategory={(name) => handleCreateCategory(name, "receita")}
                  onManageCategories={() => setManagingCategories("receita")}
                  accountOptions={activeAccountOptions}
                  loading={savingRevenue}
                  error={revenueError}
                  buttonLabel="Salvar receita"
                  onChange={(patch) => setRevenueForm((prev) => ({ ...prev, ...patch }))}
                  onSubmit={(event) => handleSaveManualTransaction(event, "receita")}
                  onCancel={() => closeManualForm("receita")}
                />
              )}
              <TransactionList
                entries={filteredRevenueEntries}
                nfseByTransaction={nfseByTransaction}
                onEmitNfse={setNfseEntry}
                accountNames={accountNames}
                emptyMessage="Nenhuma receita encontrada."
                groupByMonth={revenueFilters.granularity !== "all"}
                editingId={editingRevenueId}
                editForm={
                  editingRevenueId ? (
                    <TransactionFormCard
                      embedded
                      title="Editar receita"
                      description="Atualize os dados deste lançamento."
                      form={revenueForm}
                      categories={revenueCategorySelectOptions}
                      onCreateCategory={(name) => handleCreateCategory(name, "receita")}
                      onManageCategories={() => setManagingCategories("receita")}
                      accountOptions={activeAccountOptions}
                      loading={savingRevenue}
                      error={revenueError}
                      buttonLabel="Atualizar receita"
                      onChange={(patch) => setRevenueForm((prev) => ({ ...prev, ...patch }))}
                      onSubmit={(event) => handleSaveManualTransaction(event, "receita")}
                      onCancel={() => closeManualForm("receita")}
                    />
                  ) : null
                }
                onEditTransaction={handleEditRevenue}
                onChangePaymentStatus={handleChangePaymentStatus}
                onUpdateNotes={handleUpdateTransactionNotes}
                filter={
                  <>
                  <DateRangeFilter
                    value={revenueFilters}
                    today={today}
                    onChange={(patch) =>
                      setRevenueFilters((prev) => ({ ...prev, ...patch }))
                    }
                  />
                  <InlineFilterButton
                    value={revenueFilters}
                    categoryOptions={revenueCategoryFilterOptions}
                    accountOptions={accountFilterOptions}
                    partyOptions={revenueClientFilterOptions}
                    partyLabel="Cliente"
                    settlementLabel="Recebimento"
                    open={showRevenueFilter}
                    onToggle={() => setShowRevenueFilter(true)}
                    onClose={() => setShowRevenueFilter(false)}
                    onChange={(patch) =>
                      setRevenueFilters((prev) => ({ ...prev, ...patch }))
                    }
                    onClear={() =>
                      setRevenueFilters(
                        createFinanceFilterState(
                          dateKey(startOfMonth(today)),
                          dateKey(today)
                        )
                      )
                    }
                    ariaLabel="Filtros de receitas"
                  />
                  </>
                }
                onDeleteTransaction={handleDeleteTransaction}
              />
            </div>
          )}

          {activeTab === "expenses" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="section-title">
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
              {showExpenseForm && !editingExpenseId && (
                <TransactionFormCard
                  title="Lançar despesa"
                  description="Registre compras, custos fixos e investimentos."
                  form={expenseForm}
                  categories={expenseCategorySelectOptions}
                  onCreateCategory={(name) => handleCreateCategory(name, "despesa")}
                  onManageCategories={() => setManagingCategories("despesa")}
                  accountOptions={activeAccountOptions}
                  supplierOptions={expenseSupplierOptions}
                  onCreateSupplier={() => setSupplierFormOpen(true)}
                  stockProducts={stockProducts}
                  loading={savingExpense}
                  error={expenseError}
                  buttonLabel="Salvar despesa"
                  allowInstallments
                  allowItems
                  onChange={(patch) => setExpenseForm((prev) => ({ ...prev, ...patch }))}
                  onSubmit={(event) => handleSaveManualTransaction(event, "despesa")}
                  onCancel={() => closeManualForm("despesa")}
                />
              )}
              <TransactionList
                entries={filteredExpenseEntries}
                accountNames={accountNames}
                editingId={editingExpenseId}
                editForm={
                  editingExpenseId ? (
                    <TransactionFormCard
                      embedded
                      title={editingGroupId ? "Editar parcelamento" : "Editar despesa"}
                      description={
                        editingGroupId
                          ? "Vale para todas as parcelas. Valor, vencimento e status continuam sendo de cada uma."
                          : "Atualize os dados deste lançamento."
                      }
                      sharedFieldsOnly={Boolean(editingGroupId)}
                      allowItems
                      form={expenseForm}
                      categories={expenseCategorySelectOptions}
                      onCreateCategory={(name) => handleCreateCategory(name, "despesa")}
                      onManageCategories={() => setManagingCategories("despesa")}
                      accountOptions={activeAccountOptions}
                      supplierOptions={expenseSupplierOptions}
                      onCreateSupplier={() => setSupplierFormOpen(true)}
                      stockProducts={stockProducts}
                      loading={savingExpense}
                      error={expenseError}
                      buttonLabel={
                        editingGroupId ? "Atualizar parcelamento" : "Atualizar despesa"
                      }
                      onChange={(patch) => setExpenseForm((prev) => ({ ...prev, ...patch }))}
                      onSubmit={(event) => handleSaveManualTransaction(event, "despesa")}
                      onCancel={() => closeManualForm("despesa")}
                    />
                  ) : null
                }
                emptyMessage="Nenhuma despesa registrada"
                emptyDescription="Use o botão + Nova despesa para adicionar um lançamento manual."
                accent="expense"
                onEditGroup={handleEditInstallmentGroup}
                onDeleteGroup={(entries) =>
                  setDeleteConfirm({ type: "wholeInstallment", entries })
                }
                groupInstallments
                filter={
                  <>
                  <DateRangeFilter
                    value={expenseFilters}
                    today={today}
                    onChange={(patch) =>
                      setExpenseFilters((prev) => ({ ...prev, ...patch }))
                    }
                  />
                  <InlineFilterButton
                    value={expenseFilters}
                    categoryOptions={expenseCategoryFilterOptions}
                    accountOptions={accountFilterOptions}
                    partyOptions={expenseSupplierFilterOptions}
                    partyLabel="Fornecedor"
                    settlementLabel="Pagamento"
                    open={showExpenseFilter}
                    onToggle={() => setShowExpenseFilter(true)}
                    onClose={() => setShowExpenseFilter(false)}
                    onChange={(patch) =>
                      setExpenseFilters((prev) => ({ ...prev, ...patch }))
                    }
                    onClear={() =>
                      setExpenseFilters(
                        createFinanceFilterState(
                          dateKey(startOfMonth(today)),
                          dateKey(today),
                          "dueDate"
                        )
                      )
                    }
                    ariaLabel="Filtros de despesas"
                  />
                  </>
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
                <h2 className="section-title">
                  Custos Fixos
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Custo fixo lança sozinho no dia. Estimado pede o valor na hora do
                  lançamento.
                </p>
              </div>

              <div className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
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
                    Custo por serviço
                  </p>
                  <p className="mt-1 text-xl font-bold text-danger">
                    {formatCurrency(costPerService)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-muted">
                    {monthlyServiceCount}{" "}
                    {monthlyServiceCount === 1 ? "serviço" : "serviços"} no mês
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
                    <h2 className="section-title">
                      {editingFixedCostId ? "Editar custo fixo" : "Novo custo fixo"}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      {fixedCostForm.kind === "estimated"
                        ? "Informe o dia e, se quiser, um valor estipulado. Na hora do lançamento você confirma ou ajusta."
                        : "Custos fixos geram despesa automática todo mês na data de pagamento."}
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
                        { value: "real", label: "Custo Fixo" },
                        { value: "estimated", label: "Estimado" },
                      ]}
                      onChange={(kind) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          kind: kind as FixedCostKind,
                        }))
                      }
                    />
                    <Input
                      label={
                        fixedCostForm.kind === "estimated"
                          ? "Valor estipulado (opcional)"
                          : "Valor mensal"
                      }
                      prefix="R$"
                      value={fixedCostForm.amount}
                      onChange={(event) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          amount: event.target.value,
                        }))
                      }
                      placeholder={
                        fixedCostForm.kind === "estimated" ? "180,00" : "250,00"
                      }
                    />
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
                    <Input
                      label="Observação (opcional)"
                      value={fixedCostForm.notes}
                      onChange={(event) =>
                        setFixedCostForm((prev) => ({
                          ...prev,
                          notes: event.target.value,
                        }))
                      }
                      placeholder={
                        fixedCostForm.kind === "estimated"
                          ? "Energia, água, fatura variável..."
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
                <div className="min-w-[40rem]">
                  <div
                    className="grid items-center gap-x-4 border-b border-border px-3 py-3 text-xs font-semibold text-muted"
                    style={{ gridTemplateColumns: FIXED_COST_GRID_COLUMNS }}
                  >
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
                    fixedCosts.map((cost) => {
                      const pendingLaunch = getPendingEstimatedLaunch(
                        cost,
                        fixedCostTransactionsBySource,
                        today
                      );
                      const lastLaunched = getLastLaunchedEstimatedAmount(
                        cost,
                        fixedCostTransactionsBySource
                      );
                      const launchedThisMonth = fixedCostTransactionsBySource.get(
                        fixedCostExpenseSource(cost.id, currentMonthSourceKey)
                      );
                      const launchHint =
                        lastLaunched > 0 ? lastLaunched : toCurrencyNumber(cost.amount);
                      const launchValue =
                        launchDrafts[cost.id] ??
                        (launchHint > 0 ? formatMoneyInput(launchHint) : "");

                      return (
                      <article
                        key={cost.id}
                        className="grid items-center gap-x-4 border-b border-border/70 px-3 py-3 transition-colors hover:bg-background/70"
                        style={{ gridTemplateColumns: FIXED_COST_GRID_COLUMNS }}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {cost.name}
                            </p>
                            {pendingLaunch && (
                              <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning">
                                A lançar
                              </span>
                            )}
                          </div>
                          {cost.notes && (
                            <p className="mt-1 truncate text-xs text-muted">
                              {cost.notes}
                            </p>
                          )}
                          {launchErrors[cost.id] && (
                            <p className="mt-1 text-xs text-danger">
                              {launchErrors[cost.id]}
                            </p>
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {cost.kind === "real" ? "Fixo" : "Estimado"}
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {cost.payment_day ? `Dia ${cost.payment_day}` : "—"}
                        </p>
                        {pendingLaunch ? (
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="relative min-w-0 flex-1">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">
                                  R$
                                </span>
                                <input
                                  aria-label={`Valor para lançar ${cost.name}`}
                                  value={launchValue}
                                  onChange={(event) =>
                                    setLaunchDrafts((prev) => ({
                                      ...prev,
                                      [cost.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="0,00"
                                  className="w-full rounded-md border border-border bg-input py-1.5 pl-8 pr-2 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleLaunchEstimatedCost(cost)}
                                disabled={launchingCostId === cost.id}
                                title={`Lançar ${pendingLaunch.monthLabel}`}
                                className="flex h-8 shrink-0 items-center justify-center rounded-md bg-success px-2 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Check size={16} weight="bold" aria-hidden />
                                <span className="sr-only">
                                  Lançar {pendingLaunch.monthLabel}
                                </span>
                              </button>
                            </div>
                            <p className="mt-1 text-[11px] text-muted">
                              {pendingLaunch.monthLabel}
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm font-bold text-foreground">
                            {cost.kind === "estimated"
                              ? launchedThisMonth
                                ? formatCurrency(
                                    toCurrencyNumber(launchedThisMonth.amount)
                                  )
                                : toCurrencyNumber(cost.amount) > 0
                                  ? formatCurrency(toCurrencyNumber(cost.amount))
                                  : "Aguardando"
                              : formatCurrency(toCurrencyNumber(cost.amount))}
                          </p>
                        )}
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
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "cash" && (
            <div className="space-y-8">
              <AccountsPanel
                accounts={accounts}
                balances={accountBalances}
                statementLines={statementLinesForAccount}
                selectedId={selectedAccountId}
                onSelectAccount={setSelectedAccountId}
                onSaveAccount={handleSaveAccount}
                onSetDefault={handleSetDefaultAccount}
                onToggleActive={handleToggleAccount}
                onOpenTransfer={() => {
                  setTransferError(null);
                  setShowTransfer(true);
                }}
              />
              {/* No extrato de uma conta a projeção sai: ali a conversa é
                  sobre aquela conta, não sobre o caixa inteiro. */}
              {!selectedAccountId && (
                <CashflowProjectionPanel
                  currentBalance={currentCashBalance}
                  entries={transactionEntries}
                  accounts={accounts}
                  transfers={transfers}
                  today={dateKey(today)}
                  onMarkPaid={(item) => {
                    const entry = transactionEntries.find((row) => row.id === item.id);
                    if (entry) handleChangePaymentStatus(entry, "pago");
                  }}
                />
              )}
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
        open={deleteConfirm?.type === "wholeInstallment"}
        title="Excluir parcelamento"
        description={
          deleteConfirm?.type === "wholeInstallment"
            ? `Apagar as ${deleteConfirm.entries.length} parcelas deste lançamento? ${
                deleteConfirm.entries.filter((item) => item.paymentStatus === "pago").length
              } já estão pagas e também serão apagadas.`
            : ""
        }
        confirmLabel="Excluir parcelamento"
        loading={deletingFinanceItem}
        onCancel={() => {
          if (!deletingFinanceItem) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "wholeInstallment") {
            void executeDeleteWholeInstallment(deleteConfirm.entries);
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "installmentGroup"}
        title="Excluir parcela"
        description={
          deleteConfirm?.type === "installmentGroup"
            ? `Esta despesa faz parte de um parcelamento. Excluir só esta parcela ou as ${deleteConfirm.remaining.length} parcelas em aberto?`
            : ""
        }
        confirmLabel="Só esta parcela"
        extraLabel={
          deleteConfirm?.type === "installmentGroup"
            ? `Excluir ${deleteConfirm.remaining.length} em aberto`
            : undefined
        }
        loading={deletingFinanceItem}
        onCancel={() => {
          if (!deletingFinanceItem) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "installmentGroup") {
            void executeDeleteTransaction(deleteConfirm.entry, false);
          }
        }}
        onExtra={() => {
          if (deleteConfirm?.type === "installmentGroup") {
            void executeDeleteInstallmentGroup(deleteConfirm.remaining);
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

      <ConfirmPaidDialog
        open={Boolean(paidConfirm)}
        defaultDate={dateKey(today)}
        accounts={activeAccountOptions.map((option) => ({
          id: option.value,
          name: option.label,
        }))}
        defaultAccountId={paidConfirm?.accountId || defaultAccountId(accounts)}
        type={paidConfirm?.type}
        loading={savingPaid}
        onCancel={() => {
          if (!savingPaid) setPaidConfirm(null);
        }}
        onConfirm={(effectiveDate, accountId) => {
          if (!paidConfirm) return;
          setSavingPaid(true);
          void applyPaymentStatus(
            paidConfirm,
            "pago",
            effectiveDate,
            accountId
          ).finally(() => {
            setSavingPaid(false);
            setPaidConfirm(null);
          });
        }}
      />

      <TransferDialog
        open={showTransfer}
        accounts={accounts.filter((account) => account.active)}
        loading={savingTransfer}
        error={transferError}
        onCancel={() => {
          if (!savingTransfer) {
            setShowTransfer(false);
            setTransferError(null);
          }
        }}
        onSubmit={(input) => {
          void handleSubmitTransfer(input);
        }}
      />

      <NfseDialog
        key={nfseEntry?.id ?? "nfse-fechado"}
        open={nfseEntry !== null}
        transactionId={nfseEntry?.id ?? ""}
        description={
          nfseEntry
            ? [nfseEntry.serviceName, nfseEntry.description]
                .filter(Boolean)
                .join(" · ")
            : ""
        }
        amount={nfseEntry?.amount ?? 0}
        client={null}
        clientOptions={nfseClients}
        existing={nfseEntry ? nfseByTransaction.get(nfseEntry.id) ?? null : null}
        onClose={() => setNfseEntry(null)}
        onIssued={(invoice) => {
          if (!nfseEntry) return;
          setNfseByTransaction((prev) => {
            const next = new Map(prev);
            next.set(nfseEntry.id, invoice);
            return next;
          });
        }}
      />

      <CategoryManagerDialog
        open={managingCategories !== null}
        type={managingCategories ?? "despesa"}
        categories={categories}
        onSave={handleSaveCategory}
        onClose={() => setManagingCategories(null)}
      />

      <SupplierQuickForm
        open={supplierFormOpen}
        supabase={supabase}
        workshopId={workshopId}
        onClose={() => setSupplierFormOpen(false)}
        onCreated={(supplier) => {
          setSuppliers((prev) => mergeSuppliers(prev, [supplier]));
          setExpenseForm((prev) => ({ ...prev, supplierId: supplier.id }));
        }}
      />
    </div>
  );
}
