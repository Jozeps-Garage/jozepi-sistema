"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  CalendarBlank,
  CaretLeft,
  ChartBar,
  ClipboardText,
  CurrencyDollar,
  Package,
  SquaresFour,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";

const NAV_ICON_SIZE = 22;
const NAV_ICON_WEIGHT = "light" as const;

/** Mesma curva e duração do recolher da sidebar, para tudo andar junto. */
export const SIDEBAR_REVEAL =
  "transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

/** Texto que só existe com a sidebar aberta. */
export function sidebarLabelClass(expanded: boolean) {
  return `${SIDEBAR_REVEAL} ${
    expanded ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0"
  }`;
}

function SidebarNavIcon({
  icon: IconComponent,
  isActive,
}: {
  icon: Icon;
  isActive: boolean;
}) {
  return (
    <IconComponent
      size={NAV_ICON_SIZE}
      weight={NAV_ICON_WEIGHT}
      className={isActive ? "text-white" : "text-white opacity-60"}
      aria-hidden
    />
  );
}

const navigation: {
  name: string;
  href: string;
  icon: Icon;
}[] = [
  { name: "Dashboard", href: "/", icon: SquaresFour },
  { name: "Agenda", href: "/agenda", icon: CalendarBlank },
  { name: "Orçamentos", href: "/orcamentos", icon: ClipboardText },
  { name: "Clientes", href: "/clientes", icon: UsersThree },
  { name: "Serviços", href: "/servicos", icon: Wrench },
  { name: "Produtos", href: "/produtos", icon: Package },
  { name: "Financeiro", href: "/financeiro", icon: CurrencyDollar },
  { name: "Relatórios", href: "/relatorios", icon: ChartBar },
];

interface SidebarProps {
  expanded: boolean;
  onToggle: () => void;
  userEmail: string;
  userName?: string;
  avatarUrl?: string | null;
}

export function Sidebar({
  expanded,
  onToggle,
  userEmail,
  userName,
  avatarUrl,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-50 hidden flex-col overflow-hidden bg-sidebar shadow-card transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:flex ${
          expanded ? "w-64" : "w-20"
        }`}
      >
        <div className="flex h-20 items-center px-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Recolher menu" : "Expandir menu"}
            title={expanded ? "Recolher menu" : "Expandir menu"}
            className="font-brand flex h-14 w-full items-center rounded-lg leading-none text-white transition-colors duration-300 hover:bg-sidebar-hover"
          >
            <span
              className={`flex w-14 shrink-0 flex-col justify-center text-left transition-opacity duration-300 ${
                expanded ? "opacity-0" : "opacity-100"
              }`}
            >
              <span className="text-[8.5px] font-bold uppercase tracking-[0.11em]">
                Jozep&apos;s
              </span>
              <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.09em]">
                Garage
              </span>
            </span>
            <span
              className={`-ml-14 whitespace-nowrap text-left ${SIDEBAR_REVEAL} ${
                expanded
                  ? "ml-0 translate-x-0 opacity-100"
                  : "translate-x-3 opacity-0"
              }`}
            >
              <span className="block text-[1.08rem] font-bold uppercase leading-none tracking-[0.06em] text-white">
                Jozep&apos;s Garage
              </span>
              <span className="mt-1.5 block text-[7px] font-semibold uppercase tracking-[0.34em] text-white/45">
                ESTÉTICA AUTOMOTIVA
              </span>
            </span>
            {expanded && (
              <span className="ml-auto flex w-9 shrink-0 justify-center">
                <CaretLeft
                  size={16}
                  weight={NAV_ICON_WEIGHT}
                  className="text-white opacity-50"
                  aria-hidden
                />
              </span>
            )}
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navigation.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.name}
                href={item.href}
                title={item.name}
                className={`flex h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-300 ${
                  isActive
                    ? "border-l-2 border-premium bg-sidebar-active text-white"
                    : "text-white/70 hover:bg-sidebar-hover hover:text-white"
                }`}
              >
                <span className="flex w-8 shrink-0 justify-center">
                  <SidebarNavIcon icon={item.icon} isActive={isActive} />
                </span>
                <span
                  className={`ml-3 whitespace-nowrap ${sidebarLabelClass(
                    expanded
                  )}`}
                >
                  {item.name}
                </span>
              </Link>
            );
          })}
        </nav>

        <UserMenu
          expanded={expanded}
          email={userEmail}
          fullName={userName}
          avatarUrl={avatarUrl}
        />
      </aside>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-sidebar/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 shadow-card backdrop-blur md:hidden"
        aria-label="Navegação principal"
      >
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navigation.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex min-h-14 min-w-[4.75rem] flex-1 flex-col items-center justify-center rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                  isActive
                    ? "border-t-2 border-premium bg-sidebar-active text-white shadow-card"
                    : "text-white/65 hover:bg-sidebar-hover hover:text-white"
                }`}
              >
                <SidebarNavIcon icon={item.icon} isActive={isActive} />
                <span className="mt-1 max-w-[4.25rem] truncate">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
