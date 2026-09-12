// Assinatura das chamadas ao gateway de WhatsApp.
//
// Porte fiel do cliente de referência do gateway. Se o formato mudar lá, muda aqui:
//   canonico = timestamp \n nonce \n MÉTODO \n path-com-query \n sha256hex(corpo)
//   x-gw-signature: v1=<hex(HMAC-SHA256(segredo, canonico))>
//
// O segredo vive só nos secrets do Supabase. Nunca vai pro navegador e nunca pro repo
// (que é público).

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(
  secret: string,
  ts: string,
  nonce: string,
  method: string,
  path: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", enc.encode(body)));
  const canonical = `${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  return "v1=" + hex(await crypto.subtle.sign("HMAC", key, enc.encode(canonical)));
}

export type GatewayResponse = { status: number; data: any };

export async function callGateway(
  method: string,
  path: string,
  payload?: unknown,
): Promise<GatewayResponse> {
  const baseUrl = Deno.env.get("WHATSAPP_GATEWAY_URL");
  const secret = Deno.env.get("WHATSAPP_GATEWAY_SECRET");
  if (!baseUrl || !secret) throw new Error("gateway não configurado");

  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  // Nonce de uso único: é o que impede reenvio de uma requisição capturada.
  const nonce = hex(crypto.getRandomValues(new Uint8Array(18)).buffer);

  const res = await fetch(baseUrl.replace(/\/+$/, "") + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-gw-timestamp": ts,
      "x-gw-nonce": nonce,
      "x-gw-signature": await sign(secret, ts, nonce, method, path, body),
    },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(25_000),
  });

  return { status: res.status, data: await res.json().catch(() => null) };
}

export const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
