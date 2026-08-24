"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCollapsibleCard } from "@/components/settings/settings-collapsible-card";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { formatDate } from "@/lib/utils/format";
import {
  buildInviteUrl,
  getInviteDisplayStatus,
  getInviteStatusLabel,
  isMissingInvitesError,
  type InviteStatus,
  type WorkshopInvite,
} from "@/lib/invites";

function statusClassName(status: InviteStatus) {
  if (status === "pendente") return "bg-premium/10 text-premium";
  if (status === "usado") return "bg-success/10 text-success";
  if (status === "revogado") return "bg-danger/10 text-danger";
  return "bg-muted/15 text-muted";
}

export function InviteUsersCard() {
  const supabase = useMemo(() => createClient(), []);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [invites, setInvites] = useState<WorkshopInvite[]>([]);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { userId: currentUserId, workshopId: currentWorkshopId, error: profileError } =
      await fetchOwnWorkshop(supabase);

    if (profileError || !currentUserId || !currentWorkshopId) {
      setError(profileError?.message ?? "Oficina não encontrada.");
      setLoading(false);
      return;
    }

    setUserId(currentUserId);
    setWorkshopId(currentWorkshopId);

    const { data, error: invitesError } = await supabase
      .from("invites")
      .select(
        "id, token, workshop_id, created_by, email, status, expires_at, used_at, used_by, created_at"
      )
      .eq("workshop_id", currentWorkshopId)
      .order("created_at", { ascending: false });

    if (invitesError) {
      if (isMissingInvitesError(invitesError)) {
        setError(
          "A tabela invites ainda não existe no Supabase. Aplique a migration 024."
        );
      } else {
        setError(invitesError.message);
      }
      setLoading(false);
      return;
    }

    setInvites((data as WorkshopInvite[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void Promise.resolve().then(loadInvites);
  }, [loadInvites]);

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar o link. Copie manualmente.");
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setGeneratedUrl(null);

    if (!workshopId || !userId) {
      setError("Oficina não encontrada.");
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Informe um e-mail válido ou deixe o campo em branco.");
      return;
    }

    setSaving(true);

    const { data, error: insertError } = await supabase
      .from("invites")
      .insert({
        workshop_id: workshopId,
        created_by: userId,
        email: trimmedEmail || null,
      })
      .select(
        "id, token, workshop_id, created_by, email, status, expires_at, used_at, used_by, created_at"
      )
      .single();

    setSaving(false);

    if (insertError || !data) {
      if (isMissingInvitesError(insertError)) {
        setError(
          "A tabela invites ainda não existe no Supabase. Aplique a migration 024."
        );
      } else {
        setError(insertError?.message ?? "Não foi possível gerar o convite.");
      }
      return;
    }

    const invite = data as WorkshopInvite;
    const url = buildInviteUrl(invite.token);
    setInvites((current) => [invite, ...current]);
    setGeneratedUrl(url);
    setEmail("");
    setMessage("Link de convite gerado. Ele vale por 7 dias.");
    await copyUrl(url);
  }

  async function handleRevoke(inviteId: string) {
    setError(null);
    setMessage(null);
    setRevokingId(inviteId);

    const { error: updateError } = await supabase
      .from("invites")
      .update({ status: "revogado" })
      .eq("id", inviteId)
      .eq("status", "pendente");

    setRevokingId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setInvites((current) =>
      current.map((invite) =>
        invite.id === inviteId ? { ...invite, status: "revogado" } : invite
      )
    );
    setMessage("Convite revogado.");
  }

  return (
    <SettingsCollapsibleCard
      icon={<UserPlus className="h-5 w-5" />}
      title="Convidar usuário"
      description="Gere um link para outra pessoa criar conta já vinculada a esta oficina. Sem convite, o cadastro fica fechado."
    >
      <form onSubmit={handleCreate} className="space-y-4">
        <Input
          label="E-mail do convidado (opcional)"
          type="email"
          placeholder="Deixe em branco para qualquer e-mail"
          value={email}
          disabled={loading || saving}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="off"
        />

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="success"
            loading={saving}
            disabled={loading || saving}
            className="w-full sm:w-auto"
          >
            Gerar link de convite
          </Button>
        </div>
      </form>

      {generatedUrl && (
        <div className="mt-4 rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Link gerado
          </p>
          <p className="mt-1 break-all text-sm font-medium text-foreground">
            {generatedUrl}
          </p>
          <button
            type="button"
            onClick={() => void copyUrl(generatedUrl)}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:text-primary-hover"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copiar link
              </>
            )}
          </button>
        </div>
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

      <div className="mt-5 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Convites desta oficina
        </p>
        {loading ? (
          <p className="text-sm text-muted">Carregando convites...</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted">Nenhum convite gerado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((invite) => {
              const displayStatus = getInviteDisplayStatus(invite);
              const url = buildInviteUrl(invite.token);
              const canUse = displayStatus === "pendente";

              return (
                <li
                  key={invite.id}
                  className="rounded-lg border border-border bg-background px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {invite.email ?? "Qualquer e-mail"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        Expira em {formatDate(invite.expires_at)}
                        {invite.used_at ? ` · usado em ${formatDate(invite.used_at)}` : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusClassName(displayStatus)}`}
                    >
                      {getInviteStatusLabel(displayStatus)}
                    </span>
                  </div>
                  {canUse && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void copyUrl(url)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:text-primary-hover"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar link
                      </button>
                      <button
                        type="button"
                        disabled={revokingId === invite.id}
                        onClick={() => void handleRevoke(invite.id)}
                        className="text-xs font-medium text-danger transition-colors hover:text-danger/80 disabled:opacity-50"
                      >
                        Revogar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsCollapsibleCard>
  );
}
