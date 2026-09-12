"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarPlus,
  Car,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UsersThree,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PlateIcon } from "@/components/ui/plate-icon";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { BrandAutocomplete } from "@/components/clients/brand-autocomplete";
import { ModelAutocomplete } from "@/components/clients/model-autocomplete";
import { ClientFormModal } from "@/components/clients/client-form-modal";
import { VehiclePhotoUpload } from "@/components/clients/vehicle-photo-upload";
import { formatDate, formatPhone, getWhatsAppUrl, normalizePhone } from "@/lib/utils/format";
import { syncVehicles } from "@/lib/clients/sync-vehicles";
import { deleteVehiclePhotoByUrl } from "@/lib/supabase/vehicle-photos";
import {
  emptyVehicle,
  type Client,
  type ClientFormData,
  type Vehicle,
  type VehicleFormItem,
} from "@/types/client";

const CLIENT_ICON_WEIGHT = "light" as const;

const clientInfoCardClass =
  "inline-flex h-10 min-w-[10rem] items-center gap-2 rounded-lg border border-border bg-input px-3 text-sm font-medium shadow-card";

const VEHICLE_MODAL_EXIT_MS = 180;

const vehicleYearOptions = Array.from(
  { length: new Date().getFullYear() - 1980 + 1 },
  (_, index) => String(new Date().getFullYear() - index)
).map((year) => ({ value: year, label: year }));

function createVehicleFormItem(vehicle?: Vehicle | null): VehicleFormItem {
  if (vehicle) {
    return {
      uiKey: vehicle.id,
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      plate: vehicle.plate,
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

function ClientStatChip({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 shadow-card">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="text-sm font-bold leading-tight text-foreground">{value}</p>
      </div>
    </div>
  );
}

function VehicleFormModal({
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
            placeholder="S10"
          />
          <Input
            label="Placa"
            value={form.plate}
            onChange={(event) =>
              updateVehicle({ plate: event.target.value.toUpperCase() })
            }
            placeholder="ABC-1D23"
            required
          />
          <Dropdown
            label="Ano"
            value={form.year}
            placeholder="Selecione o ano"
            options={vehicleYearOptions}
            onChange={(year) => updateVehicle({ year })}
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

function ClientVehiclesPanel({
  client,
  closing,
  deletingVehicleId,
  onAddVehicle,
  onClose,
  onDeleteVehicle,
  onEditVehicle,
}: {
  client: Client;
  closing: boolean;
  deletingVehicleId: string | null;
  onAddVehicle: (client: Client) => void;
  onClose: () => void;
  onDeleteVehicle: (client: Client, vehicle: Vehicle) => void;
  onEditVehicle: (client: Client, vehicle: Vehicle) => void;
}) {
  const vehicles = client.vehicles ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`vehicle-panel-overlay absolute inset-0 bg-foreground/40 backdrop-blur-sm ${
          closing ? "vehicle-panel-overlay-exit" : "vehicle-panel-overlay-enter"
        }`}
        onClick={onClose}
      />
      <aside
        className={`vehicle-panel-drawer relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card shadow-2xl ${
          closing ? "vehicle-panel-drawer-exit" : "vehicle-panel-drawer-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              Veículos cadastrados
            </p>
            <h2 className="mt-1 text-xl font-bold text-foreground">
              {client.name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {vehicles.length} veículo{vehicles.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-background hover:text-foreground"
            aria-label="Fechar veículos"
          >
            <X size={20} weight={CLIENT_ICON_WEIGHT} aria-hidden />
          </button>
        </div>

        <div className="border-b border-border px-6 py-4">
          <button
            type="button"
            onClick={() => onAddVehicle(client)}
            className="flex w-full items-center justify-between rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-success/60 hover:bg-success/15 hover:shadow-card-hover"
          >
            <span>
              <span className="block text-sm font-semibold text-success">
                Adicionar veículo
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Cadastrar outro carro para este cliente
              </span>
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success text-white">
              <Plus size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
            </span>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {vehicles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Car size={24} weight={CLIENT_ICON_WEIGHT} aria-hidden />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Nenhum veículo cadastrado
              </p>
              <p className="mt-1 text-xs text-muted">
                Edite o cliente para adicionar carros.
              </p>
            </div>
          ) : (
            vehicles.map((vehicle) => {
              const photos = [
                vehicle.photo_url_1,
                vehicle.photo_url_2,
              ].filter(Boolean) as string[];

              return (
                <article
                  key={vehicle.id}
                  className="rounded-lg border border-border bg-background p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-bold text-foreground">
                        {vehicle.brand} {vehicle.model}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-widest text-primary">
                        <PlateIcon className="h-4 w-4 shrink-0" />
                        {vehicle.plate}
                      </p>
                    </div>
                    <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {vehicle.year ?? "Ano não informado"}
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEditVehicle(client, vehicle)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-semibold text-success transition-colors hover:bg-success hover:text-white"
                    >
                      <PencilSimple size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
                      Editar
                    </button>
                    <button
                      type="button"
                      disabled={deletingVehicleId === vehicle.id}
                      onClick={() => onDeleteVehicle(client, vehicle)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
                      {deletingVehicleId === vehicle.id ? "Excluindo..." : "Excluir"}
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {[0, 1].map((index) => {
                      const photo = photos[index];

                      return photo ? (
                        <div
                          key={photo}
                          className="relative h-36 overflow-hidden rounded-lg border border-border bg-card shadow-card"
                        >
                          <Image
                            src={photo}
                            alt={`Foto ${index + 1} de ${vehicle.brand} ${vehicle.model}`}
                            fill
                            sizes="(max-width: 768px) 50vw, 240px"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div
                          key={`empty-photo-${index}`}
                          className="flex h-36 items-center justify-center rounded-lg border border-dashed border-border bg-card text-muted"
                        >
                          <div className="text-center">
                            <Car
                              size={24}
                              weight={CLIENT_ICON_WEIGHT}
                              className="mx-auto"
                              aria-hidden
                            />
                            <p className="mt-2 text-xs font-medium">
                              Sem foto
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [startWithNewVehicle, setStartWithNewVehicle] = useState(false);
  const [vehiclesClient, setVehiclesClient] = useState<Client | null>(null);
  const [vehiclesPanelClosing, setVehiclesPanelClosing] = useState(false);
  const [vehicleModalClient, setVehicleModalClient] = useState<Client | null>(
    null
  );
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleModalClosing, setVehicleModalClosing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "client"; client: Client }
    | { type: "vehicle"; client: Client; vehicle: Vehicle }
    | null
  >(null);

  const supabase = useMemo(() => createClient(), []);

  const loadClients = useCallback(async () => {
    setLoading(true);

    const { workshopId: profileWorkshopId } = await fetchOwnWorkshop(supabase);

    if (!profileWorkshopId) {
      setLoading(false);
      return;
    }

    setWorkshopId(profileWorkshopId);

    const { data, error } = await supabase
      .from("clients")
      .select(
        "*, vehicles(id, client_id, brand, model, plate, year, photo_url_1, photo_url_2, pre_cadastro)"
      )
      .eq("workshop_id", profileWorkshopId)
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
    } else {
      setClients((data as Client[]) ?? []);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void Promise.resolve().then(loadClients);
  }, [loadClients]);

  const filteredClients = clients.filter((client) => {
    const term = search.toLowerCase();
    const vehicleMatch = client.vehicles?.some(
      (v) =>
        v.plate.toLowerCase().includes(term) ||
        v.brand.toLowerCase().includes(term) ||
        v.model.toLowerCase().includes(term)
    );
    return (
      client.name.toLowerCase().includes(term) ||
      client.phone.includes(term) ||
      vehicleMatch
    );
  });

  function openCreateModal() {
    setEditingClient(null);
    setStartWithNewVehicle(false);
    setModalOpen(true);
  }

  function openEditModal(client: Client) {
    setVehiclesClient(null);
    setEditingClient(client);
    setStartWithNewVehicle(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingClient(null);
    setStartWithNewVehicle(false);
  }

  function openVehiclesPanel(client: Client) {
    setVehiclesPanelClosing(false);
    setVehiclesClient(client);
  }

  function closeVehiclesPanel() {
    setVehiclesPanelClosing(true);
    window.setTimeout(() => {
      setVehiclesClient(null);
      setVehiclesPanelClosing(false);
    }, 220);
  }

  function openAddVehicleModal(client: Client) {
    setVehicleModalClosing(false);
    setVehicleModalClient(client);
    setEditingVehicle(null);
  }

  function openEditVehicleModal(client: Client, vehicle: Vehicle) {
    setVehicleModalClosing(false);
    setVehicleModalClient(client);
    setEditingVehicle(vehicle);
  }

  function closeVehicleModal() {
    if (!vehicleModalClient || vehicleModalClosing) return;

    setVehicleModalClosing(true);
    window.setTimeout(() => {
      setVehicleModalClient(null);
      setEditingVehicle(null);
      setVehicleModalClosing(false);
    }, VEHICLE_MODAL_EXIT_MS);
  }

  async function refreshClientVehicles(clientId: string) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, client_id, brand, model, plate, year, photo_url_1, photo_url_2")
      .eq("client_id", clientId)
      .order("brand", { ascending: true })
      .order("model", { ascending: true });

    if (error) throw new Error(error.message);

    const vehicles = (data as Vehicle[]) ?? [];
    const updateClientVehicles = (item: Client) =>
      item.id === clientId ? { ...item, vehicles } : item;

    setClients((prev) => prev.map(updateClientVehicles));
    setVehiclesClient((prev) => (prev ? updateClientVehicles(prev) : prev));
  }

  async function handleSaveVehicle(vehicle: VehicleFormItem) {
    if (!workshopId || !vehicleModalClient) {
      throw new Error("Oficina ou cliente não encontrado.");
    }

    if (!vehicle.brand.trim() || !vehicle.model.trim() || !vehicle.plate.trim()) {
      throw new Error("Preencha marca, modelo e placa do veículo.");
    }

    await syncVehicles(
      supabase,
      workshopId,
      vehicleModalClient.id,
      [vehicle],
      vehicle.id ? [vehicle.id] : []
    );

    // Veículo que veio de um pré-cadastro nasce vazio; ao receber marca, modelo e placa,
    // deixa de ser marcação e vira veículo de verdade.
    if (vehicle.id) {
      await supabase
        .from("vehicles")
        .update({ pre_cadastro: false })
        .eq("id", vehicle.id);
    }

    await refreshClientVehicles(vehicleModalClient.id);
  }

  async function handleSave(data: ClientFormData) {
    if (!workshopId) throw new Error("Oficina não encontrada.");

    // Salvar por este formulário é o que "finaliza" um pré-cadastro: o telefone é obrigatório
    // aqui, então quem chegou até o salvar já preencheu o que faltava.
    const payload = {
      name: data.name.trim(),
      phone: normalizePhone(data.phone),
      notes: data.notes.trim() || null,
      pre_cadastro: false,
    };

    if (editingClient) {
      const { error } = await supabase
        .from("clients")
        .update(payload)
        .eq("id", editingClient.id);

      if (error) throw new Error(error.message);

      await syncVehicles(
        supabase,
        workshopId,
        editingClient.id,
        data.vehicles,
        editingClient.vehicles?.map((v) => v.id) ?? []
      );
    } else {
      const { data: newClient, error } = await supabase
        .from("clients")
        .insert({ ...payload, workshop_id: workshopId })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      await syncVehicles(supabase, workshopId, newClient.id, data.vehicles);
    }

    await loadClients();
  }

  async function deleteServiceOrdersLinkedToClient(clientId: string) {
    const { data: orders, error: ordersError } = await supabase
      .from("service_orders")
      .select("id")
      .eq("client_id", clientId);

    if (ordersError) throw new Error(ordersError.message);

    const orderIds = (orders ?? []).map((order) => order.id);
    if (orderIds.length === 0) return;

    const { error: deleteOrdersError } = await supabase
      .from("service_orders")
      .delete()
      .in("id", orderIds);

    if (deleteOrdersError) throw new Error(deleteOrdersError.message);
  }

  async function deleteServiceOrdersLinkedToVehicle(vehicleId: string) {
    const { data: orders, error: ordersError } = await supabase
      .from("service_orders")
      .select("id")
      .eq("vehicle_id", vehicleId);

    if (ordersError) throw new Error(ordersError.message);

    const orderIds = (orders ?? []).map((order) => order.id);
    if (orderIds.length === 0) return;

    const { error: deleteOrdersError } = await supabase
      .from("service_orders")
      .delete()
      .in("id", orderIds);

    if (deleteOrdersError) throw new Error(deleteOrdersError.message);
  }

  function handleDelete(client: Client) {
    setDeleteConfirm({ type: "client", client });
  }

  async function executeDeleteClient(client: Client) {
    setDeletingId(client.id);

    try {
      await deleteServiceOrdersLinkedToClient(client.id);

      const vehicles = client.vehicles ?? [];
      await Promise.all(
        vehicles.flatMap((vehicle) => [
          deleteVehiclePhotoByUrl(supabase, vehicle.photo_url_1),
          deleteVehiclePhotoByUrl(supabase, vehicle.photo_url_2),
        ])
      );

      const { error } = await supabase
        .from("clients")
        .delete()
        .eq("id", client.id);

      if (error) throw new Error(error.message);

      setDeleteConfirm(null);
      await loadClients();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Erro ao excluir cliente."
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleDeleteVehicle(client: Client, vehicle: Vehicle) {
    setDeleteConfirm({ type: "vehicle", client, vehicle });
  }

  async function executeDeleteVehicle(client: Client, vehicle: Vehicle) {
    setDeletingVehicleId(vehicle.id);

    try {
      await deleteServiceOrdersLinkedToVehicle(vehicle.id);

      await Promise.all([
        deleteVehiclePhotoByUrl(supabase, vehicle.photo_url_1),
        deleteVehiclePhotoByUrl(supabase, vehicle.photo_url_2),
      ]);

      const { error } = await supabase
        .from("vehicles")
        .delete()
        .eq("id", vehicle.id);

      if (error) throw new Error(error.message);

      const removeVehicleFromClient = (item: Client) =>
        item.id === client.id
          ? {
              ...item,
              vehicles: item.vehicles?.filter((v) => v.id !== vehicle.id) ?? [],
            }
          : item;

      setClients((prev) => prev.map(removeVehicleFromClient));
      setVehiclesClient((prev) =>
        prev ? removeVehicleFromClient(prev) : prev
      );
      setDeleteConfirm(null);
      await loadClients();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Erro ao excluir veículo."
      );
    } finally {
      setDeletingVehicleId(null);
    }
  }

  return (
    <>
      <Header
        title="Clientes"
        description="Gerencie o cadastro de clientes"
        actions={
          <Button variant="success" onClick={openCreateModal}>
            <Plus size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
            Adicionar novo cliente
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <MagnifyingGlass
            size={16}
            weight={CLIENT_ICON_WEIGHT}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou placa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-input py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {!loading && (
          <ClientStatChip
            label="Total de clientes"
            value={String(clients.length)}
            icon={<UsersThree size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />}
          />
        )}
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card shadow-card py-16 text-center text-sm text-muted shadow-card">
          Carregando clientes...
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card shadow-card py-16 text-center shadow-card">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <UsersThree size={28} weight={CLIENT_ICON_WEIGHT} className="text-primary" aria-hidden />
          </div>
          <p className="font-medium text-foreground">
            {search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
          </p>
          {!search && (
            <Button
              variant="success"
              className="mt-4"
              onClick={openCreateModal}
            >
              <Plus size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
              Adicionar novo cliente
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {filteredClients.map((client) => {
            const vehicleCount = client.vehicles?.length ?? 0;

            return (
              <article
                key={client.id}
                className="relative rounded-lg border border-border bg-input p-4 pb-10 shadow-card transition-shadow hover:shadow-card-hover"
              >
                <div className="absolute right-3 top-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEditModal(client)}
                    className="rounded-lg bg-success/10 p-2 text-success transition-colors hover:bg-success hover:text-white"
                    title="Editar cliente"
                  >
                    <PencilSimple size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(client)}
                    disabled={deletingId === client.id}
                    className="rounded-lg bg-danger/10 p-2 text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-50"
                    title="Excluir cliente"
                  >
                    <Trash size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
                  </button>
                </div>

                <div className="pr-20">
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {client.name}
                  </h2>
                  {client.pre_cadastro && (
                    <span className="mt-1 inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                      Pré-cadastro · falta preencher
                    </span>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                    {client.phone ? (
                      <a
                        href={getWhatsAppUrl(client.phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`group ${clientInfoCardClass} text-[#008000] transition-all hover:-translate-y-0.5 hover:border-[#008000] hover:bg-[#008000] hover:text-white hover:shadow-card-hover`}
                        title="Abrir conversa no WhatsApp"
                      >
                        <WhatsappLogo
                          size={16}
                          weight={CLIENT_ICON_WEIGHT}
                          className="shrink-0 text-[#008000] transition-colors group-hover:text-white"
                          aria-hidden
                        />
                        <span>{formatPhone(client.phone)}</span>
                      </a>
                    ) : (
                      // Sem telefone não existe link de WhatsApp: o botão leva direto pro cadastro.
                      <button
                        type="button"
                        onClick={() => openEditModal(client)}
                        className={`${clientInfoCardClass} text-muted transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary hover:text-white`}
                        title="Finalizar o cadastro deste cliente"
                      >
                        Sem telefone · finalizar cadastro
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openVehiclesPanel(client)}
                      className={`${clientInfoCardClass} text-primary transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary hover:text-white hover:shadow-card-hover`}
                      title="Ver veículos cadastrados"
                    >
                      <Car size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
                      {vehicleCount} veículo{vehicleCount !== 1 ? "s" : ""}
                    </button>
                  </div>
                </div>

                <Link
                  href={`/agenda?clientId=${client.id}`}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-card transition-all hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-card-hover"
                >
                  <CalendarPlus size={16} weight={CLIENT_ICON_WEIGHT} aria-hidden />
                  Agendar com cliente
                </Link>
                {client.notes && (
                  <p className="mt-3 line-clamp-2 rounded-lg bg-background/70 px-3 py-2 text-sm text-muted">
                    {client.notes}
                  </p>
                )}
                <span className="absolute bottom-3 right-4 text-xs font-medium text-muted">
                  Cadastrado em {formatDate(client.created_at)}
                </span>
              </article>
            );
          })}
        </div>
      )}

      {!loading && clients.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {filteredClients.length} de {clients.length} cliente
          {clients.length !== 1 ? "s" : ""}
        </p>
      )}

      <ClientFormModal
        open={modalOpen}
        client={editingClient}
        startWithNewVehicle={startWithNewVehicle}
        onClose={closeModal}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "client"}
        title="Excluir cliente"
        description={
          deleteConfirm?.type === "client"
            ? `Deseja excluir "${deleteConfirm.client.name}"? Agendamentos e veículos vinculados também serão removidos.`
            : ""
        }
        confirmLabel="Excluir cliente"
        loading={Boolean(deletingId)}
        onCancel={() => {
          if (!deletingId) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "client") {
            void executeDeleteClient(deleteConfirm.client);
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "vehicle"}
        title="Excluir veículo"
        description={
          deleteConfirm?.type === "vehicle"
            ? `Deseja excluir ${deleteConfirm.vehicle.brand} ${deleteConfirm.vehicle.model} (${deleteConfirm.vehicle.plate})? Agendamentos vinculados também serão removidos.`
            : ""
        }
        confirmLabel="Excluir veículo"
        loading={Boolean(deletingVehicleId)}
        onCancel={() => {
          if (!deletingVehicleId) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "vehicle") {
            void executeDeleteVehicle(deleteConfirm.client, deleteConfirm.vehicle);
          }
        }}
      />

      {vehicleModalClient && (
        <VehicleFormModal
          key={editingVehicle?.id ?? vehicleModalClient.id}
          client={vehicleModalClient}
          vehicle={editingVehicle}
          closing={vehicleModalClosing}
          onClose={closeVehicleModal}
          onSave={handleSaveVehicle}
        />
      )}

      {vehiclesClient && (
        <ClientVehiclesPanel
          client={vehiclesClient}
          closing={vehiclesPanelClosing}
          deletingVehicleId={deletingVehicleId}
          onAddVehicle={openAddVehicleModal}
          onClose={closeVehiclesPanel}
          onDeleteVehicle={handleDeleteVehicle}
          onEditVehicle={openEditVehicleModal}
        />
      )}

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .vehicle-panel-overlay-enter {
            animation: vehicle-panel-fade-in 220ms ease-out both;
          }

          .vehicle-panel-overlay-exit {
            animation: vehicle-panel-fade-out 180ms ease-in both;
          }

          .vehicle-panel-drawer-enter {
            animation: vehicle-panel-slide-in 240ms ease-out both;
          }

          .vehicle-panel-drawer-exit {
            animation: vehicle-panel-slide-out 180ms ease-in both;
          }

          .vehicle-modal-overlay-enter {
            animation: vehicle-modal-fade-in 220ms ease-out both;
          }

          .vehicle-modal-overlay-exit {
            animation: vehicle-modal-fade-out ${VEHICLE_MODAL_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }

          .vehicle-modal-card-enter {
            animation: vehicle-modal-card-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .vehicle-modal-card-exit {
            animation: vehicle-modal-card-exit ${VEHICLE_MODAL_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }
        }

        @keyframes vehicle-panel-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes vehicle-panel-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes vehicle-panel-slide-in {
          from {
            opacity: 0;
            transform: translateX(28px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes vehicle-panel-slide-out {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(28px);
          }
        }

        @keyframes vehicle-modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes vehicle-modal-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes vehicle-modal-card-enter {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes vehicle-modal-card-exit {
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
    </>
  );
}
