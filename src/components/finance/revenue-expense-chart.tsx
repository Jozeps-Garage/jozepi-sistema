"use client";

import { useEffect, useState } from "react";

export type MonthChartData = { label: string; revenue: number; expense: number };

const REVENUE_COLOR = "#1a2744";
const EXPENSE_COLOR = "#e05555";
const PROFIT_COLOR = "#c9a84c";

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface RevenueExpenseChartProps {
  data: MonthChartData[];
  maxValue: number;
  /** Compact mode: no profit line, shorter height — used on dashboard */
  compact?: boolean;
}

export function RevenueExpenseChart({
  data,
  maxValue,
  compact = false,
}: RevenueExpenseChartProps) {
  const [mounted, setMounted] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(id);
  }, []);

  const N = data.length;
  const selectedItem = selectedIndex !== null ? data[selectedIndex] : null;

  // SVG profit line: viewBox 0 0 100 100, maps to the bar area
  const profitPoints = data.map((item, i) => {
    const profit = item.revenue - item.expense;
    const x = ((i + 0.5) / N) * 100;
    const y = (1 - Math.max(0, Math.min(profit / maxValue, 1))) * 100;
    return { x, y, profit };
  });

  const tooltipIdx = hoveredIndex;

  return (
    <div>
      {/* Chart visual area */}
      <div
        className={`relative flex items-end gap-2 overflow-hidden rounded-lg bg-background px-4 pt-3 ${
          compact ? "h-44 pb-6" : "h-64 pb-8"
        }`}
      >
        {/* Floating tooltip */}
        {tooltipIdx !== null && (
          <div
            className="pointer-events-none absolute z-20 min-w-[150px] rounded-xl border border-border bg-card px-3 py-2.5 shadow-xl text-xs"
            style={{
              left: `calc(${((tooltipIdx + 0.5) / N) * 100}% - 75px)`,
              top: "8px",
            }}
          >
            <p className="mb-1.5 font-bold capitalize text-foreground">
              {data[tooltipIdx].label}
            </p>
            <p className="text-muted">
              Receita:{" "}
              <span className="font-semibold text-foreground">
                {fmt(data[tooltipIdx].revenue)}
              </span>
            </p>
            <p className="text-muted">
              Despesa:{" "}
              <span className="font-semibold text-foreground">
                {fmt(data[tooltipIdx].expense)}
              </span>
            </p>
            {!compact && (() => {
              const profit =
                data[tooltipIdx].revenue - data[tooltipIdx].expense;
              return (
                <p className="mt-0.5 text-muted">
                  Lucro:{" "}
                  <span
                    className={`font-semibold ${
                      profit >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {fmt(profit)}
                  </span>
                </p>
              );
            })()}
          </div>
        )}

        {/* Bars */}
        {data.map((item, i) => {
          const revH = mounted
            ? Math.max(3, (item.revenue / maxValue) * 100)
            : 2;
          const expH = mounted
            ? Math.max(3, (item.expense / maxValue) * 100)
            : 2;
          const isSelected = selectedIndex === i;
          const dimmed = selectedIndex !== null && !isSelected;

          return (
            <div
              key={item.label}
              className="relative flex min-w-0 flex-1 cursor-pointer select-none flex-col items-center gap-2"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() => !compact && setSelectedIndex(isSelected ? null : i)}
            >
              <div
                className={`flex w-full items-end justify-center gap-1 ${
                  compact ? "h-28" : "h-44"
                }`}
              >
                {/* Revenue bar */}
                <div
                  className="w-4 rounded-t-[4px]"
                  style={{
                    height: `${revH}%`,
                    background: REVENUE_COLOR,
                    opacity: dimmed ? 0.25 : 1,
                    transition:
                      "height 0.7s cubic-bezier(0.4,0,0.2,1), opacity 0.2s",
                  }}
                />
                {/* Expense bar */}
                <div
                  className="w-4 rounded-t-[4px]"
                  style={{
                    height: `${expH}%`,
                    background: EXPENSE_COLOR,
                    opacity: dimmed ? 0.25 : 1,
                    transition:
                      "height 0.7s cubic-bezier(0.4,0,0.2,1), opacity 0.2s",
                  }}
                />
              </div>
              <span
                className={`text-[11px] font-semibold capitalize transition-colors ${
                  isSelected ? "text-foreground" : "text-muted"
                }`}
              >
                {item.label}
              </span>
            </div>
          );
        })}

        {/* Profit line SVG overlay (full chart only) */}
        {!compact && mounted && (
          <svg
            aria-hidden
            className="pointer-events-none absolute"
            style={{ left: "16px", right: "16px", top: "16px", bottom: "40px" }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              points={profitPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={PROFIT_COLOR}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {profitPoints.map((p, i) => (
              // Zero-length line with round cap = circular dot that stays round despite SVG stretch
              <line
                key={i}
                x1={p.x}
                y1={p.y}
                x2={p.x}
                y2={p.y}
                stroke={PROFIT_COLOR}
                strokeWidth="6"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
      </div>

      {/* Legend */}
      <div className={`flex flex-wrap gap-4 text-xs font-semibold text-muted ${compact ? "mt-1.5" : "mt-3"}`}>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: REVENUE_COLOR }}
          />
          Receita
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: EXPENSE_COLOR }}
          />
          Despesa
        </span>
      </div>

      {/* Selected month summary (full chart only) */}
      {!compact && selectedItem && (
        <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">
            {selectedItem.label}
          </p>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted">
                Receita
              </p>
              <p className="text-sm font-bold text-foreground">
                {fmt(selectedItem.revenue)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted">
                Despesa
              </p>
              <p className="text-sm font-bold text-foreground">
                {fmt(selectedItem.expense)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted">
                Lucro líquido
              </p>
              <p
                className={`text-sm font-bold ${
                  selectedItem.revenue - selectedItem.expense >= 0
                    ? "text-success"
                    : "text-danger"
                }`}
              >
                {fmt(selectedItem.revenue - selectedItem.expense)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
