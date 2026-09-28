import Link from "next/link";
import { CheckCircle, Receipt, UserPlus, Wallet } from "@phosphor-icons/react/dist/ssr";
import type { DashboardData } from "@/lib/dashboard/types";

type TodoCard = {
  key: string;
  count: number;
  title: string;
  hint: string;
  href: string;
  icon: React.ComponentType<{ size?: number; weight?: "light"; "aria-hidden"?: boolean }>;
  chip: string;
};

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export function TodoCards({ data }: { data: DashboardData }) {
  const { unassignedTransactions, pendingQuotes, preRegisteredClients } = data.todos;

  const cards: TodoCard[] = [
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
  ].filter((card) => card.count > 0);

  if (cards.length === 0) {
    return (
      <div className="card-surface flex items-center gap-2.5">
        <span className="icon-chip bg-success/10 text-success">
          <CheckCircle size={18} weight="light" aria-hidden />
        </span>
        <p className="text-sm font-medium text-foreground">
          Nada pendente por aqui. Tudo em dia.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const CardIcon = card.icon;
        return (
          <Link
            key={card.key}
            href={card.href}
            className="card-surface group flex items-start gap-3 transition-transform hover:-translate-y-0.5"
          >
            <span className={`icon-chip ${card.chip}`}>
              <CardIcon size={18} weight="light" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-foreground">
                {card.title}
              </p>
              <p className="mt-1 text-xs text-muted">{card.hint}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
