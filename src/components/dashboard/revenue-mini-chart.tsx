"use client";

import Link from "next/link";
import { ChartBar } from "@phosphor-icons/react";
import {
  RevenueExpenseChart,
  type MonthChartData,
} from "@/components/finance/revenue-expense-chart";
import { cn } from "@/lib/utils/cn";

interface RevenueMiniChartProps {
  data: MonthChartData[];
  maxValue: number;
  className?: string;
}

export function RevenueMiniChart({
  data,
  maxValue,
  className,
}: RevenueMiniChartProps) {
  return (
    <div className={cn("card-surface h-full w-full", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ChartBar size={18} weight="light" className="shrink-0 text-muted" />
          <h2 className="truncate text-sm font-semibold text-foreground">
            Últimos 6 meses
          </h2>
        </div>
        <Link
          href="/financeiro"
          className="shrink-0 text-xs font-semibold text-premium transition-opacity hover:opacity-70"
        >
          Ver detalhes →
        </Link>
      </div>
      <RevenueExpenseChart data={data} maxValue={maxValue} compact />
    </div>
  );
}
