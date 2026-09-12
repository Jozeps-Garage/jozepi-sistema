import type { MonthChartData } from "@/components/finance/revenue-expense-chart";

export type AppointmentClient = { name: string; phone: string | null };

export type AppointmentRow = {
  id: string;
  scheduled_date: string;
  scheduled_start: string | null;
  status: string;
  clients: AppointmentClient | AppointmentClient[] | null;
  service_order_items: {
    services: { name: string } | { name: string }[] | null;
  }[];
};

export type ProductRow = {
  name: string;
  type: string;
  stock_remaining: string | null;
  volume_ml: string | null;
  quantity: string | null;
};

export type UnpaidOrderRow = {
  id: string;
  total_amount: number | string;
  completed_at: string | null;
  opened_at: string | null;
  payment_status: "pendente" | "parcial";
  clients: AppointmentClient | AppointmentClient[] | null;
  service_order_items: {
    services: { name: string } | { name: string }[] | null;
  }[];
};

export type PendingExpenseRow = {
  id: string;
  description: string;
  amount: number | string;
  transaction_date: string;
  category: string | null;
  payment_status: "pendente" | "parcial" | "pago" | "cancelado" | null;
};

export type NextAppointment = {
  scheduled_start: string | null;
  clients: AppointmentRow["clients"];
};

export type DashboardStats = {
  monthly_revenue: number;
  open_orders: number;
  completed_orders_month: number;
  total_clients: number;
};

export type DashboardData = {
  greetingName: string;
  greeting: string;
  dateLabel: string;
  stats: DashboardStats;
  weekAppointments: AppointmentRow[];
  todayDateKey: string;
  nextTodayAppointment: NextAppointment | null;
  lowStockProducts: ProductRow[];
  unpaidOrders: UnpaidOrderRow[];
  pendingExpenses: PendingExpenseRow[];
  monthlyChartData: MonthChartData[];
  maxChartValue: number;
};

export function getClientName(
  clients: AppointmentRow["clients"]
): string {
  if (!clients) return "Cliente";
  if (Array.isArray(clients)) return clients[0]?.name ?? "Cliente";
  return clients.name;
}

export function getClientPhone(
  clients: AppointmentRow["clients"]
): string | null {
  if (!clients) return null;
  if (Array.isArray(clients)) return clients[0]?.phone ?? null;
  return clients.phone;
}

export function getServiceNames(
  items: AppointmentRow["service_order_items"]
): string {
  const names = items
    .map((item) => {
      if (!item.services) return null;
      if (Array.isArray(item.services)) return item.services[0]?.name ?? null;
      return item.services.name;
    })
    .filter(Boolean) as string[];
  return names.length > 0 ? names.join(", ") : "Serviço";
}

export function getStatusLabel(status: string) {
  if (status === "em_andamento") return "Confirmado";
  if (status === "aberta") return "Pendente";
  return "Pendente";
}

export function getStatusClasses(status: string) {
  if (status === "em_andamento") return "bg-premium/10 text-premium";
  return "bg-warning/10 text-warning";
}

export function getProductStockPercent(product: ProductRow): number {
  const remaining = parseFloat(product.stock_remaining ?? "0");
  const initial =
    parseFloat(
      product.type === "liquid"
        ? (product.volume_ml ?? "1")
        : (product.quantity ?? "1")
    ) || 1;
  return (remaining / initial) * 100;
}

export function formatTime(timeStr: string | null) {
  if (!timeStr) return "";
  return timeStr.slice(0, 5);
}

export function formatShortDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
  return formatted.charAt(0).toLocaleUpperCase("pt-BR") + formatted.slice(1);
}

export function buildWhatsAppUrl(
  phone: string | null,
  clientName: string,
  service: string,
  date: string,
  time: string | null
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const phoneWithCode = digits.startsWith("55") ? digits : `55${digits}`;
  const [year, month, day] = date.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  const dateFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
  }).format(dateObj);
  const timePart = time ? ` às ${time.slice(0, 5)}` : "";
  const msg = `Olá ${clientName}! Confirmando seu agendamento de ${service} para ${dateFmt}${timePart}. Qualquer dúvida estou à disposição! 🚗`;
  return `https://wa.me/${phoneWithCode}?text=${encodeURIComponent(msg)}`;
}
