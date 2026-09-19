import type { PaymentStatus } from "@/lib/finance/types";

export function todayDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return todayDateKey(date);
}

export function addMonthsToDateKey(dateKey: string, months: number) {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-").map(Number);
  const year = yearRaw + Math.floor((monthRaw - 1 + months) / 12);
  const monthIndex = ((monthRaw - 1 + months) % 12 + 12) % 12;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(dayRaw, lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isOpenPaymentStatus(status?: string | null): status is PaymentStatus {
  return status === "pendente" || status === "parcial";
}

/**
 * Vencido é estado derivado — não existe no enum payment_status.
 * Pendente/parcial com due_date anterior a hoje.
 */
export function isOverdue(
  transaction: {
    payment_status?: string | null;
    due_date?: string | null;
  },
  today = todayDateKey()
) {
  if (!isOpenPaymentStatus(transaction.payment_status)) return false;
  if (!transaction.due_date) return false;
  return transaction.due_date < today;
}

export function daysUntilDue(dueDate: string, today = todayDateKey()) {
  const due = Date.parse(`${dueDate}T00:00:00`);
  const now = Date.parse(`${today}T00:00:00`);
  return Math.round((due - now) / 86_400_000);
}

export function dueRelativeLabel(dueDate: string, today = todayDateKey()) {
  const days = daysUntilDue(dueDate, today);
  if (days < 0) {
    const overdue = Math.abs(days);
    return overdue === 1 ? "Vencido há 1 dia" : `Vencido há ${overdue} dias`;
  }
  if (days === 0) return "Vence hoje";
  if (days === 1) return "Vence amanhã";
  return `Vence em ${days} dias`;
}

export function inDueAlertWindow(
  transaction: {
    payment_status?: string | null;
    due_date?: string | null;
  },
  today = todayDateKey(),
  horizonDays = 7
) {
  if (!isOpenPaymentStatus(transaction.payment_status) || !transaction.due_date) {
    return false;
  }
  if (transaction.due_date < today) return true;
  return transaction.due_date <= addDaysToDateKey(today, horizonDays);
}

export function splitInstallmentAmounts(total: number, count: number) {
  const safeCount = Math.max(1, Math.round(count));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / safeCount);
  const remainder = cents - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) =>
    (index === safeCount - 1 ? base + remainder : base) / 100
  );
}

export function installmentBaseDescription(description: string) {
  return description.replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, "").trim();
}
