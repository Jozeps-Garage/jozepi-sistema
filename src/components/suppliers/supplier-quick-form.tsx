"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import {
  formatCnpj,
  isValidCnpj,
  lookupCnpj,
  onlyCnpjDigits,
} from "@/lib/cnpj/lookup";
import { saveSupplierRow } from "@/lib/suppliers/save";
import { normalizeOptionalPhone } from "@/lib/utils/format";

/** O que volta para quem abriu: o bastante para já deixar escolhido. */
export interface QuickSupplier {
  id: string;
  name: string;
  trade_name: string | null;
}

interface SupplierQuickFormProps {
  open: boolean;
  supabase: SupabaseClient;
  workshopId: string | null;
  onClose: () => void;
  onCreated: (supplier: QuickSupplier) => void;
}

const ICON_WEIGHT = "light" as const;

const emptyForm = {
  document: "",
  name: "",
  tradeName: "",
  phone: "",
};

/**
 * Cadastro de fornecedor sem sair da tela em que ele faz falta. Só os campos
 * que o CNPJ já traz; o resto (endereço, contato, observações) continua em
 * Produtos → Fornecedores.
 */
export function SupplierQuickForm({
  open,
  supabase,
  workshopId,
  onClose,
  onCreated,
}: SupplierQuickFormProps) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjMessage, setCnpjMessage] = useState<{
    tone: "error" | "warning" | "success";
    text: string;
  } | null>(null);
  /** Último CNPJ consultado: não repete a busca a cada tecla depois do 14º dígito. */
  const [lastLookup, setLastLookup] = useState("");

  useBodyScrollLock(open);

  if (!open || typeof document === "undefined") return null;

  function update(patch: Partial<typeof emptyForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function close() {
    if (saving) return;
    setForm(emptyForm);
    setError(null);
    setCnpjMessage(null);
    setLastLookup("");
    onClose();
  }

  async function handleLookup(raw?: string) {
    const value = raw ?? form.document;
    setLastLookup(onlyCnpjDigits(value));
    setCnpjMessage(null);
    setCnpjLoading(true);
    try {
      const data = await lookupCnpj(value);
      // O que já foi digitado manda: a consulta preenche o que está vazio.
      setForm((prev) => ({
        document: data.cnpj,
        name: prev.name.trim() || data.razaoSocial,
        tradeName: prev.tradeName.trim() || data.nomeFantasia,
        phone: prev.phone.trim() || data.telefone,
      }));
      setCnpjMessage(
        data.ativa
          ? { tone: "success", text: `${data.razaoSocial} · dados preenchidos.` }
          : {
              tone: "warning",
              text: `${data.razaoSocial} · situação ${data.situacao.toLowerCase()} na Receita.`,
            }
      );
    } catch (err) {
      setCnpjMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Não foi possível consultar.",
      });
    } finally {
      setCnpjLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (!form.name.trim()) {
      setError("Informe a razão social do fornecedor.");
      return;
    }

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    let phone: string | null = null;
    try {
      phone = normalizeOptionalPhone(form.phone);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Informe um telefone válido com DDD."
      );
      return;
    }

    setSaving(true);
    setError(null);

    const now = new Date().toISOString();
    const result = await saveSupplierRow(supabase, workshopId, {
      workshop_id: workshopId,
      name: form.name.trim(),
      trade_name: form.tradeName.trim() || null,
      document: form.document.trim() || null,
      phone,
      category: "Outros",
      updated_at: now,
    });

    setSaving(false);

    if (result.error || !result.data) {
      setError(
        result.error?.message ?? "Não foi possível salvar o fornecedor no Supabase."
      );
      return;
    }

    const row = result.data as unknown as Record<string, unknown>;
    onCreated({
      id: String(row.id),
      name: String(row.name),
      trade_name: typeof row.trade_name === "string" ? row.trade_name : null,
    });
    setForm(emptyForm);
    setCnpjMessage(null);
    setLastLookup("");
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={close}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-quick-form-title"
        autoComplete="off"
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="supplier-quick-form-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              Novo fornecedor
            </h2>
            <p className="mt-1 text-sm text-muted">
              Depois de salvar ele já fica escolhido na despesa.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
            aria-label="Fechar"
          >
            <X size={16} weight={ICON_WEIGHT} aria-hidden />
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input
                label="CNPJ (opcional)"
                value={form.document}
                onChange={(event) => {
                  const typed = event.target.value;
                  const digits = onlyCnpjDigits(typed);
                  setCnpjMessage(null);
                  update({ document: typed });

                  // Completou os 14 e os dígitos batem: busca sem esperar clique.
                  if (
                    digits.length === 14 &&
                    digits !== lastLookup &&
                    isValidCnpj(digits)
                  ) {
                    update({ document: formatCnpj(digits) });
                    void handleLookup(digits);
                  } else if (digits.length < 14) {
                    setLastLookup("");
                  }
                }}
                onBlur={(event) => update({ document: formatCnpj(event.target.value) })}
                placeholder="00.000.000/0001-00"
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                loading={cnpjLoading}
                disabled={!form.document.trim()}
                onClick={() => void handleLookup()}
                className="sm:w-auto"
              >
                <MagnifyingGlass size={16} weight={ICON_WEIGHT} aria-hidden />
                Buscar
              </Button>
            </div>
            <p
              className={`mt-2 text-xs font-medium ${
                cnpjMessage
                  ? cnpjMessage.tone === "error"
                    ? "text-danger"
                    : cnpjMessage.tone === "warning"
                      ? "text-warning"
                      : "text-success"
                  : "text-muted"
              }`}
            >
              {cnpjMessage?.text ??
                "Digite o CNPJ e os dados da empresa vêm sozinhos."}
            </p>
          </div>

          <Input
            label="Razão social"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Distribuidora Auto Clean LTDA"
          />
          <Input
            label="Nome fantasia (opcional)"
            value={form.tradeName}
            onChange={(event) => update({ tradeName: event.target.value })}
            placeholder="Auto Clean"
          />
          <Input
            label="Telefone (opcional)"
            value={form.phone}
            onChange={(event) => update({ phone: event.target.value })}
            placeholder="(00) 00000-0000"
          />
        </div>

        <p className="mt-4 text-xs text-muted">
          Endereço, contato e observações você completa em Produtos →
          Fornecedores.
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button type="submit" loading={saving} className="w-full sm:w-auto">
            Cadastrar fornecedor
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
