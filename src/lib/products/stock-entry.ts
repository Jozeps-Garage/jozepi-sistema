import {
  getProductInitialStock,
  getProductRemainingStock,
  type ProductItem,
} from "@/lib/products/catalog";
import { formatMoneyInput } from "@/lib/utils/money";

/**
 * Entrada de compra no estoque.
 *
 * O cadastro guarda o estoque de líquido em mililitros: `volumeMl` é o tamanho
 * do "tanque" e `stockRemaining` é quanto sobrou dele. Comprar 3 galões de
 * 5000 ml são 15.000 ml entrando — mais do que o tanque de um galão comporta.
 * Por isso o tanque cresce junto: sem isso a barra satura em 100% e a compra
 * simplesmente some.
 *
 * Utensílio conta por unidade, então o mesmo raciocínio vale sobre `quantity`.
 */
export interface StockEntryInput {
  /** Quantas unidades/embalagens foram compradas. */
  quantity: number;
  /** Volume de cada unidade, em ml. Só vale para líquido. */
  volumeMl: number;
  /** Preço unitário desta compra, para atualizar o custo do produto. */
  unitAmount: number;
  /** Data da compra, para o histórico de preço. */
  date: string;
}

export function purchasedStockAmount(product: ProductItem, input: StockEntryInput) {
  const quantity = Math.max(0, input.quantity);
  if (product.type === "liquid") {
    // Sem volume na linha da nota, cai para o tamanho cadastrado do produto.
    const perUnit = input.volumeMl > 0 ? input.volumeMl : getProductInitialStock(product);
    return quantity * perUnit;
  }
  return quantity;
}

/** O produto como fica depois da compra entrar. Não grava nada. */
export function applyStockEntry(
  product: ProductItem,
  input: StockEntryInput
): ProductItem {
  const purchased = purchasedStockAmount(product, input);
  if (purchased <= 0) return product;

  const remaining = getProductRemainingStock(product);
  const nextRemaining = remaining + purchased;
  const capacity = getProductInitialStock(product);
  // O tanque nunca encolhe, mas cresce para caber o que entrou.
  const nextCapacity = Math.max(capacity, nextRemaining);

  const next: ProductItem = {
    ...product,
    stockRemaining: String(nextRemaining),
    priceHistory: [...(product.priceHistory ?? [])],
  };

  if (product.type === "liquid") {
    next.volumeMl = String(nextCapacity);
  } else {
    next.quantity = String(nextCapacity);
  }

  if (input.unitAmount > 0) {
    // Formato BR: o cadastro lê o ponto como separador de milhar, então
    // "110.00" viraria onze mil reais.
    const price = formatMoneyInput(input.unitAmount);
    next.totalCost = price;
    next.priceHistory = [
      ...next.priceHistory!,
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `price-${Date.now()}`,
        price,
        date: input.date,
        reason: "replenished",
      },
    ];
  }

  return next;
}

/** Produto novo a partir de uma linha da nota que não existia no cadastro. */
export function productFromInvoiceLine(input: {
  name: string;
  quantity: number;
  volumeMl: number;
  unitAmount: number;
  supplierId?: string;
}): Omit<ProductItem, "id"> & { id: string } {
  const isLiquid = input.volumeMl > 0;
  const total = Math.max(1, input.quantity) * (isLiquid ? input.volumeMl : 1);

  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `produto-${Date.now()}`,
    name: input.name.trim(),
    type: isLiquid ? "liquid" : "utensil",
    // Nasce cheio: acabou de ser comprado.
    volumeMl: isLiquid ? String(total) : "",
    usagePerWashMl: "",
    quantity: isLiquid ? String(Math.max(1, input.quantity)) : String(total),
    durabilityWashes: "",
    totalCost: input.unitAmount > 0 ? formatMoneyInput(input.unitAmount) : "",
    stockRemaining: String(total),
    supplierId: input.supplierId,
    priceHistory: [],
  };
}
