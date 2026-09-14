"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { ClientPicker } from "@/components/mobile/client-picker";
import { MoneyField } from "@/components/mobile/sheets/fields";
import {
  SelectedCatalogItems,
  ServiceCatalogDialog,
  type ResolvedCatalogItem,
} from "@/components/quotes/service-catalog-dialog";
import {
  insertAppointmentOrder,
  saveAppointmentItems,
} from "@/lib/agenda/mutations";
import {
  buildServiceOrderItems,
  calculateServicesTotal,
} from "@/lib/agenda/utils";
import {
  BUSINESS_END_TIME,
  BUSINESS_START_TIME,
  SLOT_INTERVAL_MINUTES,
} from "@/lib/agenda/constants";
import type { AgendaService } from "@/lib/agenda/types";
import type { QuoteServiceRow } from "@/lib/quotes/catalog";
import type { Client } from "@/types/client";
import { formatCurrency } from "@/lib/utils/format";
import { parseCurrencyInput } from "@/lib/utils/money";

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(total: number) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface AppointmentSheetProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  workshopId: string;
  clients: Client[];
  services: AgendaService[];
  onServiceCreated: (service: AgendaService) => void;
  onDone: (tone: "success" | "error", message: string) => void;
  onCreated?: () => void;
}

export function AppointmentSheet({
  open,
  onClose,
  supabase,
  workshopId,
  clients,
  services,
  onServiceCreated,
  onDone,
  onCreated,
}: AppointmentSheetProps) {
  const [clientId, setClientId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [selectedItems, setSelectedItems] = useState<ResolvedCatalogItem[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    let cursor = timeToMinutes(BUSINESS_START_TIME);
    const end = timeToMinutes(BUSINESS_END_TIME);
    while (cursor <= end) {
      const time = minutesToTime(cursor);
      out.push({ value: time, label: time });
      cursor += SLOT_INTERVAL_MINUTES;
    }
    return out;
  }, []);

  const serviceIds = useMemo(
    () => selectedItems.map((item) => item.serviceId),
    [selectedItems]
  );
  const addedServiceIds = useMemo(() => new Set(serviceIds), [serviceIds]);
  const catalogServices = services as QuoteServiceRow[];

  const selectedServices = useMemo(
    () =>
      selectedItems.map((item) => {
        const existing = services.find((service) => service.id === item.serviceId);
        return (
          existing ?? {
            id: item.serviceId,
            name: item.name,
            price: item.price,
            duration_minutes: null,
            active: true,
            category: item.kind,
          }
        );
      }),
    [selectedItems, services]
  );

  const computedTotal = useMemo(
    () =>
      selectedItems.length > 0
        ? selectedItems.reduce((sum, item) => sum + item.price, 0)
        : calculateServicesTotal(serviceIds, services),
    [selectedItems, serviceIds, services]
  );

  function durationForIds(ids: string[]) {
    const sum = services
      .filter((service) => ids.includes(service.id))
      .reduce(
        (acc, service) => acc + (service.duration_minutes || SLOT_INTERVAL_MINUTES),
        0
      );
    return Math.max(SLOT_INTERVAL_MINUTES, sum);
  }

  function deriveEnd(start: string, ids: string[]) {
    return minutesToTime(timeToMinutes(start) + durationForIds(ids));
  }

  function handleStartChange(value: string) {
    setStartTime(value);
    setEndTime(deriveEnd(value, serviceIds));
  }

  function reset() {
    setClientId("");
    setVehicleId("");
    setSelectedItems([]);
    setCatalogOpen(false);
    setDate(todayKey());
    setStartTime("08:00");
    setAmount("");
    setNotes("");
    setError(null);
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  function removeService(serviceId: string) {
    const next = selectedItems.filter((item) => item.serviceId !== serviceId);
    setSelectedItems(next);
    setEndTime(deriveEnd(startTime, next.map((item) => item.serviceId)));
  }

  function handleCatalogAdded(
    items: ResolvedCatalogItem[],
    latestServices: QuoteServiceRow[]
  ) {
    const next = [
      ...selectedItems,
      ...items.filter(
        (item) => !selectedItems.some((row) => row.serviceId === item.serviceId)
      ),
    ];
    setSelectedItems(next);
    setEndTime(deriveEnd(startTime, next.map((item) => item.serviceId)));

    for (const item of items) {
      if (services.some((service) => service.id === item.serviceId)) continue;
      const synced = latestServices.find((service) => service.id === item.serviceId);
      onServiceCreated({
        id: item.serviceId,
        name: item.name,
        price: item.price,
        duration_minutes: synced?.duration_minutes ?? null,
        active: true,
        category: item.kind,
      });
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!clientId || !vehicleId) {
      setError("Selecione o cliente e o veículo.");
      return;
    }
    if (!date || !startTime) {
      setError("Informe data e horário.");
      return;
    }
    if (endTime <= startTime) {
      setError("A hora de fim deve ser após o início.");
      return;
    }

    let total = computedTotal;
    if (amount.trim()) {
      try {
        total = parseCurrencyInput(amount, { min: 0 });
      } catch {
        setError("Valor total inválido.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const { data: inserted, error: insertError } = await insertAppointmentOrder(
        supabase,
        workshopId,
        {
          client_id: clientId,
          vehicle_id: vehicleId,
          total_amount: total,
          notes: notes.trim() || null,
          scheduled_date: date,
          scheduled_end_date: date,
          scheduled_start: startTime,
          scheduled_end: endTime,
          status: "aberta",
        }
      );

      if (insertError) throw new Error(insertError.message);
      const appointmentId = inserted?.id as string | undefined;
      if (!appointmentId) throw new Error("Erro ao salvar agendamento.");

      if (selectedServices.length > 0) {
        const items = buildServiceOrderItems(selectedServices, total);
        const { error: itemsError } = await saveAppointmentItems(
          supabase,
          appointmentId,
          items
        );
        if (itemsError) throw new Error(itemsError.message);
      }

      onCreated?.();
      onDone("success", "Agendamento criado!");
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar agendamento.");
      onDone("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={handleClose}
        title="Novo agendamento"
        description="Cliente, serviços e horário"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <span className="label-caps">Cliente e veículo</span>
            <ClientPicker
              clients={clients}
              clientId={clientId}
              onSelectClient={(client) => {
                setClientId(client.id);
                const only =
                  client.vehicles && client.vehicles.length === 1
                    ? client.vehicles[0].id
                    : "";
                setVehicleId(only);
              }}
              onClear={() => {
                setClientId("");
                setVehicleId("");
              }}
              vehicleId={vehicleId}
              onSelectVehicle={(vehicle) => setVehicleId(vehicle.id)}
            />
          </div>

          <SelectedCatalogItems
            label="Serviços"
            items={selectedItems}
            onSelect={() => setCatalogOpen(true)}
            onRemove={removeService}
          />

          <Input
            label="Data"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Dropdown
              label="Início"
              value={startTime}
              onChange={handleStartChange}
              options={slots}
            />
            <Dropdown
              label="Fim"
              value={endTime}
              onChange={setEndTime}
              options={slots}
            />
          </div>

          <MoneyField
            label={`Total${computedTotal > 0 ? ` (sugerido ${formatCurrency(computedTotal)})` : ""}`}
            value={amount}
            onChange={setAmount}
          />

          <Input
            label="Observações"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional"
          />

          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" loading={saving} className="w-full">
            Criar agendamento
          </Button>
        </form>
      </BottomSheet>

      <ServiceCatalogDialog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        services={catalogServices}
        excludedServiceIds={addedServiceIds}
        supabase={supabase}
        workshopId={workshopId}
        description="Marque quantos quiser e confirme para adicionar ao agendamento."
        onAdded={handleCatalogAdded}
      />
    </>
  );
}
