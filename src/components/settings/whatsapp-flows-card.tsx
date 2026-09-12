"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCollapsibleCard } from "@/components/settings/settings-collapsible-card";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";

// O banco aceita vários fluxos por evento (com condição, prioridade e cooldown).
// Esta tela edita o fluxo "padrão" de cada evento, que é o que a oficina usa hoje.
const FLUXO_PADRAO = "padrão";

type WhatsappEvent =
  | "agendamento_criado"
  | "agendamento_reagendado"
  | "agendamento_cancelado"
  | "lembrete_vespera"
  | "pos_servico"
  | "manutencao";

type Flow = {
  event: WhatsappEvent;
  body: string;
  active: boolean;
  offset_minutes: number;
};

const EVENTOS: {
  event: WhatsappEvent;
  titulo: string;
  quando: string;
  prazo: "nenhum" | "antes" | "depois";
  padraoMinutos: number;
  exemplo: string;
}[] = [
  {
    event: "agendamento_criado",
    titulo: "Agendamento criado",
    quando: "Assim que a ordem é agendada.",
    prazo: "nenhum",
    padraoMinutos: 0,
    exemplo: "oi {{cliente}}, agendamos o {{veiculo}} para {{data}} às {{hora}}. qualquer coisa é só chamar aqui.",
  },
  {
    event: "agendamento_reagendado",
    titulo: "Agendamento remarcado",
    quando: "Quando a data ou a hora mudam.",
    prazo: "nenhum",
    padraoMinutos: 0,
    exemplo: "oi {{cliente}}, remarcamos o {{veiculo}} para {{data}} às {{hora}}.",
  },
  {
    event: "agendamento_cancelado",
    titulo: "Agendamento cancelado",
    quando: "Quando a ordem é cancelada.",
    prazo: "nenhum",
    padraoMinutos: 0,
    exemplo: "oi {{cliente}}, cancelamos o agendamento do {{veiculo}}. quando quiser remarcar, é só falar.",
  },
  {
    event: "lembrete_vespera",
    titulo: "Lembrete antes do horário",
    quando: "Antes do horário agendado.",
    prazo: "antes",
    padraoMinutos: 1440,
    exemplo: "oi {{cliente}}, passando pra lembrar do {{veiculo}} amanhã às {{hora}}.",
  },
  {
    event: "pos_servico",
    titulo: "Depois do serviço",
    quando: "Depois que a ordem é finalizada.",
    prazo: "depois",
    padraoMinutos: 1440,
    exemplo: "oi {{cliente}}, tudo certo com o {{veiculo}}? qualquer coisa a gente resolve.",
  },
  {
    event: "manutencao",
    titulo: "Lembrete de manutenção",
    quando: "Bastante tempo depois da última finalização.",
    prazo: "depois",
    padraoMinutos: 129600,
    exemplo: "oi {{cliente}}, já faz um tempo desde a última limpeza do {{veiculo}}. quer agendar?",
  },
];

const VARIAVEIS = ["cliente", "veiculo", "placa", "servico", "data", "hora", "oficina"];

const EXEMPLO_VALORES: Record<string, string> = {
  cliente: "João",
  veiculo: "Honda Civic",
  placa: "ABC1D23",
  servico: "Polimento",
  data: "14/03",
  hora: "09:00",
  oficina: "Oficina",
};

function preview(body: string): string {
  return body
    .replace(/\{\{([a-z_]+)\}\}/g, (_, chave: string) => EXEMPLO_VALORES[chave] ?? "")
    .trim();
}

function emLinguagemHumana(minutos: number): string {
  if (minutos % 1440 === 0) return `${minutos / 1440} dia(s)`;
  if (minutos % 60 === 0) return `${minutos / 60} hora(s)`;
  return `${minutos} minuto(s)`;
}

export function WhatsappFlowsCard() {
  const supabase = useMemo(() => createClient(), []);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [flows, setFlows] = useState<Record<string, Flow>>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState<WhatsappEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { workshopId: id, error: profileError } = await fetchOwnWorkshop(supabase);
    if (profileError || !id) {
      setError(profileError?.message ?? "Oficina não encontrada.");
      setLoading(false);
      return;
    }
    setWorkshopId(id);

    const { data, error: queryError } = await supabase
      .from("whatsapp_flows")
      .select("event, body, active, offset_minutes")
      .eq("workshop_id", id)
      .eq("name", FLUXO_PADRAO);

    if (queryError) {
      setError(queryError.message);
    } else {
      const mapa: Record<string, Flow> = {};
      (data ?? []).forEach((f) => {
        mapa[f.event] = f as Flow;
      });
      setFlows(mapa);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const atualizar = (
    event: WhatsappEvent,
    campo: keyof Flow,
    valor: string | boolean | number
  ) => {
    const base = EVENTOS.find((e) => e.event === event)!;
    setFlows((atual) => {
      const anterior: Flow = atual[event] ?? {
        event,
        body: "",
        active: false,
        offset_minutes: base.padraoMinutos,
      };
      return { ...atual, [event]: { ...anterior, [campo]: valor } };
    });
  };

  const salvar = async (event: WhatsappEvent) => {
    if (!workshopId) return;
    const f = flows[event];
    if (!f?.body?.trim()) {
      setError("Escreva a mensagem antes de salvar.");
      return;
    }

    setSalvando(event);
    setError(null);
    setMessage(null);

    const { error: upsertError } = await supabase.from("whatsapp_flows").upsert(
      {
        workshop_id: workshopId,
        event,
        name: FLUXO_PADRAO,
        body: f.body.trim(),
        active: f.active,
        offset_minutes: f.offset_minutes,
      },
      { onConflict: "workshop_id,event,name" }
    );

    if (upsertError) setError(upsertError.message);
    else setMessage("Mensagem salva.");
    setSalvando(null);
  };

  return (
    <SettingsCollapsibleCard
      icon={<MessageSquareText className="h-5 w-5" />}
      title="Mensagens automáticas"
      description="O que o WhatsApp da oficina envia, e quando. Só as ativas são enviadas."
    >
      {loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Variáveis disponíveis
            </p>
            <div className="flex flex-wrap gap-2">
              {VARIAVEIS.map((v) => (
                <code key={v} className="rounded bg-card px-2 py-1 text-xs text-foreground">
                  {`{{${v}}}`}
                </code>
              ))}
            </div>
          </div>

          {EVENTOS.map((e) => {
            const f = flows[e.event];
            const body = f?.body ?? "";
            const minutos = f?.offset_minutes ?? e.padraoMinutos;

            return (
              <div key={e.event} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{e.titulo}</p>
                    <p className="text-xs text-muted">{e.quando}</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={f?.active ?? false}
                      onChange={(ev) => atualizar(e.event, "active", ev.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Ativa
                  </label>
                </div>

                <textarea
                  value={body}
                  onChange={(ev) => atualizar(e.event, "body", ev.target.value)}
                  placeholder={e.exemplo}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />

                {e.prazo !== "nenhum" && (
                  <div className="flex flex-wrap items-end gap-3">
                    <Input
                      label={e.prazo === "antes" ? "Minutos antes do horário" : "Minutos depois de finalizar"}
                      type="number"
                      min={0}
                      max={525600}
                      value={minutos}
                      onChange={(ev) =>
                        atualizar(e.event, "offset_minutes", Number(ev.target.value) || 0)
                      }
                      className="w-48"
                    />
                    <p className="pb-3 text-xs text-muted">= {emLinguagemHumana(minutos)}</p>
                  </div>
                )}

                {body.trim() && (
                  <div className="rounded-md bg-background px-3 py-2">
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted">Prévia</p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{preview(body)}</p>
                  </div>
                )}

                <Button
                  variant="secondary"
                  onClick={() => salvar(e.event)}
                  loading={salvando === e.event}
                >
                  Salvar
                </Button>
              </div>
            );
          })}

          {error && <p className="text-sm text-danger">{error}</p>}
          {message && <p className="text-sm text-success">{message}</p>}

          <p className="text-xs text-muted">
            Nada é enviado para cliente marcado como &quot;não receber WhatsApp&quot;, nem fora da
            janela de horário da oficina. Mensagens para o mesmo cliente são espaçadas
            automaticamente.
          </p>
        </div>
      )}
    </SettingsCollapsibleCard>
  );
}
