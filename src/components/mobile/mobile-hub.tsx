"use client";

import {
  ArrowUpRight,
  CalendarPlus,
  Car,
  MagnifyingGlass,
  Package,
  Plus,
  TrendDown,
  TrendUp,
  UserPlus,
  WhatsappLogo,
  Wrench,
  X,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchClients, fetchServices } from "@/lib/agenda/queries";
import { formatPhone, getWhatsAppUrl } from "@/lib/utils/format";
import type { AgendaService } from "@/lib/agenda/types";
import type { Client } from "@/types/client";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { InstallHint } from "@/components/mobile/install-hint";
import { Toast, type ToastState } from "@/components/mobile/toast";
import { ClientSheet } from "@/components/mobile/sheets/client-sheet";
import { VehicleSheet } from "@/components/mobile/sheets/vehicle-sheet";
import { AppointmentSheet } from "@/components/mobile/sheets/appointment-sheet";
import { TransactionSheet } from "@/components/mobile/sheets/transaction-sheet";
import { ServiceSheet } from "@/components/mobile/sheets/service-sheet";
import { ProductSheet } from "@/components/mobile/sheets/product-sheet";

type SheetKey =
  | "client"
  | "vehicle"
  | "appointment"
  | "expense"
  | "revenue"
  | "service"
  | "product";

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
  { key: "vehicle", label: "Veículo", hint: "A um cliente", icon: Car, chip: "bg-primary/10 text-primary" },
  { key: "service", label: "Serviço", hint: "Catálogo", icon: Wrench, chip: "bg-premium/15 text-premium" },
  { key: "product", label: "Produto", hint: "Estoque", icon: Package, chip: "bg-primary/10 text-primary" },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function todayLabel() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

export function MobileHub({
  userName,
  workshopId,
}: {
  userName: string;
  workshopId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<AgendaService[]>([]);
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [search, setSearch] = useState("");

  const firstName = userName.trim().split(/\s+/)[0] || "Bem-vindo";

  const reloadClients = useMemo(
    () => async () => {
      const { data } = await fetchClients(supabase, workshopId);
      if (data) setClients(data as unknown as Client[]);
    },
    [supabase, workshopId]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const [clientsRes, servicesRes] = await Promise.all([
        fetchClients(supabase, workshopId),
        fetchServices(supabase, workshopId),
      ]);
      if (!active) return;
      if (clientsRes.data) setClients(clientsRes.data as unknown as Client[]);
      if (servicesRes.data) setServices(servicesRes.data as unknown as AgendaService[]);
    })();
    return () => {
      active = false;
    };
  }, [supabase, workshopId]);

  function notify(tone: "success" | "error", message: string) {
    setToast({ id: Date.now(), tone, message });
  }

  function openAction(key: SheetKey) {
    setMenuOpen(false);
    setOpenSheet(key);
  }

  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    const digits = term.replace(/\D/g, "");
    return clients
      .filter(
        (client) =>
          client.name.toLowerCase().includes(term) ||
          (digits && (client.phone ?? "").replace(/\D/g, "").includes(digits))
      )
      .slice(0, 6);
  }, [clients, search]);

  return (
    <div className="min-h-screen pb-28">
      {/* Cabeçalho glass */}
      <header className="glass-header sticky top-0 z-40 border-b border-white/10 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+0.85rem)] text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">
              {greeting()}
            </p>
            <h1 className="font-brand text-xl font-semibold uppercase tracking-wide">
              {firstName}
            </h1>
          </div>
          <Link
            href="/"
            className="tap-press flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white/80"
          >
            Sistema
            <ArrowUpRight size={14} weight="bold" aria-hidden />
          </Link>
        </div>
        <p className="mt-1 text-xs capitalize text-white/50">{todayLabel()}</p>
      </header>

      <main className="space-y-5 px-5 pt-5">
        <InstallHint />

        {/* Busca rápida de cliente */}
        <section>
          <div className="relative">
            <MagnifyingGlass
              size={18}
              weight="light"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente (nome ou telefone)"
              className="w-full rounded-xl border border-border bg-card py-3 pl-10 pr-10 text-base text-foreground shadow-card placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted"
              >
                <X size={15} weight="bold" aria-hidden />
              </button>
            )}
          </div>

          {search && (
            <div className="mt-2 space-y-1.5">
              {searchResults.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted">Nenhum cliente encontrado.</p>
              ) : (
                searchResults.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {client.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {client.phone ? formatPhone(client.phone) : "Sem telefone"}
                        {client.vehicles && client.vehicles.length > 0
                          ? ` · ${client.vehicles.map((v) => v.plate).join(", ")}`
                          : ""}
                      </p>
                    </div>
                    {client.phone && (
                      <a
                        href={getWhatsAppUrl(client.phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`WhatsApp de ${client.name}`}
                        className="tap-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
                      >
                        <WhatsappLogo size={18} weight="fill" aria-hidden />
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Grade de ações */}
        <section>
          <p className="label-caps mb-2.5">Ações rápidas</p>
          <div className="grid grid-cols-2 gap-3">
            {ACTIONS.map((action, index) => {
              const IconComponent = action.icon;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => openAction(action.key)}
                  style={{ animationDelay: `${index * 45}ms` }}
                  className="tap-press rise-in flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card"
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl ${action.chip}`}
                  >
                    <IconComponent size={24} weight="light" aria-hidden />
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
        </section>
      </main>

      {/* FAB central */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Adicionar"
        className="fab-pop tap-press fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] left-1/2 z-50 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-white shadow-card-hover ring-4 ring-background"
      >
        <Plus size={30} weight="bold" aria-hidden />
      </button>

      {/* Menu de ações do FAB */}
      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Adicionar"
        description="O que você quer registrar?"
      >
        <div className="grid grid-cols-2 gap-3 pb-2">
          {ACTIONS.map((action) => {
            const IconComponent = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => openAction(action.key)}
                className="tap-press flex items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.chip}`}
                >
                  <IconComponent size={22} weight="light" aria-hidden />
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {action.label}
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
      <VehicleSheet
        open={openSheet === "vehicle"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        clients={clients}
        onDone={notify}
        onChanged={reloadClients}
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
      <ServiceSheet
        open={openSheet === "service"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        onDone={notify}
        onCreated={(service) => setServices((prev) => [...prev, service])}
      />
      <ProductSheet
        open={openSheet === "product"}
        onClose={() => setOpenSheet(null)}
        supabase={supabase}
        workshopId={workshopId}
        onDone={notify}
      />

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
