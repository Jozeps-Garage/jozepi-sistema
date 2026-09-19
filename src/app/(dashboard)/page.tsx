import { DashboardBoard } from "@/components/dashboard/dashboard-board";
import type { MonthChartData } from "@/components/finance/revenue-expense-chart";
import type {
  AppointmentRow,
  DashboardData,
  NextAppointment,
  PendingExpenseRow,
  ProductRow,
  UnpaidOrderRow,
} from "@/lib/dashboard/types";
import { getProductStockPercent } from "@/lib/dashboard/types";
import { createClient } from "@/lib/supabase/server";
import { cashDate, getMonthlyRevenue, isPaidCashStatus } from "@/lib/finance/cash";
import { toMoneyNumber } from "@/lib/finance/types";
import {
  DEFAULT_TIME_ZONE,
  addDaysToDateKey,
  addMonthsToYearMonth,
  dateKeyInTimeZone,
  formatZonedDate,
  getZonedDateTime,
  getZonedHour,
  isMissingTimezoneError,
  monthRangeKeys,
  resolveTimeZone,
} from "@/lib/timezone";

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

function getGreeting(date: Date, timeZone: string) {
  const hour = getZonedHour(date, timeZone);
  if (hour >= 4 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function getDisplayName(fullName?: string | null, email?: string | null) {
  const name = fullName?.trim() || email?.split("@")[0]?.trim();
  const firstName = name?.split(/\s+/)[0];
  return firstName ? capitalize(firstName) : "usuário";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const now = new Date();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { workshop_id: string | null; full_name: string | null } | null =
    null;

  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("workshop_id, full_name")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  let stats = {
    monthly_revenue: 0,
    open_orders: 0,
    completed_orders_month: 0,
    total_clients: 0,
  };

  let weekAppointments: AppointmentRow[] = [];
  let nextTodayAppointment: NextAppointment | null = null;
  let lowStockProducts: ProductRow[] = [];
  let unpaidOrders: UnpaidOrderRow[] = [];
  let pendingExpenses: PendingExpenseRow[] = [];
  let monthlyChartData: MonthChartData[] = [];
  let maxChartValue = 1;

  let timeZone = DEFAULT_TIME_ZONE;
  let todayDateKey = dateKeyInTimeZone(now, timeZone);

  if (profile?.workshop_id) {
    const workshopId = profile.workshop_id;

    const { data: workshop, error: timezoneError } = await supabase
      .from("workshops")
      .select("timezone")
      .eq("id", workshopId)
      .maybeSingle();

    if (!timezoneError) {
      timeZone = resolveTimeZone(workshop?.timezone);
    } else if (!isMissingTimezoneError(timezoneError)) {
      timeZone = DEFAULT_TIME_ZONE;
    }

    const todayStr = dateKeyInTimeZone(now, timeZone);
    todayDateKey = todayStr;
    const weekEndStr = addDaysToDateKey(todayStr, 6);
    const { start: monthStart, end: monthEnd } = monthRangeKeys(now, timeZone);
    const zonedNow = getZonedDateTime(now, timeZone);

    const { data: statsData } = await supabase
      .from("dashboard_stats")
      .select("*")
      .eq("workshop_id", workshopId)
      .single();

    const { count: openCount } = await supabase
      .from("service_orders")
      .select("id", { count: "exact", head: true })
      .eq("workshop_id", workshopId)
      .in("status", ["aberta", "em_andamento"]);

    const { count: completedCount } = await supabase
      .from("service_orders")
      .select("id", { count: "exact", head: true })
      .eq("workshop_id", workshopId)
      .eq("status", "finalizada")
      .gte("scheduled_date", monthStart)
      .lte("scheduled_date", monthEnd);

    const monthlyRevenue = await getMonthlyRevenue(
      supabase,
      workshopId,
      monthStart,
      monthEnd
    );

    if (statsData) {
      stats = {
        monthly_revenue: monthlyRevenue,
        open_orders: openCount ?? 0,
        completed_orders_month: completedCount ?? 0,
        total_clients: Number(statsData.total_clients),
      };
    } else {
      stats = {
        ...stats,
        monthly_revenue: monthlyRevenue,
        open_orders: openCount ?? 0,
        completed_orders_month: completedCount ?? 0,
      };
    }

    const { data: weekData } = await supabase
      .from("service_orders")
      .select(
        "id, scheduled_date, scheduled_start, status, clients(name, phone), service_order_items(services(name))"
      )
      .eq("workshop_id", workshopId)
      .not("scheduled_date", "is", null)
      .gte("scheduled_date", todayStr)
      .lte("scheduled_date", weekEndStr)
      .in("status", ["aberta", "em_andamento"])
      .order("scheduled_date")
      .order("scheduled_start")
      .limit(10);

    weekAppointments = (weekData as AppointmentRow[] | null) ?? [];

    const { data: nextData } = await supabase
      .from("service_orders")
      .select("scheduled_start, clients(name)")
      .eq("workshop_id", workshopId)
      .eq("scheduled_date", todayStr)
      .in("status", ["aberta", "em_andamento"])
      .order("scheduled_start")
      .limit(1)
      .maybeSingle();

    nextTodayAppointment = (nextData ?? null) as NextAppointment | null;

    const { data: productsData } = await supabase
      .from("products")
      .select("name, type, stock_remaining, volume_ml, quantity")
      .eq("workshop_id", workshopId)
      .not("stock_remaining", "is", null);

    const allProducts = (productsData as ProductRow[] | null) ?? [];
    lowStockProducts = allProducts.filter((p) => getProductStockPercent(p) < 20);

    const { data: unpaidData } = await supabase
      .from("service_orders")
      .select(
        "id, total_amount, completed_at, opened_at, payment_status, clients(name, phone), service_order_items(services(name))"
      )
      .eq("workshop_id", workshopId)
      .eq("status", "finalizada")
      .in("payment_status", ["pendente", "parcial"])
      .order("completed_at", { ascending: false })
      .limit(20);

    unpaidOrders = (unpaidData as UnpaidOrderRow[] | null) ?? [];

    if (unpaidOrders.length > 0) {
      const { data: dueRows } = await supabase
        .from("financial_transactions")
        .select("service_order_id, due_date")
        .eq("workshop_id", workshopId)
        .eq("type", "receita")
        .in(
          "service_order_id",
          unpaidOrders.map((order) => order.id)
        );
      const dueByOrder = new Map(
        ((dueRows ?? []) as { service_order_id: string | null; due_date: string | null }[])
          .filter((row) => row.service_order_id)
          .map((row) => [row.service_order_id as string, row.due_date])
      );
      unpaidOrders = unpaidOrders.map((order) => ({
        ...order,
        due_date: dueByOrder.get(order.id) ?? (order.completed_at ?? order.opened_at)?.slice(0, 10) ?? null,
      }));
    }

    const pendingWithDue = await supabase
      .from("financial_transactions")
      .select(
        "id, description, amount, transaction_date, due_date, category, payment_status"
      )
      .eq("workshop_id", workshopId)
      .eq("type", "despesa")
      .in("payment_status", ["pendente", "parcial"])
      .order("due_date", { ascending: true })
      .limit(20);

    if (!pendingWithDue.error) {
      pendingExpenses = (pendingWithDue.data as PendingExpenseRow[] | null) ?? [];
    } else {
      const { data: pendingExpenseData, error: pendingExpenseError } =
        await supabase
          .from("financial_transactions")
          .select(
            "id, description, amount, transaction_date, category, payment_status"
          )
          .eq("workshop_id", workshopId)
          .eq("type", "despesa")
          .in("payment_status", ["pendente", "parcial"])
          .order("transaction_date", { ascending: false })
          .limit(20);

      if (!pendingExpenseError) {
        pendingExpenses = (pendingExpenseData as PendingExpenseRow[] | null) ?? [];
      }
    }

    const sixMonthsAgo = addMonthsToYearMonth(zonedNow.year, zonedNow.month, -5);
    const sixMonthsAgoStr = `${sixMonthsAgo.year}-${String(sixMonthsAgo.month).padStart(2, "0")}-01`;
    type ChartTxRow = {
      type: string;
      amount: string | number;
      transaction_date: string;
      payment_status?: string | null;
      effective_date?: string | null;
    };

    const cashChart = await supabase
      .from("financial_transactions")
      .select("type, amount, transaction_date, payment_status, effective_date")
      .eq("workshop_id", workshopId);

    let txRows: ChartTxRow[] = [];
    if (!cashChart.error) {
      txRows = (cashChart.data ?? []) as ChartTxRow[];
    } else {
      const legacyChart = await supabase
        .from("financial_transactions")
        .select("type, amount, transaction_date")
        .eq("workshop_id", workshopId)
        .gte("transaction_date", sixMonthsAgoStr);
      txRows = (legacyChart.data ?? []) as ChartTxRow[];
    }

    monthlyChartData = Array.from({ length: 6 }, (_, idx) => {
      const monthParts = addMonthsToYearMonth(zonedNow.year, zonedNow.month, -5 + idx);
      const date = new Date(monthParts.year, monthParts.month - 1, 1);
      const monthPrefix = `${monthParts.year}-${String(monthParts.month).padStart(2, "0")}`;
      const monthStartKey = `${monthPrefix}-01`;
      const monthEndKey = `${monthPrefix}-${String(new Date(monthParts.year, monthParts.month, 0).getDate()).padStart(2, "0")}`;
      const label = date
        .toLocaleDateString("pt-BR", { month: "short" })
        .replace(".", "");
      const monthTx = txRows.filter((tx) => {
        if (!isPaidCashStatus(tx.payment_status)) return false;
        const dateValue = cashDate({
          effective_date: tx.effective_date,
          transaction_date: tx.transaction_date,
        });
        return dateValue >= monthStartKey && dateValue <= monthEndKey;
      });
      const revenue = monthTx
        .filter((tx) => tx.type === "receita")
        .reduce((sum, tx) => sum + toMoneyNumber(tx.amount), 0);
      const expense = monthTx
        .filter((tx) => tx.type === "despesa")
        .reduce((sum, tx) => sum + toMoneyNumber(tx.amount), 0);
      return { label, revenue, expense };
    });

    maxChartValue = Math.max(
      1,
      ...monthlyChartData.flatMap((m) => [m.revenue, m.expense])
    );
  }

  const data: DashboardData = {
    greeting: getGreeting(now, timeZone),
    greetingName: getDisplayName(profile?.full_name, user?.email),
    dateLabel: formatZonedDate(now, timeZone),
    stats,
    weekAppointments,
    todayDateKey,
    nextTodayAppointment,
    lowStockProducts,
    unpaidOrders,
    pendingExpenses,
    monthlyChartData,
    maxChartValue,
  };

  return <DashboardBoard data={data} />;
}
