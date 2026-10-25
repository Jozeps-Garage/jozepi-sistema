"use client";

import { Broom, Drop, Toolbox } from "@phosphor-icons/react";
import { STOCK_KIND_LABEL, type StockKind } from "@/lib/products/stock";

/** Um ícone por categoria: a lista separa os três de relance. */
const STOCK_KIND_ICON: Record<StockKind, typeof Drop> = {
  liquido: Drop,
  utensilio: Broom,
  patrimonio: Toolbox,
};

const STOCK_KIND_TONE: Record<StockKind, string> = {
  liquido: "bg-primary/10 text-primary",
  utensilio: "bg-success/10 text-success",
  patrimonio: "bg-premium/10 text-premium",
};

export function StockKindIcon({ kind, size }: { kind: StockKind; size: number }) {
  const Icon = STOCK_KIND_ICON[kind];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg ${STOCK_KIND_TONE[kind]}`}
      style={{ width: size, height: size }}
      title={STOCK_KIND_LABEL[kind]}
    >
      <Icon size={Math.round(size * 0.5)} weight="light" aria-hidden />
    </span>
  );
}
