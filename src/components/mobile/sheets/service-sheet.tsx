"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MoneyField } from "@/components/mobile/sheets/fields";
import { parseCurrencyInput } from "@/lib/utils/money";
import type { AgendaService } from "@/lib/agenda/types";

interface ServiceSheetProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  workshopId: string;
  onDone: (tone: "success" | "error", message: string) => void;
  onCreated?: (service: AgendaService) => void;
}

export function ServiceSheet({
  open,
  onClose,
  supabase,
  workshopId,
  onDone,
  onCreated,
}: ServiceSheetProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("60");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPrice("");
    setDuration("60");
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
      setError("Informe o nome do serviço.");
      return;
    }

    let priceValue = 0;
    if (price.trim()) {
      try {
        priceValue = parseCurrencyInput(price, { min: 0 });
      } catch {
        setError("Preço inválido.");
        return;
      }
    }
    const durationValue = Number(duration.trim()) || null;

    setSaving(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from("services")
        .insert({
          name: name.trim(),
          description: null,
          price: priceValue,
          duration_minutes: durationValue,
          category: "Outros",
          active: true,
          workshop_id: workshopId,
        })
        .select("id, name, price, duration_minutes, active")
        .single();

      if (insertError) throw new Error(insertError.message);

      onCreated?.({
        id: data.id,
        name: data.name,
        price: data.price,
        duration_minutes: data.duration_minutes,
        active: data.active ?? true,
      });
      onDone("success", "Serviço criado!");
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar serviço.");
      onDone("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title="Novo serviço"
      description="Adicionar ao catálogo"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Lavagem completa"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Preço" value={price} onChange={setPrice} />
          <Input
            label="Duração (min)"
            value={duration}
            onChange={(event) => setDuration(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="60"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full">
          Criar serviço
        </Button>
      </form>
    </BottomSheet>
  );
}
