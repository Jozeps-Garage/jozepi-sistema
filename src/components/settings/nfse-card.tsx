"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCollapsibleCard } from "@/components/settings/settings-collapsible-card";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";

function isMissingNfseColumn(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("nfse_");
}

const MIGRATION_HINT =
  "As colunas de nota fiscal ainda não existem no Supabase. Aplique a migration 046.";

/**
 * O que vai em toda NFS-e e não muda de nota para nota. A chave da API não
 * está aqui de propósito: ela vive em NOTAAS_API_KEY, no servidor, e nunca
 * passa pelo navegador.
 */
export function NfseCard() {
  const supabase = useMemo(() => createClient(), []);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [serviceCode, setServiceCode] = useState("");
  const [issRate, setIssRate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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

    const { data, error: workshopError } = await supabase
      .from("workshops")
      .select("nfse_service_code, nfse_iss_rate, nfse_service_description")
      .eq("id", currentWorkshopId)
      .single();

    if (workshopError) {
      setError(isMissingNfseColumn(workshopError) ? MIGRATION_HINT : workshopError.message);
      setLoading(false);
      return;
    }

    setServiceCode(data?.nfse_service_code ?? "");
    setIssRate(
      data?.nfse_iss_rate === null || data?.nfse_iss_rate === undefined
        ? ""
        : String(data.nfse_iss_rate).replace(".", ",")
    );
    setDescription(data?.nfse_service_description ?? "");
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    const code = serviceCode.replace(/\D/g, "");
    if (code && code.length !== 6) {
      setError("O código de serviço da LC 116 tem 6 dígitos.");
      return;
    }

    const rateText = issRate.trim().replace(",", ".");
    const rate = rateText === "" ? null : Number(rateText);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      setError("A alíquota do ISS vai de 0 a 100.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase
      .from("workshops")
      .update({
        nfse_service_code: code || null,
        nfse_iss_rate: rate,
        nfse_service_description: description.trim() || null,
      })
      .eq("id", workshopId);
    setSaving(false);

    if (updateError) {
      setError(isMissingNfseColumn(updateError) ? MIGRATION_HINT : updateError.message);
      return;
    }

    setServiceCode(code);
    setMessage("Dados fiscais salvos.");
  }

  return (
    <SettingsCollapsibleCard
      icon={<FileText className="h-5 w-5" />}
      title="Nota fiscal (NFS-e)"
      description="Código do serviço e alíquota do ISS usados em toda nota emitida."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Input
          label="Alíquota do ISS (%)"
          value={issRate}
          disabled={loading}
          onChange={(event) => setIssRate(event.target.value)}
          placeholder="2,00"
          inputMode="decimal"
        />

        <Input
          label="Código do serviço — LC 116 (opcional)"
          value={serviceCode}
          disabled={loading}
          onChange={(event) => setServiceCode(event.target.value)}
          placeholder="140101"
          inputMode="numeric"
          maxLength={6}
        />

        <Input
          label="Descrição padrão do serviço (opcional)"
          value={description}
          disabled={loading}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Serviço de estética automotiva"
        />

        <p className="rounded-lg border border-border bg-background px-4 py-3 text-xs leading-relaxed text-muted">
          Em branco, o código do serviço usa o padrão cadastrado no projeto da
          Notaas. A alíquota é obrigatória: sem ela a emissão é recusada antes
          mesmo de sair daqui.
        </p>

        {error && <p className="text-sm text-danger">{error}</p>}
        {message && <p className="text-sm text-success">{message}</p>}

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={loading}>
            Salvar
          </Button>
        </div>
      </form>
    </SettingsCollapsibleCard>
  );
}
