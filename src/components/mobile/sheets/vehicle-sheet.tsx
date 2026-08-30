"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { ClientPicker } from "@/components/mobile/client-picker";
import { syncVehicles } from "@/lib/clients/sync-vehicles";
import { emptyVehicle, type Client } from "@/types/client";

interface VehicleSheetProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  workshopId: string;
  clients: Client[];
  onDone: (tone: "success" | "error", message: string) => void;
  onChanged?: () => void;
}

export function VehicleSheet({
  open,
  onClose,
  supabase,
  workshopId,
  clients,
  onDone,
  onChanged,
}: VehicleSheetProps) {
  const [clientId, setClientId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [year, setYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setClientId("");
    setBrand("");
    setModel("");
    setPlate("");
    setYear("");
    setError(null);
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!clientId) {
      setError("Selecione o cliente.");
      return;
    }
    if (!brand.trim() || !model.trim() || !plate.trim()) {
      setError("Preencha marca, modelo e placa.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await syncVehicles(supabase, workshopId, clientId, [
        {
          ...emptyVehicle,
          uiKey: "novo",
          brand: brand.trim(),
          model: model.trim(),
          plate: plate.trim().toUpperCase(),
          year: year.trim(),
        },
      ]);
      onChanged?.();
      onDone("success", "Veículo cadastrado!");
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar veículo.");
      onDone("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title="Novo veículo"
      description="Adicionar a um cliente existente"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <span className="label-caps">Cliente</span>
          <ClientPicker
            clients={clients}
            clientId={clientId}
            onSelectClient={(client) => setClientId(client.id)}
            onClear={() => setClientId("")}
          />
        </div>

        {clientId && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Marca"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                placeholder="Ex.: Honda"
              />
              <Input
                label="Modelo"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Ex.: Civic"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Placa"
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
                placeholder="ABC1D23"
              />
              <Input
                label="Ano"
                value={year}
                onChange={(event) => setYear(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="Opcional"
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" loading={saving} className="w-full">
              Cadastrar veículo
            </Button>
          </>
        )}
        {!clientId && error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </BottomSheet>
  );
}
