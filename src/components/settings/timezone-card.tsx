"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { SettingsCollapsibleCard } from "@/components/settings/settings-collapsible-card";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import {
  DEFAULT_TIME_ZONE,
  formatUtcOffset,
  formatZonedDateTime,
  getDeviceTimeZone,
  getTimezoneDropdownOptions,
  getTimezoneRegion,
  isMissingTimezoneError,
  resolveTimeZone,
} from "@/lib/timezone";

export function TimezoneCard() {
  const supabase = useMemo(() => createClient(), []);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTimezone = useCallback(async () => {
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
      .select("timezone")
      .eq("id", currentWorkshopId)
      .single();

    if (workshopError) {
      if (isMissingTimezoneError(workshopError)) {
        setTimeZone(DEFAULT_TIME_ZONE);
        setError(
          "A coluna timezone ainda não existe no Supabase. Aplique a migration 023."
        );
      } else {
        setError(workshopError.message);
      }
      setLoading(false);
      return;
    }

    setTimeZone(resolveTimeZone(workshop?.timezone));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void Promise.resolve().then(loadTimezone);
  }, [loadTimezone]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    const nextTimeZone = resolveTimeZone(timeZone);
    setSaving(true);

    const { error: updateError } = await supabase
      .from("workshops")
      .update({ timezone: nextTimeZone })
      .eq("id", workshopId);

    setSaving(false);

    if (updateError) {
      if (isMissingTimezoneError(updateError)) {
        setError(
          "A coluna timezone ainda não existe no Supabase. Aplique a migration 023."
        );
      } else {
        setError(updateError.message);
      }
      return;
    }

    setTimeZone(nextTimeZone);
    setMessage("Região e horário salvos com sucesso.");
  }

  const region = getTimezoneRegion(timeZone);
  const offset = formatUtcOffset(timeZone, now);
  const currentTimeLabel = formatZonedDateTime(now, timeZone);
  const deviceTimeZone = getDeviceTimeZone();

  return (
    <SettingsCollapsibleCard
      icon={<Globe className="h-5 w-5" />}
      title="Horário e região"
      description="Define o fuso usado na agenda, no dashboard e nos comprovantes."
    >
      <form onSubmit={handleSave}>
        <Dropdown
          label="Região / fuso horário"
          value={timeZone}
          disabled={loading}
          searchable
          searchPlaceholder="Buscar cidade ou estado..."
          options={getTimezoneDropdownOptions(timeZone)}
          onChange={setTimeZone}
        />

        <div className="mt-4 rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Horário atual nesta região
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {currentTimeLabel}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {region.label}
            {offset ? ` · ${offset}` : ""}
          </p>
        </div>

        {deviceTimeZone !== timeZone && (
          <button
            type="button"
            disabled={loading}
            onClick={() => setTimeZone(deviceTimeZone)}
            className="mt-3 text-xs font-semibold text-primary transition-colors hover:text-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Usar fuso do dispositivo ({getTimezoneRegion(deviceTimeZone).label})
          </button>
        )}

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
            Salvar região
          </Button>
        </div>
      </form>
    </SettingsCollapsibleCard>
  );
}
