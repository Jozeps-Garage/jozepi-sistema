// Disparo da fila. Chamado pelo pg_cron (ver migration 026), a cada minuto, e só quando
// existe mensagem vencida.
//
// Não tem login de usuário: autentica por token compartilhado no cabeçalho x-dispatch-token.
// Por isso é publicada com verify_jwt = false.
//
// Secrets: WHATSAPP_GATEWAY_URL, WHATSAPP_GATEWAY_SECRET, WHATSAPP_DISPATCH_TOKEN.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callGateway, json } from "../_shared/gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCH_TOKEN = Deno.env.get("WHATSAPP_DISPATCH_TOKEN")!;

// O gateway já segura o ritmo (8 s + variação por número). Lote pequeno de propósito:
// o que não couber nesta rodada sai na próxima, um minuto depois.
const LOTE = 3;
const MAX_TENTATIVAS = 5;

function tempoIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

Deno.serve(async (req) => {
  const token = req.headers.get("x-dispatch-token") ?? "";
  if (!DISPATCH_TOKEN || !tempoIgual(token, DISPATCH_TOKEN)) {
    return json(401, { error: "nao_autorizado" });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: fila, error } = await db.rpc("whatsapp_claim_batch", { p_limit: LOTE });
  if (error) {
    console.error("falha ao pegar lote:", error.message);
    return json(500, { error: "fila_indisponivel" });
  }
  if (!fila?.length) return json(200, { enviados: 0, fila: 0 });

  let enviados = 0;
  for (const msg of fila) {
    try {
      const r = await callGateway("POST", `/v1/tenants/${msg.workshop_id}/messages`, {
        to: msg.phone,
        text: msg.body,
        // A própria linha da fila é a chave: reenvio nunca vira mensagem repetida.
        idempotencyKey: msg.id,
      });
      await concluir(db, msg, r);
      if (r.status === 202) enviados++;
    } catch (e) {
      // Rede caiu no meio: não dá pra saber se saiu. Volta pra fila com espera.
      console.error("falha de rede no envio:", (e as Error).message);
      await db.rpc("whatsapp_settle", {
        p_id: msg.id,
        p_status: msg.attempts >= MAX_TENTATIVAS ? "falhou" : "pendente",
        p_error: "rede",
        p_retry_at: emMinutos(10),
      });
    }
  }

  return json(200, { enviados, lote: fila.length });
});

function emMinutos(m: number): string {
  return new Date(Date.now() + m * 60_000).toISOString();
}

async function concluir(db: any, msg: any, r: { status: number; data: any }) {
  const erro = r.data?.error ?? null;

  // 202 saiu · 422 número não tem WhatsApp (desistir) · 504 pode ter saído (não reenviar)
  if (r.status === 202) {
    return db.rpc("whatsapp_settle", {
      p_id: msg.id,
      p_status: "enviado",
      p_message_id: r.data?.id ?? null,
    });
  }
  if (r.status === 422) {
    return db.rpc("whatsapp_settle", { p_id: msg.id, p_status: "falhou", p_error: erro });
  }
  if (r.status === 504) {
    return db.rpc("whatsapp_settle", { p_id: msg.id, p_status: "incerto", p_error: erro });
  }

  // 429 o gateway pediu pra esperar · 409 desconectado · 502 gateway/Evolution fora:
  // tudo isso é temporário, então volta pra fila até esgotar as tentativas.
  const espera = r.status === 429 ? Number(r.data?.retryAfterSec ?? 60) / 60 : msg.attempts * 10 + 10;
  const desistiu = msg.attempts >= MAX_TENTATIVAS && r.status !== 429;
  return db.rpc("whatsapp_settle", {
    p_id: msg.id,
    p_status: desistiu ? "falhou" : "pendente",
    p_error: erro ?? `http_${r.status}`,
    p_retry_at: emMinutos(Math.max(1, Math.ceil(espera))),
  });
}
