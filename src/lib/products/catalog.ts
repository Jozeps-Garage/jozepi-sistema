export type ProductType = string;

export type DepreciationMode = "none" | "time" | "usage";

export const DEPRECIATION_MODE_OPTIONS: {
  value: DepreciationMode;
  label: string;
}[] = [
  { value: "none", label: "Sem depreciação" },
  { value: "time", label: "Por tempo" },
  { value: "usage", label: "Por uso" },
];

export interface ProductTypeOption {
  value: string;
  label: string;
  custom?: boolean;
}

export type ProductPriceHistoryReason = "created" | "edited" | "replenished";

export interface ProductPriceHistoryEntry {
  id: string;
  price: string;
  date: string;
  reason: ProductPriceHistoryReason;
}

export interface ProductItem {
  id: string;
  name: string;
  type: ProductType;
  volumeMl: string;
  usagePerWashMl: string;
  quantity: string;
  durabilityWashes: string;
  totalCost: string;
  photoUrl?: string;
  supplierId?: string;
  stockRemaining?: string;
  priceHistory?: ProductPriceHistoryEntry[];
  createdAt?: string;
}

export interface ProductForm {
  name: string;
  type: ProductType;
  volumeMl: string;
  usagePerWashMl: string;
  quantity: string;
  durabilityWashes: string;
  totalCost: string;
  photoUrl: string;
  supplierId: string;
  depreciationMode: DepreciationMode;
  acquiredAt: string;
}

export interface ServiceProductUsage {
  id: string;
  productId: string;
  amount: string;
}

export const PRODUCTS_STORAGE_KEY = "auto-estetica-products-utensils";
export const PRODUCT_TYPES_STORAGE_KEY = "auto-estetica-product-types";
export const SERVICE_PRODUCT_USAGE_STORAGE_KEY =
  "auto-estetica-service-product-usages";
export const STOCK_DISCOUNTS_STORAGE_KEY = "auto-estetica-stock-discounts";

export const emptyProductForm: ProductForm = {
  name: "",
  type: "liquid",
  volumeMl: "",
  usagePerWashMl: "",
  quantity: "",
  durabilityWashes: "",
  totalCost: "",
  photoUrl: "",
  supplierId: "",
  depreciationMode: "none",
  acquiredAt: "",
};

export const productTypeOptions: ProductTypeOption[] = [
  { value: "liquid", label: "Produto líquido" },
  { value: "utensil", label: "Utensílio" },
];

export function createProductTypeId(label: string) {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `custom-${slug || "tipo"}-${Date.now()}`;
}

export function parseMoney(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Informe um preço válido.");
  }

  return price;
}

export function parsePositiveNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Informe valores maiores que zero.");
  }

  return number;
}

function parseStockNumber(value: string | undefined) {
  if (!value) return 0;

  const normalized = value.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);

  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function formatStockAmount(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function getUtensilDepreciationMode(product: {
  type: string;
  usagePerWashMl?: string;
}): DepreciationMode {
  if (product.type !== "utensil") return "none";
  const raw = product.usagePerWashMl?.trim() ?? "";
  if (raw === "usage" || raw.startsWith("usage:")) return "usage";
  if (raw === "time" || raw.startsWith("time:")) return "time";
  return "none";
}

export function getUtensilAcquiredAt(product: ProductItem) {
  const raw = product.usagePerWashMl?.trim() ?? "";
  const match = raw.match(/^time:(\d{4}-\d{2}-\d{2})$/);
  if (match?.[1]) return match[1];
  return product.createdAt?.slice(0, 10) ?? "";
}

export function encodeUtensilDepreciation(
  mode: DepreciationMode,
  acquiredAt = ""
) {
  if (mode === "usage") return "usage";
  if (mode === "time") {
    return acquiredAt ? `time:${acquiredAt}` : "time";
  }
  return "";
}

export function monthsElapsed(acquiredAt: string, now = new Date()) {
  const [year, month, day] = acquiredAt.split("-").map(Number);
  if (!year || !month || !day) return 0;

  const start = new Date(year, month - 1, day);
  if (Number.isNaN(start.getTime()) || start > now) return 0;

  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;

  return Math.max(0, months);
}

export function getProductInitialStock(product: ProductItem) {
  if (product.type === "liquid") return parseStockNumber(product.volumeMl);

  if (getUtensilDepreciationMode(product) === "time") {
    return parseStockNumber(product.durabilityWashes);
  }

  return parseStockNumber(product.quantity);
}

export function getProductRemainingStock(product: ProductItem, now = new Date()) {
  const initialStock = getProductInitialStock(product);
  if (initialStock <= 0) return 0;

  if (getUtensilDepreciationMode(product) === "time") {
    const remaining = initialStock - monthsElapsed(getUtensilAcquiredAt(product), now);
    return Math.min(initialStock, Math.max(0, remaining));
  }

  const remainingStock =
    product.stockRemaining === undefined
      ? initialStock
      : parseStockNumber(product.stockRemaining);

  return Math.min(initialStock, Math.max(0, remainingStock));
}

export function getProductStockPercent(product: ProductItem) {
  const initialStock = getProductInitialStock(product);
  if (initialStock <= 0) return 0;

  return (getProductRemainingStock(product) / initialStock) * 100;
}

export function getProductStockUnit(product: ProductItem) {
  if (product.type === "liquid") return "ml";
  const mode = getUtensilDepreciationMode(product);
  if (mode === "time") return "meses";
  if (mode === "usage") return "usos";
  return "un.";
}

export function normalizeProductStock(product: ProductItem): ProductItem {
  return {
    ...product,
    stockRemaining:
      product.stockRemaining !== undefined
        ? product.stockRemaining
        : String(getProductInitialStock(product)),
    priceHistory: Array.isArray(product.priceHistory)
      ? product.priceHistory
      : [],
  };
}

export function calculateProductUsageCost(
  product: ProductItem,
  amountValue: string
) {
  try {
    const totalCost = parseMoney(product.totalCost || "0");
    const amount = parsePositiveNumber(amountValue);

    if (product.type === "liquid") {
      const volumeMl = parsePositiveNumber(product.volumeMl);
      return (totalCost * amount) / volumeMl;
    }

    const quantity = parsePositiveNumber(product.quantity);
    return (totalCost * amount) / quantity;
  } catch {
    return 0;
  }
}

export function getProductTypeLabel(type: ProductType) {
  return (
    productTypeOptions.find((option) => option.value === type)?.label ??
    (type === "liquid" ? "Produto líquido" : "Utensílio")
  );
}

export function getProductAmountLabel(type: ProductType) {
  return type === "liquid" ? "Quantidade usada neste serviço (ml)" : "Quantidade usada neste serviço";
}

export function createProductId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `product-${Date.now()}-${Math.random()}`;
}

export function createProductPriceHistoryId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `price-history-${Date.now()}-${Math.random()}`;
}

export function createUsageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `usage-${Date.now()}-${Math.random()}`;
}
