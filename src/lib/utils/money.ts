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
