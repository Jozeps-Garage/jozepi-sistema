/**
 * Estoque por embalagem.
 *
 * O modelo antigo guardava volume total e volume restante e desenhava uma
 * barra de consumo que nunca andava — nada descontava estoque ao prestar
 * serviço. Agora o saldo é contagem de embalagem ("3 galões", "12 panos") e só
 * muda por movimento explícito: entrada de compra, baixa ou revisão.
 */

export type StockKind = "liquido" | "utensilio" | "patrimonio";

export const STOCK_KIND_LABEL: Record<StockKind, string> = {
  liquido: "Produto líquido",
  utensilio: "Utensílio",
  patrimonio: "Patrimônio",
};

export const STOCK_KIND_OPTIONS: { value: StockKind; label: string }[] = [
  { value: "liquido", label: "Produto líquido" },
  { value: "utensilio", label: "Utensílio" },
  { value: "patrimonio", label: "Patrimônio" },
];

export type MovementKind = "entrada" | "baixa" | "revisao";

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  entrada: "Entrada",
  baixa: "Baixa",
  revisao: "Revisão",
};

export interface StockItem {
  id: string;
  name: string;
  kind: StockKind;
  /** Quantas embalagens/unidades há. Patrimônio ignora. */
  onHand: number;
  /** Abaixo disso o painel avisa. Nulo: não avisa. */
  minOnHand: number | null;
  /** Como você chama a embalagem: galão, frasco, pano. */
  unitLabel: string;
  /** Tamanho de uma embalagem, em ml. Só líquido. */
  packageVolumeMl: number | null;
  /** Custo de uma embalagem/unidade. */
  unitCost: number;
  /** Quanto o equipamento vale hoje. Só patrimônio. */
  resaleValue: number | null;
  acquiredOn: string | null;
  supplierId: string | null;
  photoUrl: string | null;
}

export interface StockMovement {
  id: string;
  productId: string;
  kind: MovementKind;
  quantity: number;
  balanceAfter: number;
  occurredOn: string;
  notes: string | null;
  transactionId: string | null;
  /** Quanto custou cada unidade nesta entrada. Nulo em baixa e revisão. */
  unitCost: number | null;
  createdAt: string;
}

/** Patrimônio não se consome, então não entra em contagem nem em alerta. */
export function tracksStock(kind: StockKind) {
  return kind !== "patrimonio";
}

export function isLowStock(item: StockItem) {
  if (!tracksStock(item.kind)) return false;
  if (item.minOnHand === null) return false;
  return item.onHand <= item.minOnHand;
}

/**
 * "1 unidade", "12 unidades". O nome da embalagem saiu do cadastro: era um
 * campo a mais para preencher em troca de uma palavra na tela.
 */
export function formatOnHand(item: StockItem) {
  const quantity = item.onHand;
  const rounded = Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(2).replace(".", ",");
  return `${rounded} ${quantity === 1 ? "unidade" : "unidades"}`;
}


/** O volume total guardado, quando faz sentido dizer. */
export function totalVolumeMl(item: StockItem) {
  if (item.kind !== "liquido" || !item.packageVolumeMl) return null;
  return item.onHand * item.packageVolumeMl;
}

export function formatVolume(ml: number) {
  if (ml >= 1000) {
    const litres = ml / 1000;
    return `${Number.isInteger(litres) ? litres : litres.toFixed(1).replace(".", ",")} L`;
  }
  return `${ml} ml`;
}

/**
 * Saldo depois de um movimento. Revisão não soma nem subtrai: ela afirma o
 * saldo contado, que é o ponto de fazer a contagem.
 */
export function balanceAfterMovement(
  current: number,
  kind: MovementKind,
  quantity: number
) {
  if (kind === "revisao") return Math.max(0, quantity);
  if (kind === "entrada") return current + quantity;
  return Math.max(0, current - quantity);
}

export interface StockCycle {
  /** Data da entrada que tirou o produto do zero. */
  startedOn: string;
  /** Data em que zerou. Nulo: ainda em uso. */
  endedOn: string | null;
  /** Quanto entrou ao longo do ciclo. */
  purchased: number;
  days: number | null;
}

/**
 * Fecha os ciclos de vida do produto a partir das movimentações: de quando saiu
 * do zero até voltar a zero. É o que responde "comprei dia X, acabou dia Y,
 * durou N dias".
 *
 * Espera os movimentos em ordem cronológica crescente.
 */
export function buildStockCycles(movements: StockMovement[]): StockCycle[] {
  const cycles: StockCycle[] = [];
  let open: StockCycle | null = null;
  let previousBalance = 0;

  for (const movement of movements) {
    const saiuDoZero = previousBalance === 0 && movement.balanceAfter > 0;
    if (saiuDoZero && !open) {
      open = {
        startedOn: movement.occurredOn,
        endedOn: null,
        purchased: 0,
        days: null,
      };
    }

    if (open && movement.kind === "entrada") {
      open.purchased += movement.quantity;
    }

    if (open && movement.balanceAfter === 0 && previousBalance > 0) {
      open.endedOn = movement.occurredOn;
      open.days = daysBetween(open.startedOn, movement.occurredOn);
      cycles.push(open);
      open = null;
    }

    previousBalance = movement.balanceAfter;
  }

  if (open) cycles.push(open);
  return cycles.reverse();
}

export interface StockWriteOff<T extends StockMovement = StockMovement> {
  movement: T;
  /** Desde quando havia saldo deste item. Nulo: nunca houve entrada. */
  inStockSince: string | null;
  /** Custo unitário da última compra antes desta baixa. */
  unitCost: number | null;
  /** Dias entre aquela entrada e esta baixa. */
  days: number | null;
  /** A baixa zerou o saldo — aí sim o item acabou. */
  emptied: boolean;
}

/**
 * As baixas de um produto, cada uma sabendo de onde veio o que saiu.
 *
 * Só a baixa é notícia: revisão e entrada enchiam o histórico de linhas que
 * não respondem nada. Mas uma baixa sozinha também não responde — "saíram 4"
 * só vira informação ao lado de desde quando estavam ali e do que custaram.
 *
 * Espera os movimentos em ordem cronológica crescente.
 */
export function buildWriteOffs<T extends StockMovement>(movements: T[]): StockWriteOff<T>[] {
  const writeOffs: StockWriteOff<T>[] = [];
  let since: string | null = null;
  // Último preço conhecido: atravessa o ciclo, porque é o que se pagou pelo
  // que está saindo agora. Uma compra nova por cima substitui.
  let unitCost: number | null = null;
  let previousBalance = 0;

  for (const movement of movements) {
    if (previousBalance === 0 && movement.balanceAfter > 0) {
      since = movement.occurredOn;
    }
    if (movement.kind === "entrada" && movement.unitCost !== null) {
      unitCost = movement.unitCost;
    }

    if (movement.kind === "baixa") {
      writeOffs.push({
        movement,
        inStockSince: since,
        unitCost,
        days: since ? daysBetween(since, movement.occurredOn) : null,
        emptied: movement.balanceAfter === 0,
      });
    }

    // Zerou: o próximo saldo começa outra contagem de tempo.
    if (movement.balanceAfter === 0) since = null;
    previousBalance = movement.balanceAfter;
  }

  return writeOffs;
}

export function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function formatDuration(days: number) {
  if (days === 0) return "no mesmo dia";
  if (days === 1) return "1 dia";
  if (days < 30) return `${days} dias`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  const monthPart = months === 1 ? "1 mês" : `${months} meses`;
  if (rest === 0) return monthPart;
  return `${monthPart} e ${rest === 1 ? "1 dia" : `${rest} dias`}`;
}
