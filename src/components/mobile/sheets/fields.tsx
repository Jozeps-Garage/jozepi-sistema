"use client";

import { cn } from "@/lib/utils/cn";
import { maskCurrencyInput } from "@/lib/utils/money";

/** Campo de moeda em BRL com máscara ao digitar. */
export function MoneyField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="label-caps">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted sm:text-sm">
          R$
        </span>
        <input
          value={value}
          onChange={(event) => onChange(maskCurrencyInput(event.target.value))}
          inputMode="decimal"
          placeholder="0,00"
          className="min-h-11 w-full rounded-md border border-border bg-input py-3 pl-11 pr-4 text-base font-semibold text-foreground transition-colors duration-300 placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:min-h-0 sm:py-2.5 sm:text-sm"
        />
      </div>
    </div>
  );
}
