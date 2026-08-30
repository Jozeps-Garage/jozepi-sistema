"use client";

import { Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { ClientPicker } from "@/components/mobile/client-picker";
import { MoneyField } from "@/components/mobile/sheets/fields";
import { ServiceSheet } from "@/components/mobile/sheets/service-sheet";
import {
  insertAppointmentOrder,
  saveAppointmentItems,
} from "@/lib/agenda/mutations";
import {
  buildServiceOrderItems,
  calculateServicesTotal,
  getServicePrice,
} from "@/lib/agenda/utils";
import {
  BUSINESS_END_TIME,
  BUSINESS_START_TIME,
  SLOT_INTERVAL_MINUTES,
} from "@/lib/agenda/constants";
import type { AgendaService } from "@/lib/agenda/types";
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
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceSheetOpen, setServiceSheetOpen] = useState(false);
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

  const selectedServices = useMemo(
    () => services.filter((service) => serviceIds.includes(service.id)),
    [services, serviceIds]
  );

  const computedTotal = useMemo(
    () => calculateServicesTotal(serviceIds, services),
    [serviceIds, services]
  );

  // Duração total (min) para um conjunto de serviços — mínimo de um slot.
  function durationForIds(ids: string[]) {
    const sum = services
      .filter((service) => ids.includes(service.id))
      .reduce(
        (acc, service) => acc + (service.duration_minutes || SLOT_INTERVAL_MINUTES),
        0
      );
    return Math.max(SLOT_INTERVAL_MINUTES, sum);
  }

  // Deriva a hora de fim a partir de um início + serviços selecionados.
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
    setServiceIds([]);
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

  function toggleService(id: string) {
    const next = serviceIds.includes(id)
      ? serviceIds.filter((value) => value !== id)
      : [...serviceIds, id];
    setServiceIds(next);
    setEndTime(deriveEnd(startTime, next));
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label-caps">Serviços</span>
              <button
                type="button"
                onClick={() => setServiceSheetOpen(true)}
                className="tap-press flex items-center gap-1 text-xs font-semibold text-primary"
              >
                <Plus size={14} weight="bold" aria-hidden />
                Novo serviço
              </button>
            </div>
            {services.length === 0 ? (
              <p className="text-xs text-muted">
                Nenhum serviço no catálogo. Toque em “Novo serviço” para criar.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {services.map((service) => {
                  const active = serviceIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => toggleService(service.id)}
                      className={`tap-press rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-card text-foreground"
                      }`}
                    >
                      {service.name} · {formatCurrency(getServicePrice(service))}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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

      <ServiceSheet
        open={serviceSheetOpen}
        onClose={() => setServiceSheetOpen(false)}
        supabase={supabase}
        workshopId={workshopId}
        onDone={onDone}
        onCreated={(service) => {
          onServiceCreated(service);
          const next = [...serviceIds, service.id];
          setServiceIds(next);
          setEndTime(
            minutesToTime(
              timeToMinutes(startTime) +
                Math.max(
                  SLOT_INTERVAL_MINUTES,
                  durationForIds(serviceIds) +
                    (service.duration_minutes || SLOT_INTERVAL_MINUTES)
                )
            )
          );
        }}
      />
    </>
  );
}
