import { addDaysToDateKey } from "@/lib/finance/due";
import { cashDate, isPaidCashStatus } from "@/lib/finance/cash";
import {
  toMoneyNumber,
  type FinancialAccount,
  type FinancialTransfer,
  type PaymentStatus,
  type TransactionType,
} from "@/lib/finance/types";

export type ProjectionHorizon = 7 | 30 | 90;

export type ProjectionOpenItem = {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  dueDate: string;
  accountName?: string;
  paymentStatus?: PaymentStatus | null;
};

export type BalancePoint = {
  date: string;
  balance: number;
  kind: "realized" | "projected";
};

export type CashMovement = {
  date: string;
  delta: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function signedCashAmount(type: TransactionType | string, amount: number) {
  if (type === "receita") return amount;
  if (type === "despesa") return -amount;
  return 0;
}

export function openItemDueDate(item: {
  due_date?: string | null;
  dueDate?: string | null;
  transaction_date?: string;
  date?: string;
}) {
  return item.due_date || item.dueDate || item.transaction_date || item.date || "";
}

export function netOpenByHorizon(
  items: ProjectionOpenItem[],
  today: string,
  horizonDays: number
) {
  const end = addDaysToDateKey(today, horizonDays);
  return roundMoney(
    items.reduce((sum, item) => {
      if (!item.dueDate || item.dueDate > end) return sum;
      return sum + signedCashAmount(item.type, item.amount);
    }, 0)
  );
}

export function projectedBalance(
  currentBalance: number,
  items: ProjectionOpenItem[],
  today: string,
  horizonDays: number
) {
  return roundMoney(currentBalance + netOpenByHorizon(items, today, horizonDays));
}

export function futureOpenItems(items: ProjectionOpenItem[], today: string) {
  return items
    .filter((item) => item.dueDate >= today)
    .sort((a, b) => {
      const byDue = a.dueDate.localeCompare(b.dueDate);
      if (byDue !== 0) return byDue;
      return a.description.localeCompare(b.description, "pt-BR");
    });
}

export function paidMovementsFromLedger(input: {
  transactions: Array<{
    type: TransactionType | string;
    amount: number | string;
    payment_status?: PaymentStatus | string | null;
    effective_date?: string | null;
    transaction_date: string;
    account_id?: string | null;
  }>;
  transfers: FinancialTransfer[];
  accounts: FinancialAccount[];
}): CashMovement[] {
  const activeIds = new Set(
    input.accounts.filter((account) => account.active).map((account) => account.id)
  );
  const movements: CashMovement[] = [];

  for (const row of input.transactions) {
    if (!row.account_id || !activeIds.has(row.account_id)) continue;
    if (!isPaidCashStatus(row.payment_status)) continue;
    const delta = signedCashAmount(row.type, toMoneyNumber(row.amount));
    if (!delta) continue;
    movements.push({ date: cashDate(row), delta });
  }

  for (const transfer of input.transfers) {
    const fromActive = activeIds.has(transfer.from_account_id);
    const toActive = activeIds.has(transfer.to_account_id);
    if (fromActive === toActive) continue;
    movements.push({
      date: transfer.transfer_date,
      delta: toActive ? transfer.amount : -transfer.amount,
    });
  }

  return movements;
}

function balanceAtDate(
  currentBalance: number,
  movements: CashMovement[],
  today: string,
  date: string
) {
  const subtracted = movements.reduce((sum, movement) => {
    if (movement.date > date && movement.date <= today) return sum + movement.delta;
    return sum;
  }, 0);
  return roundMoney(currentBalance - subtracted);
}

export function balanceSeries(input: {
  currentBalance: number;
  movements: CashMovement[];
  openItems: ProjectionOpenItem[];
  today: string;
  horizonDays: number;
}): BalancePoint[] {
  const { currentBalance, movements, openItems, today, horizonDays } = input;
  const points: BalancePoint[] = [];

  for (let offset = -horizonDays; offset <= 0; offset += 1) {
    const date = addDaysToDateKey(today, offset);
    points.push({
      date,
      balance: balanceAtDate(currentBalance, movements, today, date),
      kind: "realized",
    });
  }

  let running = currentBalance;
  points.push({ date: today, balance: running, kind: "projected" });

  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const date = addDaysToDateKey(today, offset);
    const dayNet = openItems.reduce((sum, item) => {
      if (item.dueDate !== date) return sum;
      return sum + signedCashAmount(item.type, item.amount);
    }, 0);
    running = roundMoney(running + dayNet);
    points.push({ date, balance: running, kind: "projected" });
  }

  const overdueAndTodayNet = openItems.reduce((sum, item) => {
    if (!item.dueDate || item.dueDate > today) return sum;
    return sum + signedCashAmount(item.type, item.amount);
  }, 0);
  if (overdueAndTodayNet !== 0) {
    const todayProjected = points.find(
      (point) => point.kind === "projected" && point.date === today
    );
    if (todayProjected) {
      todayProjected.balance = roundMoney(currentBalance + overdueAndTodayNet);
    }
    for (const point of points) {
      if (point.kind === "projected" && point.date > today) {
        point.balance = roundMoney(point.balance + overdueAndTodayNet);
      }
    }
  }

  return points;
}
