"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareText, RotateCcw, Send } from "lucide-react";
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

// Texto de fábrica de cada mensagem. Vive só aqui: é o que preenche a caixa quando a oficina
// ainda não salvou nada, e é para onde o botão "reverter" volta.
const EVENTOS: {
  event: WhatsappEvent;
  titulo: string;
  quando: string;
  prazo: "nenhum" | "antes" | "depois";
  padraoMinutos: number;
  padrao: string;
}[] = [
  {
    event: "agendamento_criado",
    titulo: "Agendamento criado",
    quando: "Assim que a ordem é agendada.",
    prazo: "nenhum",
    padraoMinutos: 0,
    padrao:
      "oi {{cliente}}, tudo certo! agendamos o {{veiculo}} para {{data}} às {{hora}} aqui na {{oficina}}. qualquer coisa é só chamar por aqui.",
  },
  {
    event: "agendamento_reagendado",
    titulo: "Agendamento remarcado",
    quando: "Quando a data ou a hora mudam.",
    prazo: "nenhum",
    padraoMinutos: 0,
    padrao:
      "oi {{cliente}}, remarcamos o {{veiculo}} para {{data}} às {{hora}}. se esse horário não ficar bom, me avisa que a gente ajusta.",
  },
  {
    event: "agendamento_cancelado",
    titulo: "Agendamento cancelado",
    quando: "Quando a ordem é cancelada.",
    prazo: "nenhum",
    padraoMinutos: 0,
    padrao:
      "oi {{cliente}}, cancelamos o agendamento do {{veiculo}} que estava marcado para {{data}}. quando quiser remarcar, é só falar.",
  },
  {
    event: "lembrete_vespera",
    titulo: "Lembrete antes do horário",
    quando: "Antes do horário agendado.",
    prazo: "antes",
    padraoMinutos: 1440,
    padrao:
      "oi {{cliente}}, passando pra lembrar do {{veiculo}} amanhã às {{hora}}. se precisar remarcar, me avisa que a gente resolve.",
  },
  {
    event: "pos_servico",
    titulo: "Depois do serviço",
    quando: "Depois que a ordem é finalizada.",
    prazo: "depois",
    padraoMinutos: 1440,
    padrao:
      "oi {{cliente}}, tudo certo com o {{veiculo}}? qualquer coisa que tenha ficado fora do esperado, me chama que a gente resolve.",
  },
  {
    event: "manutencao",
    titulo: "Lembrete de manutenção",
    quando: "Bastante tempo depois da última finalização.",
    prazo: "depois",
    padraoMinutos: 129600,
    padrao:
      "oi {{cliente}}, já faz um tempo desde a última passada do {{veiculo}} aqui na {{oficina}}. quer deixar ele novo de novo? é só dizer o dia.",
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

function padraoDe(event: WhatsappEvent): Flow {
  const base = EVENTOS.find((e) => e.event === event)!;
  return { event, body: base.padrao, active: false, offset_minutes: base.padraoMinutos };
}

export function WhatsappFlowsCard() {
  const supabase = useMemo(() => createClient(), []);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [flows, setFlows] = useState<Record<string, Flow>>({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState<WhatsappEvent | null>(null);
  const [testando, setTestando] = useState<WhatsappEvent | null>(null);
  const [conectado, setConectado] = useState(false);
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

    // O botão de teste só faz sentido com um número conectado.
    const { data: conexao } = await supabase
      .from("whatsapp_connections")
      .select("state")
      .eq("workshop_id", id)
      .maybeSingle();
    setConectado(conexao?.state === "open");

    const { data, error: queryError } = await supabase
      .from("whatsapp_flows")
      .select("event, body, active, offset_minutes")
      .eq("workshop_id", id)
      .eq("name", FLUXO_PADRAO);

    if (queryError) {
      setError(queryError.message);
    } else {
      // Começa com o texto de fábrica em todos e sobrescreve com o que a oficina já salvou.
      const mapa: Record<string, Flow> = {};
      EVENTOS.forEach((e) => {
        mapa[e.event] = padraoDe(e.event);
      });
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
    setFlows((atual) => {
      const anterior: Flow = atual[event] ?? padraoDe(event);
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

  // Manda a prévia (com os valores de exemplo) para o próprio número conectado.
  // Não precisa salvar antes: testa o texto que está na tela.
  const testar = async (event: WhatsappEvent) => {
    const texto = preview((flows[event] ?? padraoDe(event)).body ?? "");
    if (!texto) {
      setError("Escreva a mensagem antes de testar.");
      return;
    }

    setTestando(event);
    setError(null);
    setMessage(null);

    const { error: fnError } = await supabase.functions.invoke("whatsapp", {
      body: { action: "test", text: texto },
    });

    if (fnError) {
      let detalhe = "";
      try {
        const r = await (fnError as { context?: Response }).context?.json?.();
        if (r?.error === "aguarde") {
          detalhe = `Aguarde ${r.retryAfterSec ?? 15}s entre um teste e outro (o envio é espaçado de propósito).`;
        } else if (r?.error === "nao_conectado") {
          detalhe = "Conecte o WhatsApp da oficina antes de testar.";
        } else if (r?.error) {
          detalhe = String(r.error);
        }
      } catch {
        /* sem detalhe: cai na mensagem genérica */
      }
      setError(detalhe || "Não foi possível enviar o teste.");
    } else {
      setMessage("Mensagem de teste enviada para o número conectado.");
    }

    setTestando(null);
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
            <p className="mt-2 text-xs text-muted">
              Os textos já vêm prontos. Edite à vontade: nada é enviado enquanto a mensagem não
              estiver marcada como ativa e salva.
            </p>
          </div>

          {EVENTOS.map((e) => {
            const f = flows[e.event] ?? padraoDe(e.event);
            const body = f.body ?? "";
            const minutos = f.offset_minutes ?? e.padraoMinutos;
            const alterado = body.trim() !== e.padrao;

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
                      checked={f.active}
                      onChange={(ev) => atualizar(e.event, "active", ev.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    Ativa
                  </label>
                </div>

                <textarea
                  value={body}
                  onChange={(ev) => atualizar(e.event, "body", ev.target.value)}
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

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => salvar(e.event)}
                    loading={salvando === e.event}
                  >
                    Salvar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => testar(e.event)}
                    loading={testando === e.event}
                    disabled={!conectado}
                    title={
                      conectado
                        ? "Envia esta mensagem para o próprio número conectado"
                        : "Conecte o WhatsApp da oficina para poder testar"
                    }
                  >
                    <Send className="h-4 w-4" />
                    Enviar teste
                  </Button>
                  {alterado && (
                    <Button
                      variant="ghost"
                      onClick={() => atualizar(e.event, "body", e.padrao)}
                      title="Volta o texto original. Só vale depois de salvar."
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reverter para o original
                    </Button>
                  )}
                </div>
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
