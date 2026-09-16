/**
 * Converte um valor digitado em formato BR ("1.234,56") para número.
 * Aceita ponto como separador de milhar e vírgula como decimal.
 */
export function parseCurrencyInput(
  value: string,
  { min = 0 }: { min?: number } = {}
): number {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);

  if (!value.trim() || !Number.isFinite(amount) || amount < min) {
    throw new Error(
      min > 0 ? "Informe um valor maior que zero." : "Informe um valor válido."
    );
  }

  return amount;
}

/** Aceita valor negativo (desconto) no formato BR, com sinal no início. */
export function parseSignedCurrencyInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "−") return 0;
  const negative = /^[-−]/.test(trimmed);
  const unsigned = trimmed.replace(/^[-−]\s*/, "");
  if (!unsigned) return 0;
  return (negative ? -1 : 1) * parseCurrencyInput(unsigned, { min: 0 });
}

/** Máscara de moeda com sinal opcional no início (desconto ou acréscimo). */
export function maskSignedCurrencyInput(value: string): string {
  const trimmed = value.trim();
  const negative = /^[-−]/.test(trimmed);
  const masked = maskCurrencyInput(trimmed);
  if (!masked) return negative ? "-" : "";
  return negative ? `-${masked}` : masked;
}

export function formatMoneyInput(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Máscara de moeda enquanto o usuário digita: mantém apenas dígitos e formata como BRL. */
export function maskCurrencyInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  const cents = Number(digits) / 100;
  return cents.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
