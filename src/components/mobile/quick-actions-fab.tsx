"use client";

import {
  CalendarPlus,
  Plus,
  TrendDown,
  TrendUp,
  UserPlus,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchClients, fetchServices } from "@/lib/agenda/queries";
import type { AgendaService } from "@/lib/agenda/types";
import type { Client } from "@/types/client";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { Toast, type ToastState } from "@/components/mobile/toast";
import { ClientSheet } from "@/components/mobile/sheets/client-sheet";
import { AppointmentSheet } from "@/components/mobile/sheets/appointment-sheet";
import { TransactionSheet } from "@/components/mobile/sheets/transaction-sheet";

type SheetKey = "client" | "appointment" | "expense" | "revenue";

interface ActionConfig {
  key: SheetKey;
  label: string;
  hint: string;
  icon: Icon;
  chip: string;
}

const ACTIONS: ActionConfig[] = [
  { key: "client", label: "Cliente", hint: "Novo cadastro", icon: UserPlus, chip: "bg-primary/10 text-primary" },
  { key: "appointment", label: "Agendamento", hint: "Nova OS", icon: CalendarPlus, chip: "bg-premium/15 text-premium" },
  { key: "expense", label: "Despesa", hint: "Lançar gasto", icon: TrendDown, chip: "bg-danger/10 text-danger" },
  { key: "revenue", label: "Receita", hint: "Entrada avulsa", icon: TrendUp, chip: "bg-success/10 text-success" },
];

/**
 * Botão flutuante de ações rápidas — presente em todas as páginas do sistema.
 */
export function QuickActionsFab({ workshopId }: { workshopId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<AgendaService[]>([]);
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fabBurst, setFabBurst] = useState(0);
  const [fabPressing, setFabPressing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const loadLookups = useCallback(async () => {
    const [clientsRes, servicesRes] = await Promise.all([
      fetchClients(supabase, workshopId),
      fetchServices(supabase, workshopId),
    ]);
    if (clientsRes.data) setClients(clientsRes.data as unknown as Client[]);
    if (servicesRes.data) setServices(servicesRes.data as unknown as AgendaService[]);
  }, [supabase, workshopId]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  function notify(tone: "success" | "error", message: string) {
    setToast({ id: Date.now(), tone, message });
  }

  function openAction(key: SheetKey) {
    setMenuOpen(false);
    setOpenSheet(key);
    if (key === "appointment") void loadLookups();
  }

  return (
    <>
      {/* FAB no canto inferior direito, sempre acima da barra de navegação inferior no mobile */}
      <button
        type="button"
        onClick={() => {
          setFabPressing(false);
          setFabBurst((n) => n + 1);
          setMenuOpen((open) => !open);
          requestAnimationFrame(() => setFabPressing(true));
        }}
        aria-label={menuOpen ? "Fechar" : "Adicionar"}
        aria-expanded={menuOpen}
        className={`tap-press fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-5 z-50 flex h-16 w-16 items-center justify-center overflow-visible rounded-full bg-primary text-white shadow-card-hover ring-4 ring-background md:bottom-8 md:right-8 ${
          fabBurst === 0 ? "fab-pop" : fabPressing ? "fab-press" : ""
        }`}
      >
        {fabBurst > 0 ? (
          <span
            key={fabBurst}
            className="pointer-events-none absolute inset-0 rounded-full bg-white/25 fab-ring"
          />
        ) : null}
        <Plus
          size={30}
          weight="bold"
          aria-hidden
          className={`relative transition-transform duration-300 ease-out ${
            menuOpen ? "rotate-45" : "rotate-0"
          }`}
        />
      </button>

      {/* Menu de ações do FAB */}
      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Adicionar"
        description="O que você quer registrar?"
      >
        <div className="grid grid-cols-2 gap-3 pb-2">
          {ACTIONS.map((action, index) => {
            const IconComponent = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => openAction(action.key)}
                style={{ animationDelay: `${index * 40}ms` }}
                className="tap-press rise-in flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.chip}`}
                >
                  <IconComponent size={22} weight="light" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    {action.label}
                  </span>
                  <span className="block text-xs text-muted">{action.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Sheets */}
      <ClientSheet
        open={openSheet === "client"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        onDone={notify}
        onCreated={(client) => setClients((prev) => [client, ...prev])}
      />
      <AppointmentSheet
        open={openSheet === "appointment"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        clients={clients}
        services={services}
        onServiceCreated={(service) => setServices((prev) => [...prev, service])}
        onDone={notify}
      />
      <TransactionSheet
        open={openSheet === "expense"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        type="despesa"
        onDone={notify}
      />
      <TransactionSheet
        open={openSheet === "revenue"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        type="receita"
        onDone={notify}
      />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
