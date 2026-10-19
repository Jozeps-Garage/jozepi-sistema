import { createClient } from "@/lib/supabase/client";
import { toCurrencyNumber } from "@/lib/reports/date-range";
import { DEFAULT_TIME_ZONE, isMissingTimezoneError, resolveTimeZone } from "@/lib/timezone";
import type {
  ReportClient,
  ReportExpenseEntry,
  ReportRevenueEntry,
  ReportTransactionRow,
  ReportsSourceData,
} from "@/lib/reports/types";

type Supabase = ReturnType<typeof createClient>;

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toSequentialNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

interface RawTransaction {
  id: string;
  type: "receita" | "despesa";
  description: string;
  amount: number | string;
  category: string | null;
  service_order_id: string | null;
  supplier_id: string | null;
  transaction_date: string;
  sequential_number: number | null;
}

interface RawServiceRelation {
  name: string;
}

async function loadWorkshop(supabase: Supabase, workshopId: string) {
  const withTimezone = await supabase
    .from("workshops")
    .select("name, document, phone, address, logo_url, timezone")
    .eq("id", workshopId)
    .maybeSingle();

  if (!withTimezone.error) return withTimezone.data;

  if (isMissingTimezoneError(withTimezone.error)) {
    const { data } = await supabase
      .from("workshops")
      .select("name, document, phone, address, logo_url")
      .eq("id", workshopId)
      .maybeSingle();
    return data;
  }

  return null;
}

interface RawOrderItem {
  services: RawServiceRelation | RawServiceRelation[] | null;
}

interface RawClientRelation {
  id: string;
  name: string;
}

interface RawOrder {
  id: string;
  clients: RawClientRelation | RawClientRelation[] | null;
  service_order_items: RawOrderItem[] | null;
}

async function loadTransactions(supabase: Supabase, workshopId: string) {
  const attempts = [
    "id, type, description, amount, category, service_order_id, supplier_id, transaction_date, sequential_number",
    "id, type, description, amount, category, service_order_id, supplier_id, transaction_date",
    "id, type, description, amount, category, service_order_id, transaction_date",
  ];

  for (const columns of attempts) {
    const { data, error } = await supabase
      .from("financial_transactions")
      .select(columns)
      .eq("workshop_id", workshopId)
      .order("transaction_date", { ascending: false });

    if (!error) {
      return ((data ?? []) as unknown as RawTransaction[]).map((row) => ({
        ...row,
        supplier_id: "supplier_id" in row ? row.supplier_id : null,
        sequential_number: toSequentialNumber(
          "sequential_number" in row ? row.sequential_number : null
        ),
      }));
    }
  }

  return [] as RawTransaction[];
}

export async function fetchReportsSourceData(
  workshopId: string
): Promise<ReportsSourceData> {
  const supabase = createClient();

  const [
    workshopData,
    { data: clientsData },
    { data: suppliersData },
    { data: ordersData },
    transactions,
  ] = await Promise.all([
    loadWorkshop(supabase, workshopId),
    supabase
      .from("clients")
      .select("id, name, phone, document, address")
      .eq("workshop_id", workshopId)
      .order("name", { ascending: true }),
    supabase
      .from("suppliers")
      .select("id, name, trade_name")
      .eq("workshop_id", workshopId),
    supabase
      .from("service_orders")
      .select(
        `
        id,
        clients(id, name),
        service_order_items(
          services(name)
        )
      `
      )
      .eq("workshop_id", workshopId)
      .eq("status", "finalizada")
      .order("completed_at", { ascending: false }),
    loadTransactions(supabase, workshopId),
  ]);

  const clients: ReportClient[] = (
    (clientsData as
      | {
          id: string;
          name: string;
          phone: string | null;
          document: string | null;
          address: string | null;
        }[]
      | null) ?? []
  ).map((client) => ({
    id: client.id,
    name: client.name,
    phone: client.phone ?? null,
    document: client.document ?? null,
    address: client.address ?? null,
  }));

  // Fachada quando existe; a razão social é o que fica guardado em `name`.
  const suppliersById = new Map(
    (
      (suppliersData as
        | { id: string; name: string; trade_name?: string | null }[]
        | null) ?? []
    ).map((s) => [s.id, s.trade_name?.trim() || s.name])
  );

  const orders = ((ordersData as unknown as RawOrder[] | null) ?? []);
  const ordersById = new Map(orders.map((order) => [order.id, order]));

  const revenueEntries: ReportRevenueEntry[] = [];
  const expenseEntries: ReportExpenseEntry[] = [];

  for (const transaction of transactions) {
    const amount = toCurrencyNumber(transaction.amount);
    const date = transaction.transaction_date;

    if (transaction.type === "receita") {
      const order = transaction.service_order_id
        ? ordersById.get(transaction.service_order_id)
        : undefined;
      const client = order ? firstRelation(order.clients) : null;
      const serviceName =
        order?.service_order_items
          ?.map((item) => firstRelation(item.services)?.name)
          .filter(Boolean)
          .join(", ") || transaction.category || "Receita manual";

      revenueEntries.push({
        id: transaction.id,
        date,
        clientId: client?.id ?? null,
        clientName: client?.name ?? "Avulso",
        serviceName,
        category: transaction.category ?? "Outros",
        kind: transaction.service_order_id ? "automatic" : "manual",
        amount,
        sequentialNumber: transaction.sequential_number ?? null,
      });
      continue;
    }

    expenseEntries.push({
      id: transaction.id,
      date,
      description: transaction.description,
      supplierName: transaction.supplier_id
        ? suppliersById.get(transaction.supplier_id) ?? "Fornecedor removido"
        : "—",
      category: transaction.category ?? "Outros",
      amount,
      sequentialNumber: transaction.sequential_number ?? null,
    });
  }

  const workshop = workshopData as {
    name?: string;
    document?: string | null;
    phone?: string | null;
    address?: string | null;
    logo_url?: string | null;
    timezone?: string | null;
  } | null;

  return {
    workshop: {
      name: workshop?.name ?? "Jozep's Garage",
      document: workshop?.document ?? null,
      phone: workshop?.phone ?? null,
      address: workshop?.address ?? null,
      logoUrl: workshop?.logo_url ?? null,
      timezone: resolveTimeZone(workshop?.timezone) || DEFAULT_TIME_ZONE,
    },
    clients,
    revenueEntries,
    expenseEntries,
  };
}

/**
 * Flattens revenue and expense entries into a single row shape so the
 * reports table can filter/sort/select across both of them uniformly.
 */
export function buildTransactionRows(
  source: Pick<ReportsSourceData, "revenueEntries" | "expenseEntries">
): ReportTransactionRow[] {
  const revenueRows: ReportTransactionRow[] = source.revenueEntries.map((entry) => ({
    id: `receita-${entry.id}`,
    type: "receita",
    date: entry.date,
    clientId: entry.clientId,
    clientName: entry.clientName,
    description: entry.serviceName,
    category: entry.category,
    amount: entry.amount,
    sequentialNumber: entry.sequentialNumber,
  }));

  const expenseRows: ReportTransactionRow[] = source.expenseEntries.map((entry) => ({
    id: `despesa-${entry.id}`,
    type: "despesa",
    date: entry.date,
    clientId: null,
    clientName: entry.supplierName,
    description: entry.description,
    category: entry.category,
    amount: entry.amount,
    sequentialNumber: entry.sequentialNumber,
  }));

  return [...revenueRows, ...expenseRows];
}

/**
 * Sums report rows. When the set includes both receitas and despesas,
 * despesas are subtracted (resultado líquido). A single-type set still
 * sums in the original direction (positive total).
 */
export function sumReportAmount(
  rows: Pick<ReportTransactionRow, "type" | "amount">[]
) {
  const hasRevenue = rows.some((row) => row.type === "receita");
  const hasExpense = rows.some((row) => row.type === "despesa");
  const netExpenses = hasRevenue && hasExpense;

  return rows.reduce((sum, row) => {
    if (netExpenses && row.type === "despesa") return sum - row.amount;
    return sum + row.amount;
  }, 0);
}
