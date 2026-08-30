"use client";

import { Car, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { createClientWithVehicles } from "@/lib/agenda/mutations";
import { emptyVehicle, type Client } from "@/types/client";
import { normalizePhone } from "@/lib/utils/format";
import { maskPhone } from "@/lib/utils/masks";

interface ClientSheetProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  workshopId: string;
  onDone: (tone: "success" | "error", message: string) => void;
  onCreated?: (client: Client) => void;
}

export function ClientSheet({
  open,
  onClose,
  supabase,
  workshopId,
  onDone,
  onCreated,
}: ClientSheetProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [addVehicle, setAddVehicle] = useState(false);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPhone("");
    setNotes("");
    setAddVehicle(false);
    setBrand("");
    setModel("");
    setPlate("");
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

    if (!name.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    try {
      normalizePhone(phone);
    } catch {
      setError("Informe um telefone válido com DDD.");
      return;
    }

    const vehicles =
      addVehicle && (brand.trim() || model.trim() || plate.trim())
        ? [
            {
              ...emptyVehicle,
              uiKey: "novo",
              brand: brand.trim(),
              model: model.trim(),
              plate: plate.trim().toUpperCase(),
            },
          ]
        : [];

    setSaving(true);
    setError(null);
    try {
      const client = await createClientWithVehicles(supabase, workshopId, {
        name,
        phone,
        notes,
        vehicles,
      });
      onCreated?.(client);
      onDone("success", "Cliente cadastrado!");
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cadastrar cliente.");
      onDone("error", "Não foi possível cadastrar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title="Novo cliente"
      description="Cadastro rápido no balcão"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome do cliente"
          autoFocus
        />
        <Input
          label="Telefone"
          value={phone}
          onChange={(event) => setPhone(maskPhone(event.target.value))}
          inputMode="tel"
          placeholder="(00) 00000-0000"
        />
        <Input
          label="Observações"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Opcional"
        />

        {addVehicle ? (
          <div className="space-y-3 rounded-xl border border-border bg-input/60 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Car size={18} weight="light" aria-hidden />
              Veículo
            </div>
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
            <Input
              label="Placa"
              value={plate}
              onChange={(event) => setPlate(event.target.value.toUpperCase())}
              placeholder="ABC1D23"
            />
            <button
              type="button"
              onClick={() => setAddVehicle(false)}
              className="text-xs font-semibold text-muted hover:text-foreground"
            >
              Remover veículo
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddVehicle(true)}
            className="tap-press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-semibold text-primary"
          >
            <Plus size={16} weight="bold" aria-hidden />
            Adicionar veículo
          </button>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full">
          Cadastrar cliente
        </Button>
      </form>
    </BottomSheet>
  );
}
