"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Smartphone } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { SettingsCollapsibleCard } from "@/components/settings/settings-collapsible-card";
import { createClient } from "@/lib/supabase/client";

type ConnectionState = "missing" | "connecting" | "open" | "close";

const ESTADO_LABEL: Record<ConnectionState, string> = {
  open: "Conectado",
  connecting: "Aguardando leitura do QR",
  close: "Desconectado",
  missing: "Não configurado",
};

// O QR da Evolution expira em torno de 40 segundos: pedimos um novo antes disso.
const QR_REFRESH_MS = 35_000;
const STATUS_POLL_MS = 4_000;

export function WhatsappCard() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ConnectionState>("missing");
  const [phone, setPhone] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  const limparTimers = useCallback(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
  }, []);

  const chamar = useCallback(
    async (action: "status" | "connect" | "disconnect") => {
      const { data, error: fnError } = await supabase.functions.invoke("whatsapp", {
        body: { action },
      });
      if (fnError) throw new Error("Não foi possível falar com o serviço de WhatsApp.");
      return data as { state: ConnectionState; phone?: string | null; qr?: string | null };
    },
    [supabase]
  );

  const atualizarStatus = useCallback(async () => {
    try {
      const data = await chamar("status");
      setState(data.state);
      setPhone(data.phone ?? null);
      if (data.state === "open") {
        setQr(null);
        limparTimers();
      }
    } catch (e) {
      setError((e as Error).message);
      limparTimers();
    }
  }, [chamar, limparTimers]);

  useEffect(() => {
    atualizarStatus().finally(() => setLoading(false));
    return limparTimers;
  }, [atualizarStatus, limparTimers]);

  const conectar = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await chamar("connect");
      setState(data.state);
      setQr(data.qr ?? null);
      if (data.state === "open") {
        setPhone(data.phone ?? null);
        return;
      }
      limparTimers();
      timers.current.push(setInterval(atualizarStatus, STATUS_POLL_MS));
      timers.current.push(
        setInterval(async () => {
          try {
            const novo = await chamar("connect");
            if (novo.state === "open") return;
            setQr(novo.qr ?? null);
          } catch {
            /* a próxima tentativa de status mostra o erro */
          }
        }, QR_REFRESH_MS)
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [atualizarStatus, chamar, limparTimers]);

  const desconectar = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await chamar("disconnect");
      limparTimers();
      setState("missing");
      setPhone(null);
      setQr(null);
      setConfirmando(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [chamar, limparTimers]);

  return (
    <SettingsCollapsibleCard
      icon={<MessageCircle className="h-5 w-5" />}
      title="WhatsApp"
      description="Conecte o número da oficina para enviar as mensagens automáticas."
    >
      {loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
            <Smartphone className="h-4 w-4 text-muted" />
            <div>
              <p className="text-sm font-semibold text-foreground">{ESTADO_LABEL[state]}</p>
              {phone && <p className="text-xs text-muted">Número {phone}</p>}
            </div>
          </div>

          {qr && state !== "open" && (
            <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-center">
              <Image
                src={qr}
                alt="QR Code para conectar o WhatsApp"
                width={264}
                height={264}
                unoptimized
                className="mx-auto h-auto w-64 max-w-full rounded-md bg-white p-2"
              />
              <p className="text-xs text-muted">
                No celular da oficina: WhatsApp → Aparelhos conectados → Conectar um aparelho.
                O código se renova sozinho enquanto esta tela estiver aberta.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex flex-wrap gap-2">
            {state === "open" ? (
              confirmando ? (
                <>
                  <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={busy}>
                    Cancelar
                  </Button>
                  <Button onClick={desconectar} loading={busy}>
                    Confirmar desconexão
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmando(true)}>
                  Desconectar
                </Button>
              )
            ) : (
              <Button onClick={conectar} loading={busy}>
                {state === "connecting" ? "Gerar novo QR Code" : "Conectar WhatsApp"}
              </Button>
            )}
            <Button variant="ghost" onClick={atualizarStatus} disabled={busy}>
              Atualizar estado
            </Button>
          </div>

          {state === "open" && (
            <p className="text-xs text-muted">
              Ao desconectar, as mensagens que ainda não saíram são canceladas.
            </p>
          )}
        </div>
      )}
    </SettingsCollapsibleCard>
  );
}
