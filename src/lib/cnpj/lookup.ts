/**
 * Consulta de CNPJ na BrasilAPI, que repassa os dados públicos da Receita
 * Federal. Sem chave e sem cadastro.
 *
 * Duas pegadinhas, as duas confirmadas na mão:
 *
 * 1. O endereço é /api/cnpj/v1/... — o openapi.json da BrasilAPI declara o
 *    server como "https://brasilapi.com.br" e a rota como "/cnpj/v1/{cnpj}",
 *    e essa combinação devolve 404. O /api fica de fora do spec.
 *
 * 2. Isto roda no navegador de propósito. Chamada a partir do Node (route
 *    handler, script) volta 403: a BrasilAPI barra o User-Agent padrão do
 *    fetch do Node. Se um dia precisar chamar do servidor, mande um
 *    User-Agent próprio no cabeçalho.
 */
const CNPJ_ENDPOINT = "https://brasilapi.com.br/api/cnpj/v1";

export type CnpjLookupResult = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  telefone: string;
  email: string;
  cidadeUf: string;
  endereco: string;
  situacao: string;
  /** Baixada, suspensa ou inapta: vale avisar antes de cadastrar. */
  ativa: boolean;
};

export function onlyCnpjDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 14);
}

export function formatCnpj(value: string) {
  const d = onlyCnpjDigits(value);
  if (d.length !== 14) return value;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Dígitos verificadores. Evita gastar uma consulta em número digitado errado. */
export function isValidCnpj(value: string) {
  const d = onlyCnpjDigits(value);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const check = (len: number) => {
    let sum = 0;
    let weight = len - 7;
    for (let i = 0; i < len; i += 1) {
      sum += Number(d[i]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

function phoneFrom(raw: unknown) {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  if (digits.length < 10) return "";
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const half = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, half)}-${rest.slice(half)}`;
}

function text(raw: unknown) {
  // A API devolve a string "None" quando o campo está vazio na Receita.
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return value === "None" ? "" : value;
}

export async function lookupCnpj(value: string): Promise<CnpjLookupResult> {
  const digits = onlyCnpjDigits(value);

  if (!isValidCnpj(digits)) {
    throw new Error("CNPJ inválido. Confira os números.");
  }

  let response: Response;
  try {
    response = await fetch(`${CNPJ_ENDPOINT}/${digits}`);
  } catch {
    throw new Error("Não foi possível consultar agora. Verifique a conexão.");
  }

  if (response.status === 404) {
    throw new Error("CNPJ não encontrado na Receita Federal.");
  }
  if (response.status === 429) {
    throw new Error("Muitas consultas seguidas. Tente de novo em instantes.");
  }
  if (!response.ok) {
    throw new Error("A consulta falhou. Tente de novo em instantes.");
  }

  const data = (await response.json()) as Record<string, unknown>;
  const municipio = text(data.municipio);
  const uf = text(data.uf);
  const logradouro = text(data.logradouro);
  const numero = text(data.numero);
  const bairro = text(data.bairro);
  const situacao = text(data.descricao_situacao_cadastral);

  return {
    cnpj: formatCnpj(digits),
    razaoSocial: text(data.razao_social),
    nomeFantasia: text(data.nome_fantasia),
    telefone: phoneFrom(data.ddd_telefone_1),
    email: text(data.email).toLowerCase(),
    cidadeUf: municipio && uf ? `${municipio}/${uf}` : municipio || uf,
    endereco: [logradouro && numero ? `${logradouro}, ${numero}` : logradouro, bairro]
      .filter(Boolean)
      .join(" - "),
    situacao,
    ativa: situacao.toUpperCase() === "ATIVA",
  };
}
