/**
 * Desconto do lançamento.
 *
 * O que vai para o banco é o líquido: é ele que saiu da conta, e é o que
 * relatório, fluxo de caixa e saldo precisam somar. O bruto e o desconto
 * ficam guardados ao lado para a nota continuar contando a história certa
 * quando você reabrir o lançamento.
 */

export type DiscountType = "fixed" | "percent";

export const DISCOUNT_TYPE_OPTIONS: { value: DiscountType; label: string }[] = [
  { value: "fixed", label: "Valor fixo R$" },
  { value: "percent", label: "Percentual %" },
];

export function isDiscountType(value: unknown): value is DiscountType {
  return value === "fixed" || value === "percent";
}

/** Percentual fora de 0–100 não é desconto; vira o limite mais próximo. */
function clampPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, value);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** Quanto o desconto tira, em reais, de um valor bruto. */
export function discountAmount(gross: number, type: DiscountType, value: number) {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  if (type === "percent") return round((gross * clampPercent(value)) / 100);
  // Desconto maior que a nota não gera troco: para no total.
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round(Math.min(value, gross));
}

export function netFromGross(gross: number, type: DiscountType, value: number) {
  return round(gross - discountAmount(gross, type, value));
}

/**
 * O número que vai para o banco.
 *
 * Desconto maior que a nota é erro de digitação, e guardá-lo cru faria o
 * bruto voltar errado na reabertura: a nota de 100 com "250 de desconto"
 * reapareceria como nota de 250.
 */
export function normalizeDiscountValue(
  gross: number,
  type: DiscountType,
  value: number
) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (type === "percent") return clampPercent(value);
  return round(Math.min(value, Math.max(0, gross)));
}

/**
 * O caminho de volta, para quem reabre o lançamento: o banco guarda o
 * líquido, e o bruto é o que havia antes do desconto.
 */
export function grossFromNet(net: number, type: DiscountType, value: number) {
  if (!Number.isFinite(net) || net < 0) return 0;
  if (type === "fixed") {
    return round(net + (Number.isFinite(value) && value > 0 ? value : 0));
  }
  const percent = clampPercent(value);
  // 100% de desconto zera a nota e apaga o bruto junto: não há o que inverter.
  if (percent >= 100) return round(net);
  return round(net / (1 - percent / 100));
}
