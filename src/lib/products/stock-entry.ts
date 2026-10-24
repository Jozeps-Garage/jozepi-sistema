import type { ProductItem } from "@/lib/products/catalog";
import type { StockKind } from "@/lib/products/stock";
import { formatMoneyInput } from "@/lib/utils/money";

/**
 * Entrada de compra no estoque.
 *
 * Conta embalagem, não volume: comprar 3 galões são 3 unidades entrando, e o
 * tamanho de cada uma é atributo do produto, não da compra. Antes isto somava
 * mililitros no "tanque" do modelo antigo — que a 047 aposentou.
 */
export interface StockEntryInput {
  /** Quantas embalagens/unidades foram compradas. */
  quantity: number;
  /** Volume de cada unidade, em ml. Só serve para cadastrar produto novo. */
  volumeMl: number;
  /** Preço unitário desta compra. */
  unitAmount: number;
  /** Data da compra. */
  date: string;
}

/** Produto novo a partir de uma linha da nota que não existia no cadastro. */
export function productFromInvoiceLine(input: {
  name: string;
  quantity: number;
  volumeMl: number;
  unitAmount: number;
  supplierId?: string;
}): ProductItem {
  const isLiquid = input.volumeMl > 0;
  const kind: StockKind = isLiquid ? "liquido" : "utensilio";

  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `produto-${Date.now()}`,
    name: input.name.trim(),
    // O `type` antigo segue junto: parte do app ainda lê por ele.
    type: isLiquid ? "liquid" : "utensil",
    kind,
    volumeMl: "",
    usagePerWashMl: "",
    quantity: "",
    durabilityWashes: "",
    // Formato BR: o cadastro lê ponto como separador de milhar.
    totalCost: input.unitAmount > 0 ? formatMoneyInput(input.unitAmount) : "",
    // Nasce zerado: a entrada da compra é que põe o saldo, e assim ela fica
    // registrada no histórico em vez de virar um estoque surgido do nada.
    onHand: 0,
    minOnHand: null,
    unitLabel: "unidade",
    packageVolumeMl: isLiquid ? input.volumeMl : null,
    resaleValue: null,
    acquiredOn: null,
    supplierId: input.supplierId,
    priceHistory: [],
  };
}
