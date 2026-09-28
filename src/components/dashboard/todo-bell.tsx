"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle, Receipt, UserPlus, Wallet } from "@phosphor-icons/react";
import type { DashboardData } from "@/lib/dashboard/types";

type TodoItem = {
  key: string;
  count: number;
  title: string;
  hint: string;
  href: string;
  icon: React.ComponentType<{
    size?: number;
    weight?: "light";
    "aria-hidden"?: boolean;
  }>;
  chip: string;
};

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export function TodoBell({ data }: { data: DashboardData }) {
  const { unassignedTransactions, pendingQuotes, preRegisteredClients } = data.todos;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const items: TodoItem[] = [
    {
      key: "unassigned",
      count: unassignedTransactions,
      title: `${unassignedTransactions} ${plural(unassignedTransactions, "lançamento sem conta certa", "lançamentos sem conta certa")}`,
      hint: "Parados em Não classificado",
      href: "/financeiro",
      icon: Wallet,
      chip: "bg-premium/15 text-premium",
    },
    {
      key: "quotes",
      count: pendingQuotes,
      title: `${pendingQuotes} ${plural(pendingQuotes, "orçamento aguardando", "orçamentos aguardando")}`,
      hint: "Cliente ainda não respondeu",
      href: "/orcamentos",
      icon: Receipt,
      chip: "bg-primary/8 text-primary",
    },
    {
      key: "preRegistered",
      count: preRegisteredClients,
      title: `${preRegisteredClients} ${plural(preRegisteredClients, "cadastro incompleto", "cadastros incompletos")}`,
      hint: "Agendou sem ficha completa",
      href: "/clientes",
      icon: UserPlus,
      chip: "bg-warning/12 text-warning",
    },
  ].filter((item) => item.count > 0);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={
          items.length > 0
            ? `${items.length} ${plural(items.length, "pendência", "pendências")}`
            : "Sem pendências"
        }
        className="icon-chip relative h-10 w-10 transition-colors hover:bg-primary/15"
      >
        <Bell size={18} weight="light" aria-hidden />
        {items.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-premium px-1 text-[9px] font-bold leading-none text-white ring-2 ring-background">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-card-hover">
          <p className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Pendências
          </p>
          {items.length === 0 ? (
            <div className="flex items-center gap-2.5 px-4 py-4">
              <span className="icon-chip bg-success/10 text-success">
                <CheckCircle size={18} weight="light" aria-hidden />
              </span>
              <p className="text-sm font-medium text-foreground">Tudo em dia.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-background"
                    >
                      <span className={`icon-chip ${item.chip}`}>
                        <ItemIcon size={18} weight="light" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold leading-tight text-foreground">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">{item.hint}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
