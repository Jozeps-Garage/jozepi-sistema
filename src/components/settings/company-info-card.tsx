"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCollapsibleCard } from "@/components/settings/settings-collapsible-card";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { isCnpjComplete, maskCnpj, maskPhone } from "@/lib/utils/masks";
import {
  deleteWorkshopLogoByUrl,
  uploadWorkshopLogo,
  validateLogoFile,
} from "@/lib/supabase/workshop-logo";

interface CompanyInfo {
  name: string;
  document: string;
  phone: string;
  address: string;
}

const EMPTY_COMPANY_INFO: CompanyInfo = {
  name: "",
  document: "",
  phone: "",
  address: "",
};

export function CompanyInfoCard() {
  const supabase = useMemo(() => createClient(), []);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyInfo>(EMPTY_COMPANY_INFO);
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const loadCompanyInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const { workshopId: currentWorkshopId, error: profileError } =
      await fetchOwnWorkshop(supabase);

    if (profileError || !currentWorkshopId) {
      setError(profileError?.message ?? "Oficina não encontrada.");
      setLoading(false);
      return;
    }

    setWorkshopId(currentWorkshopId);

    const { data: workshop, error: workshopError } = await supabase
      .from("workshops")
      .select("name, document, phone, address, logo_url")
      .eq("id", currentWorkshopId)
      .single();

    if (workshopError) {
      setError(workshopError.message);
      setLoading(false);
      return;
    }

    setForm({
      name: workshop?.name ?? "",
      document: workshop?.document ? maskCnpj(workshop.document) : "",
      phone: workshop?.phone ?? "",
      address: workshop?.address ?? "",
    });
    setSavedLogoUrl(workshop?.logo_url ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void Promise.resolve().then(loadCompanyInfo);
  }, [loadCompanyInfo]);

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  function handleLogoChange(file?: File) {
    if (!file) return;

    const validation = validateLogoFile(file);
    if (validation) {
      setLogoError(validation);
      return;
    }

    setLogoError(null);
    setRemoveLogo(false);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function handleRemoveLogo() {
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(true);
    setLogoError(null);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLogoError(null);

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    if (!form.name.trim()) {
      setError("Informe o nome da empresa.");
      return;
    }

    if (form.document.trim() && !isCnpjComplete(form.document)) {
      setError("CNPJ inválido. Informe os 14 dígitos.");
      return;
    }

    setSaving(true);

    try {
      let logoUrl = removeLogo ? null : savedLogoUrl;

      if (logoFile) {
        logoUrl = await uploadWorkshopLogo(supabase, workshopId, logoFile);
      }

      const { error: updateError } = await supabase
        .from("workshops")
        .update({
          name: form.name.trim(),
          document: form.document.trim() ? form.document.trim() : null,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          logo_url: logoUrl,
        })
        .eq("id", workshopId);

      if (updateError) throw updateError;

      if ((logoFile || removeLogo) && savedLogoUrl && savedLogoUrl !== logoUrl) {
        await deleteWorkshopLogoByUrl(supabase, savedLogoUrl).catch(() => {});
      }

      setSavedLogoUrl(logoUrl);
      setLogoFile(null);
      setLogoPreview(null);
      setRemoveLogo(false);
      setMessage("Dados da empresa salvos com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar os dados da empresa.");
    } finally {
      setSaving(false);
    }
  }

  const displayedLogo = logoPreview ?? (!removeLogo ? savedLogoUrl : null);

  return (
    <SettingsCollapsibleCard
      icon={<Building2 className="h-5 w-5" />}
      title="Dados da empresa"
      description="Usados no cabeçalho dos comprovantes em PDF gerados em Relatórios."
    >
      <form onSubmit={handleSave}>
      <div className="flex items-center gap-4 rounded-lg border border-border bg-background px-4 py-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
          {displayedLogo ? (
            <Image
              src={displayedLogo}
              alt="Logo da empresa"
              fill
              sizes="64px"
              className="object-contain p-1.5"
              unoptimized
            />
          ) : (
            <Building2 className="h-6 w-6 text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Logo da empresa</p>
          <p className="mt-0.5 text-xs text-muted">JPG, PNG ou SVG, até 2MB.</p>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:text-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImageUp className="h-3.5 w-3.5" />
              {displayedLogo ? "Alterar logo" : "Enviar logo"}
            </button>
            {displayedLogo && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-danger transition-colors hover:text-danger/80"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remover
              </button>
            )}
          </div>
          {logoError && <p className="mt-1.5 text-xs font-medium text-danger">{logoError}</p>}
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            handleLogoChange(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome da empresa"
          value={form.name}
          disabled={loading}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
        />
        <Input
          label="CNPJ / Documento"
          placeholder="00.000.000/0000-00"
          value={form.document}
          disabled={loading}
          inputMode="numeric"
          onChange={(event) =>
            setForm((prev) => ({ ...prev, document: maskCnpj(event.target.value) }))
          }
        />
        <Input
          label="Telefone"
          placeholder="(00) 00000-0000"
          value={form.phone}
          disabled={loading}
          inputMode="numeric"
          onChange={(event) =>
            setForm((prev) => ({ ...prev, phone: maskPhone(event.target.value) }))
          }
        />
        <Input
          label="Endereço"
          placeholder="Rua, número, bairro, cidade"
          value={form.address}
          disabled={loading}
          onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
        />
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 rounded-lg border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          {message}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <Button
          type="submit"
          variant="success"
          loading={saving}
          disabled={loading || saving}
          className="w-full sm:w-auto"
        >
          Salvar dados da empresa
        </Button>
      </div>
      </form>
    </SettingsCollapsibleCard>
  );
}
