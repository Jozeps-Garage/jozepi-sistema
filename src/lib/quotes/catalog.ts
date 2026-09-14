import {
  ensurePackageServicesInCatalog,
  loadCoatingPackages,
  loadStagePackages,
  packageCatalogName,
} from "@/lib/services/packages";
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
  const coatings = loadCoatingPackages();
  const stages = loadStagePackages();
  const packageNames = new Set(
    [
      ...coatings.map((pkg) => packageCatalogName(pkg, "coating")),
      ...stages.map((pkg) => packageCatalogName(pkg, "stage")),
    ].map((name) => name.trim().toLowerCase())
  );

  const standalone = services
    .filter((service) => service.active)
    .filter((service) => !packageNames.has(service.name.trim().toLowerCase()))
    .map((service) => ({
      key: `service:${service.id}`,
      kind: kindFromCategory(service.category),
      name: service.name,
      price: Number(service.price) || 0,
      serviceId: service.id,
    }));

  const coatingOptions: QuoteCatalogOption[] = coatings.map((pkg) => ({
    key: `package:${pkg.id}`,
    kind: "coating",
    name: pkg.badge,
    price: pkg.price,
    packageId: pkg.id,
  }));

  const stageOptions: QuoteCatalogOption[] = stages.map((pkg) => ({
    key: `package:${pkg.id}`,
    kind: "stage",
    name: pkg.badge,
    price: pkg.price,
    packageId: pkg.id,
  }));

  return [
    ...coatingOptions,
    ...standalone.filter((item) => item.kind === "coating"),
    ...stageOptions,
    ...standalone.filter((item) => item.kind === "stage"),
    ...standalone.filter((item) => item.kind === "servico"),
  ];
}

export async function resolveCatalogOption(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workshopId: string,
  services: QuoteServiceRow[],
  option: QuoteCatalogOption
): Promise<{ serviceId: string; name: string; kind: QuoteItemKind; price: number }> {
  if (option.serviceId) {
    return {
      serviceId: option.serviceId,
      name: option.name,
      kind: option.kind,
      price: option.price,
    };
  }

  if (!option.packageId) {
    throw new Error("Item de catálogo inválido.");
  }

  const kind = option.kind === "servico" ? "coating" : option.kind;
  const pkg =
    kind === "coating"
      ? loadCoatingPackages().find((item) => item.id === option.packageId)
      : loadStagePackages().find((item) => item.id === option.packageId);

  if (!pkg) {
    throw new Error("Pacote não encontrado.");
  }

  const catalogName = packageCatalogName(pkg, kind);
  const synced = await ensurePackageServicesInCatalog(
    supabase,
    workshopId,
    services.map((service) => ({
      id: service.id,
      name: service.name,
      price: service.price,
      duration_minutes: service.duration_minutes,
      active: service.active,
    }))
  );
  const matched = synced.find(
    (service) => service.name.trim().toLowerCase() === catalogName.toLowerCase()
  );

  if (!matched) {
    throw new Error("Não foi possível vincular o pacote a um serviço.");
  }

  return {
    serviceId: matched.id,
    name: option.name,
    kind: option.kind,
    price: option.price,
  };
}
