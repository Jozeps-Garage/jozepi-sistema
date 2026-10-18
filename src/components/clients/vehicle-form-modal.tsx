"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModelAutocomplete } from "@/components/clients/model-autocomplete";
import {
  emptyVehicle,
  type Client,
  type Vehicle,
  type VehicleFormItem,
} from "@/types/client";

const CLIENT_ICON_WEIGHT = "light" as const;

export function createVehicleFormItem(vehicle?: Vehicle | null): VehicleFormItem {
  if (vehicle) {
    return {
      uiKey: vehicle.id,
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      plate: vehicle.plate ?? "",
      year: vehicle.year ? String(vehicle.year) : "",
      photoUrl1: vehicle.photo_url_1,
      photoUrl2: vehicle.photo_url_2,
      photoFile1: null,
      photoFile2: null,
      previewUrl1: vehicle.photo_url_1,
      previewUrl2: vehicle.photo_url_2,
      removePhoto1: false,
      removePhoto2: false,
    };
  }

  return {
    ...emptyVehicle,
    uiKey:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `vehicle-${Date.now()}-${Math.random()}`,
  };
}

export function VehicleFormModal({
  client,
  vehicle,
  closing,
  onClose,
  onSave,
}: {
  client: Client;
  vehicle?: Vehicle | null;
  closing: boolean;
  onClose: () => void;
  onSave: (vehicle: VehicleFormItem) => Promise<void>;
}) {
  const [form, setForm] = useState<VehicleFormItem>(() =>
    createVehicleFormItem(vehicle)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!vehicle;

  useEffect(() => {
    return () => {
      if (form.previewUrl1?.startsWith("blob:")) URL.revokeObjectURL(form.previewUrl1);
      if (form.previewUrl2?.startsWith("blob:")) URL.revokeObjectURL(form.previewUrl2);
    };
  }, [form.previewUrl1, form.previewUrl2]);

  function updateVehicle(patch: Partial<VehicleFormItem>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar veículo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Fechar formulário de veículo"
        className={`absolute inset-0 bg-foreground/40 backdrop-blur-sm ${
          closing ? "vehicle-modal-overlay-exit" : "vehicle-modal-overlay-enter"
        }`}
        onClick={onClose}
      />
      <form
        onSubmit={handleSubmit}
        className={`relative z-[101] max-h-[82vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card shadow-card p-4 shadow-2xl sm:p-5 ${
          closing ? "vehicle-modal-card-exit" : "vehicle-modal-card-enter"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-success">
              {client.name}
            </p>
            <h2 className="mt-1 text-lg font-bold text-foreground">
              {isEditing ? "Editar veículo" : "Adicionar veículo"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Preencha somente os dados do veículo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-muted transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={20} weight={CLIENT_ICON_WEIGHT} aria-hidden />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Marca e ano seguem no estado, sem campo, para editar um veículo antigo
            não apagar o que já estava lá. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModelAutocomplete
            label="Veículo"
            brand={form.brand}
            value={form.model}
            onChange={(model) => updateVehicle({ model })}
            placeholder="Ex.: S10 branca"
          />
          <Input
            label="Placa (opcional)"
            value={form.plate}
            onChange={(event) =>
              updateVehicle({ plate: event.target.value.toUpperCase() })
            }
            placeholder="ABC-1D23"
          />
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="success"
            loading={saving}
            className="w-full sm:w-auto"
          >
            {isEditing ? "Salvar veículo" : "Adicionar veículo"}
          </Button>
        </div>
      </form>
    </div>
  );
}
