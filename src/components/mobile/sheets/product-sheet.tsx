"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { MoneyField } from "@/components/mobile/sheets/fields";
import { createProductId, type ProductItem } from "@/lib/products/catalog";
import { saveSupabaseProduct } from "@/lib/products/supabase-catalog";

interface ProductSheetProps {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  workshopId: string;
  onDone: (tone: "success" | "error", message: string) => void;
}

export function ProductSheet({
  open,
  onClose,
  supabase,
  workshopId,
  onDone,
}: ProductSheetProps) {
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCost("");
    setStock("");
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
      setError("Informe o nome do produto.");
      return;
    }

    const quantity = stock.trim();
    const product: ProductItem = {
      id: createProductId(),
      name: name.trim(),
      type: "utensil",
      volumeMl: "",
      usagePerWashMl: "",
      quantity,
      durabilityWashes: "",
      totalCost: cost.trim(),
      stockRemaining: quantity,
      priceHistory: [],
    };

    setSaving(true);
    setError(null);
    try {
      await saveSupabaseProduct(supabase, workshopId, product);
      onDone("success", "Produto cadastrado!");
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar produto.");
      onDone("error", "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title="Novo produto"
      description="Adicionar ao estoque"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Pano de microfibra"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Custo" value={cost} onChange={setCost} />
          <Input
            label="Estoque (un.)"
            value={stock}
            onChange={(event) => setStock(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="0"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={saving} className="w-full">
          Cadastrar produto
        </Button>
      </form>
    </BottomSheet>
  );
}
