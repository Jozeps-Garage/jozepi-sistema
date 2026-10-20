/**
 * Cliente da API da Notaas para emissão de NFS-e.
 *
 * Este módulo só roda no servidor, e isso é regra, não detalhe: a chave emite
 * nota fiscal em nome da oficina. Ela vive em NOTAAS_API_KEY (sem o prefixo
 * NEXT_PUBLIC_, que é o que faria o Next empacotá-la para o navegador) e é
 * lida apenas pelas rotas em src/app/api/nfse.
 *
 * A emissão é assíncrona: POST /emitir devolve 202 com um invoiceId e a nota
 * só fica pronta depois. Quem chama consulta /invoices/{id}/status até sair de
 * queued/processing.
 *
 * Documentação: https://docs.notaas.com.br/docs/endpoints
 */

const NOTAAS_BASE_URL = "https://platform.notaas.com.br/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;

export type NfseStatus = "queued" | "processing" | "issued" | "error" | "cancelled";

export interface NfseEmitInput {
  /** Nosso identificador, devolvido no status e no webhook. */
  referencia: string;
  tomador: {
    nome: string;
    /** Só dígitos. A NFS-e exige um dos dois. */
    cnpj?: string;
    cpf?: string;
    email?: string;
    telefone?: string;
  };
  servico: {
    descricao: string;
    /** cTribNac, 6 dígitos. Omitido: usa o padrão do projeto na Notaas. */
    codigo?: string;
  };
  valores: {
    total: number;
    aliquotaIss: number;
  };
}

export interface NfseEmitResult {
  invoiceId: string;
  referencia?: string;
  status: NfseStatus;
}

export interface NfseStatusResult {
  invoiceId: string;
  referencia?: string;
  status: NfseStatus;
  numeroNfe?: string;
  chNFSe?: string;
  emittedAt?: string;
  cancelledAt?: string;
  ambiente?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Erro com o status HTTP junto, para a rota decidir o que devolver. */
export class NotaasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "NotaasError";
  }
}

function apiKey() {
  // Cinto e suspensório: o nome sem NEXT_PUBLIC_ já impede o Next de mandar a
  // chave para o navegador, mas se alguém importar isto num client component o
  // erro aparece na hora, em vez de virar uma chamada sem chave.
  if (typeof window !== "undefined") {
    throw new NotaasError("Emissão de nota só pode partir do servidor.", 500);
  }

  const key = process.env.NOTAAS_API_KEY;
  if (!key) {
    throw new NotaasError(
      "Emissão de nota não configurada: falta NOTAAS_API_KEY no servidor.",
      503
    );
  }
  return key;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Mensagem de erro da Notaas. A API varia entre `message`, `error` e uma lista
 * de rejeições da prefeitura; juntar tudo é mais útil que escolher um campo.
 */
function describeError(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const data = body as Record<string, unknown>;
  const direct =
    (typeof data.message === "string" && data.message) ||
    (typeof data.error === "string" && data.error) ||
    (typeof data.errorMessage === "string" && data.errorMessage) ||
    (typeof data.msg_rejeicao === "string" && data.msg_rejeicao);

  const list = Array.isArray(data.errors) ? data.errors : [];
  const detalhes = list
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return [row.Descricao, row.Complemento].filter(Boolean).join(" — ");
    })
    .filter(Boolean)
    .join(" · ");

  return [direct || fallback, detalhes].filter(Boolean).join(" · ");
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${NOTAAS_BASE_URL}${path}`, {
      method: init.method,
      headers: {
        "x-api-key": apiKey(),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new NotaasError("A Notaas demorou demais para responder.", 504);
    }
    throw new NotaasError("Não foi possível falar com a Notaas.", 502);
  }
  clearTimeout(timeout);

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const code =
      parsed && typeof parsed === "object"
        ? ((parsed as Record<string, unknown>).errorCode as string | undefined) ??
          ((parsed as Record<string, unknown>).cod_rejeicao as string | undefined)
        : undefined;
    throw new NotaasError(
      describeError(parsed, `A Notaas respondeu ${response.status}.`),
      response.status,
      code
    );
  }

  return parsed as T;
}

export async function emitNfse(input: NfseEmitInput): Promise<NfseEmitResult> {
  const cnpj = input.tomador.cnpj ? onlyDigits(input.tomador.cnpj) : "";
  const cpf = input.tomador.cpf ? onlyDigits(input.tomador.cpf) : "";

  if (!cnpj && !cpf) {
    throw new NotaasError(
      "O tomador precisa de CPF ou CNPJ para a nota ser emitida.",
      422
    );
  }

  const body = {
    referencia: input.referencia,
    tomador: {
      nome: input.tomador.nome,
      ...(cnpj ? { cnpj } : { cpf }),
      ...(input.tomador.email ? { email: input.tomador.email } : {}),
      ...(input.tomador.telefone
        ? { telefone: onlyDigits(input.tomador.telefone) }
        : {}),
    },
    servico: {
      descricao: input.servico.descricao,
      // Sem código aqui, a Notaas usa o padrão cadastrado no projeto.
      ...(input.servico.codigo ? { codigo: input.servico.codigo } : {}),
    },
    valores: {
      total: input.valores.total,
      aliquotaIss: input.valores.aliquotaIss,
    },
  };

  const result = await request<{
    invoiceId?: string;
    referencia?: string;
    status?: NfseStatus;
  }>("/emitir", { method: "POST", body });

  if (!result?.invoiceId) {
    throw new NotaasError("A Notaas aceitou a nota mas não devolveu o id.", 502);
  }

  return {
    invoiceId: result.invoiceId,
    referencia: result.referencia,
    status: result.status ?? "queued",
  };
}

export async function getNfseStatus(invoiceId: string): Promise<NfseStatusResult> {
  const result = await request<Record<string, unknown>>(
    `/invoices/${encodeURIComponent(invoiceId)}/status`,
    { method: "GET" }
  );

  const text = (key: string) =>
    typeof result?.[key] === "string" ? (result[key] as string) : undefined;

  return {
    invoiceId: text("invoiceId") ?? invoiceId,
    referencia: text("referencia"),
    status: (text("status") as NfseStatus) ?? "queued",
    numeroNfe: text("numeroNfe"),
    chNFSe: text("chNFSe"),
    emittedAt: text("emittedAt"),
    cancelledAt: text("cancelledAt"),
    ambiente: text("ambiente"),
    pdfUrl: text("pdfUrl"),
    xmlUrl: text("xmlUrl"),
    errorCode: text("errorCode") ?? text("cod_rejeicao"),
    errorMessage: describeError(result, "") || undefined,
  };
}

export async function cancelNfse(invoiceId: string, motivo: string) {
  return request<Record<string, unknown>>("/cancelar", {
    method: "POST",
    body: { invoiceId, motivo },
  });
}
