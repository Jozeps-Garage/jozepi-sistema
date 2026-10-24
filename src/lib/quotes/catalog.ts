import type { QuoteItemKind } from "@/lib/quotes/types";

export interface QuoteServiceRow {
  id: string;
  name: string;
  price: number | string;
  duration_minutes: number | null;
  active: boolean;
  category?: string | null;
}

export interface QuoteCatalogOption {
  key: string;
  kind: QuoteItemKind;
  name: string;
  price: number;
  packageId?: string;
  serviceId?: string;
}

export function kindFromCategory(category?: string | null): QuoteItemKind {
  const normalized = (category ?? "").trim().toLowerCase();
  if (normalized === "coating") return "coating";
  if (normalized === "stage" || normalized === "stages") return "stage";
  return "servico";
}

export function buildQuoteCatalogOptions(
  services: QuoteServiceRow[]
): QuoteCatalogOption[] {
  // Tudo vem do catálogo do banco. Antes os pacotes de stage e coating eram
  // injetados daqui, escritos no código, e os serviços de mesmo nome ficavam
  // escondidos para não duplicar.
  const standalone = services
    .filter((service) => service.active)
    .map((service) => ({
      key: `service:${service.id}`,
      kind: kindFromCategory(service.category),
      name: service.name,
      price: Number(service.price) || 0,
      serviceId: service.id,
    }));

  return [
    ...standalone.filter((item) => item.kind === "coating"),
    ...standalone.filter((item) => item.kind === "stage"),
    ...standalone.filter((item) => item.kind === "servico"),
  ];
}

export async function resolveCatalogOption(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: any,
  _workshopId: string,
  _services: QuoteServiceRow[],
  option: QuoteCatalogOption
): Promise<{ serviceId: string; name: string; kind: QuoteItemKind; price: number }> {
  if (!option.serviceId) {
    throw new Error("Item de catálogo inválido.");
  }

  return {
    serviceId: option.serviceId,
    name: option.name,
    kind: option.kind,
    price: option.price,
  };
}
