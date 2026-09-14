"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Car,
  IdentificationCard,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrandAutocomplete } from "@/components/clients/brand-autocomplete";
import { ModelAutocomplete } from "@/components/clients/model-autocomplete";
import { VehiclePhotoUpload } from "@/components/clients/vehicle-photo-upload";
import {
  type Client,
  type ClientFormData,
  type VehicleFormItem,
  emptyClientForm,
  emptyVehicle,
} from "@/types/client";
import { formatPhone, normalizePhone } from "@/lib/utils/format";

interface ClientFormModalProps {
  open: boolean;
  client?: Client | null;
  startWithNewVehicle?: boolean;
  onClose: () => void;
  onSave: (data: ClientFormData) => Promise<void>;
}

const VEHICLE_FORM_EXIT_MS = 180;
const CLIENT_MODAL_ICON_WEIGHT = "light" as const;

function mapVehicleFromClient(v: NonNullable<Client["vehicles"]>[0]): VehicleFormItem {
  return {
    uiKey: v.id,
    id: v.id,
    brand: v.brand,
    model: v.model,
    plate: v.plate,
    year: v.year ? String(v.year) : "",
    photoUrl1: v.photo_url_1,
    photoUrl2: v.photo_url_2,
    photoFile1: null,
    photoFile2: null,
    previewUrl1: v.photo_url_1,
    previewUrl2: v.photo_url_2,
    removePhoto1: false,
    removePhoto2: false,
  };
}

function createVehicleItem(): VehicleFormItem {
  return {
    ...emptyVehicle,
    uiKey:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `vehicle-${Date.now()}-${Math.random()}`,
  };
}

function getVehicleKey(vehicle: VehicleFormItem, index: number) {
  return vehicle.uiKey ?? vehicle.id ?? `vehicle-${index}`;
}

function VehicleEditorModal({
  vehicle,
  closing,
  onClose,
  onSave,
}: {
  vehicle: VehicleFormItem;
  closing: boolean;
  onClose: () => void;
  onSave: (vehicle: VehicleFormItem) => void;
}) {
  const [form, setForm] = useState<VehicleFormItem>(vehicle);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!vehicle.id || !!vehicle.brand || !!vehicle.model || !!vehicle.plate;

  useEffect(() => {
    return () => {
      if (form.previewUrl1?.startsWith("blob:")) URL.revokeObjectURL(form.previewUrl1);
      if (form.previewUrl2?.startsWith("blob:")) URL.revokeObjectURL(form.previewUrl2);
    };
  }, [form.previewUrl1, form.previewUrl2]);

  function updateVehicle(patch: Partial<VehicleFormItem>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handlePhoto(slot: 1 | 2, file: File) {
    const previewKey = slot === 1 ? "previewUrl1" : "previewUrl2";
    const currentPreview = form[previewKey];
    if (currentPreview?.startsWith("blob:")) URL.revokeObjectURL(currentPreview);

    if (slot === 1) {
      updateVehicle({
        photoFile1: file,
        previewUrl1: URL.createObjectURL(file),
        removePhoto1: false,
      });
      return;
    }

    updateVehicle({
      photoFile2: file,
      previewUrl2: URL.createObjectURL(file),
      removePhoto2: false,
    });
  }

  function removePhoto(slot: 1 | 2) {
    const previewKey = slot === 1 ? "previewUrl1" : "previewUrl2";
    const currentPreview = form[previewKey];
    if (currentPreview?.startsWith("blob:")) URL.revokeObjectURL(currentPreview);

    if (slot === 1) {
      updateVehicle({
        photoFile1: null,
        previewUrl1: null,
        removePhoto1: true,
      });
      return;
    }

    updateVehicle({
      photoFile2: null,
      previewUrl2: null,
      removePhoto2: true,
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!form.brand.trim() || !form.model.trim() || !form.plate.trim()) {
      setError("Preencha marca, modelo e placa do veículo.");
      return;
    }

    onSave(form);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Fechar formulário de veículo"
        className={`absolute inset-0 bg-foreground/40 backdrop-blur-sm ${
          closing ? "client-vehicle-overlay-exit" : "client-vehicle-overlay-enter"
        }`}
        onClick={onClose}
      />
      <form
        onSubmit={handleSubmit}
        className={`relative z-[131] max-h-[82vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card shadow-card p-4 shadow-2xl sm:p-5 ${
          closing ? "client-vehicle-card-exit" : "client-vehicle-card-enter"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-success">
              Veículo do cliente
            </p>
            <h3 className="mt-1 text-lg font-bold text-foreground">
              {isEditing ? "Editar veículo" : "Adicionar veículo"}
            </h3>
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
            <X size={20} weight={CLIENT_MODAL_ICON_WEIGHT} aria-hidden />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BrandAutocomplete
            label="Marca"
            value={form.brand}
            onChange={(brand) => updateVehicle({ brand })}
            placeholder="Digite para buscar"
          />
          <ModelAutocomplete
            label="Modelo"
            brand={form.brand}
            value={form.model}
            onChange={(model) => updateVehicle({ model })}
            placeholder="Corolla"
          />
          <Input
            label="Placa"
            value={form.plate}
            onChange={(event) =>
              updateVehicle({ plate: event.target.value.toUpperCase() })
            }
            placeholder="ABC-1D23"
          />
          <Input
            label="Ano"
            value={form.year}
            onChange={(event) =>
              updateVehicle({ year: event.target.value.replace(/\D/g, "").slice(0, 4) })
            }
            placeholder="2024"
            inputMode="numeric"
            maxLength={4}
          />
        </div>

        <div className="mt-4">
          <VehiclePhotoUpload
            preview1={form.previewUrl1}
            preview2={form.previewUrl2}
            onPhoto1={(file) => handlePhoto(1, file)}
            onPhoto2={(file) => handlePhoto(2, file)}
            onRemove1={() => removePhoto(1)}
            onRemove2={() => removePhoto(2)}
            onError={setError}
            compact
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
          <Button type="submit" variant="success" className="w-full sm:w-auto">
            Salvar veículo
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}

export function ClientFormModal({
  open,
  client,
  startWithNewVehicle = false,
  onClose,
  onSave,
}: ClientFormModalProps) {
  const [form, setForm] = useState<ClientFormData>(emptyClientForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingVehicleKeys, setRemovingVehicleKeys] = useState<Set<string>>(
    new Set()
  );
  const [vehicleModalIndex, setVehicleModalIndex] = useState<number | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState<VehicleFormItem | null>(null);
  const [vehicleModalClosing, setVehicleModalClosing] = useState(false);

  const isEditing = !!client;

  useEffect(() => {
    if (open) {
      const nextForm = client
        ? {
            name: client.name,
            phone: formatPhone(client.phone),
            notes: client.notes ?? "",
            vehicles: client.vehicles?.map(mapVehicleFromClient) ?? [],
          }
        : emptyClientForm;

      void Promise.resolve().then(() => {
        setForm(nextForm);
        setError(null);
        setRemovingVehicleKeys(new Set());
        setVehicleModalIndex(null);
        setVehicleDraft(startWithNewVehicle ? createVehicleItem() : null);
        setVehicleModalClosing(false);
      });
    }

    return () => {
      form.vehicles.forEach((v) => {
        if (v.previewUrl1?.startsWith("blob:")) URL.revokeObjectURL(v.previewUrl1);
        if (v.previewUrl2?.startsWith("blob:")) URL.revokeObjectURL(v.previewUrl2);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, startWithNewVehicle]);

  if (!open) return null;

  function updateField(field: "name" | "phone" | "notes", value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function openVehicleModal(index: number | null) {
    setVehicleModalClosing(false);
    setVehicleModalIndex(index);
    setVehicleDraft(index === null ? createVehicleItem() : form.vehicles[index]);
  }

  function closeVehicleModal() {
    if (!vehicleDraft || vehicleModalClosing) return;

    setVehicleModalClosing(true);
    window.setTimeout(() => {
      setVehicleDraft(null);
      setVehicleModalIndex(null);
      setVehicleModalClosing(false);
    }, VEHICLE_FORM_EXIT_MS);
  }

  function saveVehicleFromModal(vehicle: VehicleFormItem) {
    setForm((prev) => ({
      ...prev,
      vehicles:
        vehicleModalIndex === null
          ? [...prev.vehicles, vehicle]
          : prev.vehicles.map((item, index) =>
              index === vehicleModalIndex ? vehicle : item
            ),
    }));
    closeVehicleModal();
  }

  function removeVehicle(index: number) {
    const vehicle = form.vehicles[index];
    const key = getVehicleKey(vehicle, index);

    setRemovingVehicleKeys((prev) => new Set(prev).add(key));

    window.setTimeout(() => {
      setForm((prev) => {
        const vehicleToRemove = prev.vehicles.find(
          (v, i) => getVehicleKey(v, i) === key
        );
        if (vehicleToRemove?.previewUrl1?.startsWith("blob:"))
          URL.revokeObjectURL(vehicleToRemove.previewUrl1);
        if (vehicleToRemove?.previewUrl2?.startsWith("blob:"))
          URL.revokeObjectURL(vehicleToRemove.previewUrl2);

        return {
          ...prev,
          vehicles: prev.vehicles.filter((v, i) => getVehicleKey(v, i) !== key),
        };
      });
      setRemovingVehicleKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 180);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await onSave({
        ...form,
        phone: normalizePhone(form.phone),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar cliente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card shadow-card p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? "Editar cliente" : "Novo cliente"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X size={20} weight={CLIENT_MODAL_ICON_WEIGHT} aria-hidden />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nome"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="Nome do cliente"
            required
          />

          <Input
            label="Telefone"
            value={form.phone}
            onChange={(e) => updateField("phone", e.target.value)}
            placeholder="(11) 99999-9999"
            required
          />

          <div className="space-y-3">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Car size={16} weight={CLIENT_MODAL_ICON_WEIGHT} className="text-muted" aria-hidden />
                Veículos
              </label>
              <button
                type="button"
                onClick={() => openVehicleModal(null)}
                className="group flex w-full items-center justify-between rounded-lg border border-success/30 bg-success/10 p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-success/60 hover:bg-success/15 hover:shadow-card-hover"
              >
                <span>
                  <span className="block text-sm font-semibold text-success">
                    Adicionar veículo
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Inclua marca, modelo, ano, placa e até 2 fotos
                  </span>
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-white transition-transform duration-200 group-hover:scale-110">
                  <Plus size={20} weight={CLIENT_MODAL_ICON_WEIGHT} aria-hidden />
                </span>
              </button>
            </div>

            {form.vehicles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-3 text-center text-sm text-muted">
                Nenhum veículo adicionado
              </p>
            ) : (
              <div className="space-y-3">
                {form.vehicles.map((vehicle, index) => {
                  const vehicleKey = getVehicleKey(vehicle, index);
                  const isRemoving = removingVehicleKeys.has(vehicleKey);

                  return (
                    <div
                      key={vehicleKey}
                      className={`rounded-lg border border-border bg-background shadow-card/30 p-4 transition-all duration-200 ${
                        isRemoving
                          ? "vehicle-card-exit pointer-events-none"
                          : "vehicle-card-enter"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-muted">
                            Veículo {index + 1}
                          </span>
                          <p className="mt-1 truncate text-sm font-semibold text-foreground">
                            {vehicle.brand || "Marca"} {vehicle.model || "Modelo"}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
                            <IdentificationCard
                              size={14}
                              weight={CLIENT_MODAL_ICON_WEIGHT}
                              className="shrink-0"
                              aria-hidden
                            />
                            <span className="truncate">
                              {vehicle.plate || "Placa não informada"}
                              {vehicle.year ? ` • ${vehicle.year}` : ""}
                            </span>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openVehicleModal(index)}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-xs font-semibold text-success transition-all duration-200 hover:-translate-y-0.5 hover:bg-success hover:text-white hover:shadow-card-hover"
                          >
                            <PencilSimple size={16} weight={CLIENT_MODAL_ICON_WEIGHT} aria-hidden />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => removeVehicle(index)}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition-all duration-200 hover:-translate-y-0.5 hover:bg-danger hover:text-white hover:shadow-card-hover"
                          >
                            <Trash size={16} weight={CLIENT_MODAL_ICON_WEIGHT} aria-hidden />
                            Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">
              Observações
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Anotações sobre o cliente..."
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-input px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="success" loading={loading}>
              {isEditing ? "Salvar" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </div>
      {vehicleDraft && (
        <VehicleEditorModal
          key={getVehicleKey(vehicleDraft, vehicleModalIndex ?? form.vehicles.length)}
          vehicle={vehicleDraft}
          closing={vehicleModalClosing}
          onClose={closeVehicleModal}
          onSave={saveVehicleFromModal}
        />
      )}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .client-vehicle-overlay-enter {
            animation: client-vehicle-fade-in 220ms ease-out both;
          }

          .client-vehicle-overlay-exit {
            animation: client-vehicle-fade-out ${VEHICLE_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }

          .client-vehicle-card-enter {
            animation: client-vehicle-card-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .client-vehicle-card-exit {
            animation: client-vehicle-card-exit ${VEHICLE_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }
        }

        @keyframes client-vehicle-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes client-vehicle-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes client-vehicle-card-enter {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes client-vehicle-card-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
        }
      `}</style>
    </div>
  );
}
