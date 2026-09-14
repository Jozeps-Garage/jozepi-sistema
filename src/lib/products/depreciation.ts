import {
  getProductInitialStock,
  getProductRemainingStock,
  getUtensilDepreciationMode,
  parseMoney,
  type ProductItem,
} from "@/lib/products/catalog";

export function isUtensilProduct(product: { type: string }) {
  return product.type === "utensil";
}

export function getDepreciatedValue(product: ProductItem): number | null {
  if (!isUtensilProduct(product)) return null;
  if (getUtensilDepreciationMode(product) === "none") return null;

  const initial = getProductInitialStock(product);
  if (initial <= 0) return null;

  try {
    const purchase = parseMoney(product.totalCost || "0");
    return purchase * (getProductRemainingStock(product) / initial);
  } catch {
    return null;
  }
}
