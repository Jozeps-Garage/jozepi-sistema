// Conexão do WhatsApp da oficina: QR, estado e desconectar.
//
// Chamada pela tela com o login do usuário (supabase.functions.invoke já manda o token).
// A função descobre a oficina pelo perfil de quem chamou: a tela NUNCA escolhe a oficina,
// então ninguém consegue pedir o QR de outra.
//
// Secrets: WHATSAPP_GATEWAY_URL, WHATSAPP_GATEWAY_SECRET.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callGateway, json } from "../_shared/gateway.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "metodo_nao_permitido" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "sem_login" });

  // Cliente com o token de quem chamou: o RLS continua valendo pra esta leitura.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: auth, error: authError } = await asUser.auth.getUser();
  if (authError || !auth?.user) return json(401, { error: "sem_login" });

  const { data: profile } = await asUser
    .from("profiles")
    .select("workshop_id")
    .eq("id", auth.user.id)
    .single();

  const workshopId = profile?.workshop_id;
  if (!workshopId) return json(403, { error: "sem_oficina" });

  let acao = "";
  try {
    acao = (await req.json())?.action ?? "";
  } catch {
    return json(400, { error: "json_invalido" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const base = `/v1/tenants/${workshopId}`;

  try {
    if (acao === "status") {
      const r = await callGateway("GET", `${base}/status`);
      if (r.status === 200) await salvarEstado(admin, workshopId, r.data);
      return json(r.status === 200 ? 200 : 502, r.data ?? { error: "gateway_erro" });
    }

    if (acao === "connect") {
      const r = await callGateway("POST", `${base}/connect`);
      if (r.status !== 200) return json(502, { error: "gateway_erro" });
      // A linha em whatsapp_connections é o "esta oficina ativou o WhatsApp": sem ela,
      // os gatilhos do banco não enfileiram nada.
      await salvarEstado(admin, workshopId, r.data);
      return json(200, r.data);
    }

    if (acao === "disconnect") {
      const r = await callGateway("POST", `${base}/disconnect`);
      if (r.status !== 200) return json(502, { error: "gateway_erro" });
      // Some a linha: desativar o WhatsApp para de enfileirar mensagem nova.
      await admin.from("whatsapp_connections").delete().eq("workshop_id", workshopId);
      await admin
        .from("whatsapp_outbox")
        .update({ status: "cancelado", last_error: "whatsapp desconectado" })
        .eq("workshop_id", workshopId)
        .eq("status", "pendente");
      return json(200, { state: "missing" });
    }

    return json(400, { error: "acao_invalida" });
  } catch (e) {
    console.error("falha ao falar com o gateway:", (e as Error).message);
    return json(502, { error: "gateway_indisponivel" });
  }
});

async function salvarEstado(admin: any, workshopId: string, data: any) {
  const state = ["open", "connecting", "close", "missing"].includes(data?.state)
    ? data.state
    : "missing";
  await admin.from("whatsapp_connections").upsert(
    {
      workshop_id: workshopId,
      state,
      phone: data?.phone ?? null,
      connected_at: state === "open" ? new Date().toISOString() : null,
    },
    { onConflict: "workshop_id" },
  );
}
