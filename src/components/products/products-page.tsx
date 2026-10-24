"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaretDown,
  CaretUp,
  CaretUpDown,
  CurrencyDollar,
  Broom,
  Drop,
  EnvelopeSimple,
  Faders,
  Funnel,
  MagnifyingGlass,
  Package,
  Stack,
  PencilSimple,
  Plus,
  Trash,
  Toolbox,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import {
  SUPPLIER_SELECT_FIELDS,
  SUPPLIER_SELECT_LEGACY,
  isMissingSupplierColumn,
  saveSupplierRow,
} from "@/lib/suppliers/save";
import {
  STOCK_KIND_LABEL,
  STOCK_KIND_OPTIONS,
  tracksStock,
  type StockItem,
  type StockKind,
} from "@/lib/products/stock";
import { formatMoneyInput, parseCurrencyInput } from "@/lib/utils/money";
import { StockHistoryTab } from "@/components/products/stock-history-tab";
import { StockMovementDialog } from "@/components/products/stock-movement-dialog";
import { recordMovement } from "@/lib/products/stock-repo";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { formatCurrency, formatPhone, normalizeOptionalPhone } from "@/lib/utils/format";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";
import {
  formatCnpj,
  isValidCnpj,
  lookupCnpj,
  onlyCnpjDigits,
} from "@/lib/cnpj/lookup";
import {
  createProductId,
  createProductPriceHistoryId,
  emptyProductForm,
  encodeUtensilDepreciation,
  getProductInitialStock,
  getProductRemainingStock,
  getUtensilAcquiredAt,
  getUtensilDepreciationMode,
  parseMoney,
  parsePositiveNumber,
  productTypeOptions,
  type ProductForm,
  type ProductItem,
  type ProductPriceHistoryReason,
  type ServiceProductUsage,
  type ProductTypeOption,
} from "@/lib/products/catalog";
import {
  clearLocalCatalogStorage,
  deleteSupabaseProduct,
  importLocalCatalogToSupabase,
  loadSupabaseCatalog,
  readLocalCatalogFromStorage,
  saveSupabaseProduct,
  saveSupabaseProductTypes,
} from "@/lib/products/supabase-catalog";

const PRODUCT_FORM_EXIT_MS = 180;
const PRODUCT_ICON_WEIGHT = "light" as const;

type ProductTypeFilter = string;
type ProductPageTab = "products" | "history" | "suppliers";
type ProductSortColumn = "name" | "value" | "stock";
type ProductSortDirection = "asc" | "desc";

type ProductDeleteConfirm =
  | { type: "product"; product: ProductItem; linkedServiceCount: number }
  | { type: "supplier"; supplier: Supplier }
  | null;

interface Supplier {
  id: string;
  workshop_id: string;
  /** Razão social. O que as telas mostram é `supplierLabel`. */
  name: string;
  tradeName?: string | null;
  address?: string | null;
  zipCode?: string | null;
  contactName?: string | null;
  phone: string | null;
  email?: string | null;
  document?: string | null;
  cityState?: string | null;
  category: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface SupplierForm {
  name: string;
  tradeName: string;
  contactName: string;
  phone: string;
  email: string;
  document: string;
  cityState: string;
  address: string;
  zipCode: string;
  notes: string;
}

/** Nome de fachada quando existe; senão a razão social. */
function supplierLabel(supplier: Pick<Supplier, "name" | "tradeName">) {
  return supplier.tradeName?.trim() || supplier.name;
}


const PRODUCT_FILTER_EXIT_MS = 300;

// Single source of truth for the products table column widths, applied via
// inline style to both the header row and every product row so they can
// never drift out of alignment regardless of CSS class generation.
const PRODUCTS_TABLE_GRID_TEMPLATE =
  "minmax(180px, 1fr) 90px 140px 80px 100px";


function ProductInlineFilterButton({
  value,
  options,
  open,
  onToggle,
  onClose,
  onChange,
  onClear,
}: {
  value: ProductTypeFilter;
  options: { value: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: ProductTypeFilter) => void;
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [panelReady, setPanelReady] = useState(false);
  const showPanel = open || closing;
  const panelVisible = panelReady && open && !closing;

  const requestClose = useCallback(() => {
    if (!open || closing) return;

    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, PRODUCT_FILTER_EXIT_MS);
  }, [closing, onClose, open]);

  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);

  useLayoutEffect(() => {
    if (!showPanel) {
      setPanelReady(false);
      return;
    }

    setPanelReady(false);
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setPanelReady(true));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showPanel]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        requestClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, requestClose]);

  function handleToggle() {
    if (open) {
      requestClose();
      return;
    }

    onToggle();
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={handleToggle}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          open
            ? "border-premium/40 bg-premium/10 text-premium"
            : "border-border/80 bg-card text-foreground/70 hover:bg-background hover:text-foreground"
        }`}
        aria-label="Abrir filtros de produtos"
        aria-expanded={open}
        title="Abrir filtros"
      >
        <Funnel size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
      </button>

      {showPanel && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Filtros de produtos"
          className={`product-inline-filter-card absolute left-0 top-full z-50 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card px-6 py-4 shadow-card transition-all duration-300 ease-out md:min-w-[24rem] ${
            panelVisible
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-2 opacity-0"
          }`}
          style={{
            boxShadow:
              "-6px 8px 24px rgba(15, 23, 42, 0.1), 0 4px 12px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div className="flex flex-wrap items-end gap-6">
            <Dropdown
              label="Categoria"
              value={value}
              options={options}
              onChange={(nextValue) => onChange(nextValue as ProductTypeFilter)}
              className="min-w-[14rem] flex-1 space-y-2"
            />
            <div className="flex shrink-0 flex-col gap-2 border-l border-border pl-5">
              <Button
                type="button"
                variant="secondary"
                onClick={onClear}
                className="min-w-[5.5rem]"
              >
                Limpar
              </Button>
              <Button
                type="button"
                onClick={requestClose}
                className="min-w-[5.5rem]"
              >
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const productPageTabs: { id: ProductPageTab; label: string }[] = [
  { id: "products", label: "Produtos" },
  { id: "history", label: "Histórico" },
  { id: "suppliers", label: "Fornecedores" },
];
const emptySupplierForm: SupplierForm = {
  name: "",
  tradeName: "",
  address: "",
  zipCode: "",
  contactName: "",
  phone: "",
  email: "",
  document: "",
  cityState: "",
  notes: "",
};

function sortSuppliers(list: Supplier[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeSuppliers(current: Supplier[], incoming: Supplier[]) {
  const byId = new Map(current.map((supplier) => [supplier.id, supplier]));
  incoming.forEach((supplier) => {
    const existing = byId.get(supplier.id);
    byId.set(supplier.id, existing ? { ...existing, ...supplier } : supplier);
  });
  return sortSuppliers(Array.from(byId.values()));
}

function mapSupplierRow(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id),
    workshop_id: String(row.workshop_id),
    name: String(row.name),
    tradeName: typeof row.trade_name === "string" ? row.trade_name : null,
    address: typeof row.address === "string" ? row.address : null,
    zipCode: typeof row.zip_code === "string" ? row.zip_code : null,
    contactName: typeof row.contact_name === "string" ? row.contact_name : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    email: typeof row.email === "string" ? row.email : null,
    document: typeof row.document === "string" ? row.document : null,
    cityState: typeof row.city_state === "string" ? row.city_state : null,
    category: String(row.category ?? "Outros"),
    notes: typeof row.notes === "string" ? row.notes : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** Um ícone por categoria: a lista separa os três de relance. */
const STOCK_KIND_ICON: Record<StockKind, typeof Drop> = {
  liquido: Drop,
  utensilio: Broom,
  patrimonio: Toolbox,
};

const STOCK_KIND_TONE: Record<StockKind, string> = {
  liquido: "bg-primary/10 text-primary",
  utensilio: "bg-success/10 text-success",
  patrimonio: "bg-premium/10 text-premium",
};

function StockKindIcon({ kind, size }: { kind: StockKind; size: number }) {
  const Icon = STOCK_KIND_ICON[kind];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg ${STOCK_KIND_TONE[kind]}`}
      style={{ width: size, height: size }}
      title={STOCK_KIND_LABEL[kind]}
    >
      <Icon size={Math.round(size * 0.5)} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
    </span>
  );
}

/** O produto do cadastro lido como item de estoque. */
function stockItemOf(product: ProductItem): StockItem {
  const kind: StockKind =
    product.kind ?? (product.type === "liquid" ? "liquido" : "utensilio");
  return {
    id: product.id,
    name: product.name,
    kind,
    onHand: product.onHand ?? 0,
    minOnHand: product.minOnHand ?? null,
    unitLabel: product.unitLabel || (kind === "liquido" ? "frasco" : "unidade"),
    packageVolumeMl: product.packageVolumeMl ?? null,
    unitCost: 0,
    resaleValue: product.resaleValue ?? null,
    acquiredOn: product.acquiredOn ?? null,
    supplierId: product.supplierId ?? null,
    photoUrl: product.photoUrl ?? null,
  };
}

function getSupplierExtra(supplier: Supplier, key: keyof Supplier) {
  const value = supplier[key];
  return typeof value === "string" ? value : "";
}

const PRODUCT_PHOTO_MAX_SIZE = 480;
const PRODUCT_PHOTO_QUALITY = 0.72;
const PRODUCT_PHOTO_COMPACT_THRESHOLD = 180_000;

function resizeProductImage(source: File | string) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = source instanceof File ? URL.createObjectURL(source) : null;

    image.onload = () => {
      const scale = Math.min(
        1,
        PRODUCT_PHOTO_MAX_SIZE / Math.max(image.width, image.height)
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Não foi possível processar a foto."));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", PRODUCT_PHOTO_QUALITY));
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível carregar a foto."));
    };

    image.src = objectUrl ?? (source as string);
  });
}

async function compactProductPhoto(product: ProductItem) {
  if (
    !product.photoUrl?.startsWith("data:image/") ||
    product.photoUrl.length <= PRODUCT_PHOTO_COMPACT_THRESHOLD
  ) {
    return product;
  }

  try {
    return {
      ...product,
      photoUrl: await resizeProductImage(product.photoUrl),
    };
  } catch {
    return product;
  }
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function ProductCostDisplay({
  product,
  align = "right",
  compact = false,
}: {
  product: ProductItem;
  align?: "left" | "right";
  compact?: boolean;
}) {
  const unitCost = parseMoney(product.totalCost || "0");
  const stock = stockItemOf(product);
  // O custo é de UMA embalagem; sozinho, ao lado de "3 frascos", parecia
  // dizer que o estoque inteiro vale isso.
  const stockValue = tracksStock(stock.kind) ? unitCost * stock.onHand : null;

  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p
        className={
          compact
            ? "text-sm font-semibold text-foreground"
            : "mt-1 font-bold text-foreground"
        }
      >
        {formatCurrency(unitCost)}
      </p>
      {stockValue !== null && stock.onHand !== 1 && (
        <p className="mt-0.5 text-[11px] font-medium text-muted">
          {formatCurrency(stockValue)} em estoque
        </p>
      )}
    </div>
  );
}

function SortableColumnHeader({
  label,
  column,
  activeColumn,
  direction,
  onSort,
  align = "left",
  icon: HeaderIcon,
}: {
  label: string;
  column: ProductSortColumn;
  activeColumn: ProductSortColumn;
  direction: ProductSortDirection;
  onSort: (column: ProductSortColumn) => void;
  align?: "left" | "right";
  icon?: React.ComponentType<{ size?: number; weight?: "light"; "aria-hidden"?: boolean }>;
}) {
  const isActive = activeColumn === column;

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-foreground ${
        align === "right" ? "justify-end" : ""
      } ${isActive ? "text-foreground" : "text-muted"}`}
    >
      {HeaderIcon && <HeaderIcon size={13} weight={PRODUCT_ICON_WEIGHT} aria-hidden />}
      {label}
      {isActive ? (
        direction === "asc" ? (
          <CaretUp size={12} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
        ) : (
          <CaretDown size={12} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
        )
      ) : (
        <CaretUpDown
          size={12}
          weight={PRODUCT_ICON_WEIGHT}
          className="opacity-40"
          aria-hidden
        />
      )}
    </button>
  );
}

function ProductStatChip({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 shadow-card">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="text-sm font-bold leading-tight text-foreground">{value}</p>
      </div>
    </div>
  );
}



function SupplierDetail({
  label,
  value,
  href,
  icon,
}: {
  label: string;
  value: string;
  href?: string;
  icon?: React.ReactNode;
}) {
  const displayValue = value.trim() || "—";
  const content = (
    <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-foreground">
      {icon}
      <span className="truncate">{displayValue}</span>
    </span>
  );

  return (
    <div className="rounded-lg bg-background px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">
        {label}
      </p>
      <div className="mt-1">
        {href && value.trim() ? (
          <a
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noreferrer" : undefined}
            className="text-primary transition-colors hover:text-primary-hover"
          >
            {content}
          </a>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

export function ProductsPage() {
  const supabase = useMemo(() => createClient(), []);
  const today = useMemo(() => new Date(), []);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [catalogSyncReady, setCatalogSyncReady] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(emptySupplierForm);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  /** Último CNPJ consultado: evita repetir a chamada a cada tecla depois do 14º dígito. */
  const lastCnpjLookupRef = useRef("");
  const [cnpjMessage, setCnpjMessage] = useState<
    { tone: "error" | "warning" | "success"; text: string } | null
  >(null);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [typeOptions, setTypeOptions] =
    useState<ProductTypeOption[]>(productTypeOptions);
  const [serviceProductUsages, setServiceProductUsages] = useState<
    Record<string, ServiceProductUsage[]>
  >({});
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState<ProductSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<ProductSortDirection>("asc");
  const [activeProductTab, setActiveProductTab] = useState<ProductPageTab>("products");
  /** Conferência acontece na própria lista: respeita busca e filtro. */
  const [reviewing, setReviewing] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [savingReview, setSavingReview] = useState(false);
  const [movementTarget, setMovementTarget] = useState<StockItem | null>(null);
  const [showProductFilter, setShowProductFilter] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formClosing, setFormClosing] = useState(false);
  const [formAnimationKey, setFormAnimationKey] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProductForm);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProductDeleteConfirm>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const closeFormTimeoutRef = useRef<number | null>(null);
  const isCatalogLoading =
    !catalogSyncReady && !error && (!suppliersLoaded || Boolean(workshopId));

  function clearCloseFormTimeout() {
    if (closeFormTimeoutRef.current) {
      window.clearTimeout(closeFormTimeoutRef.current);
      closeFormTimeoutRef.current = null;
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPageData() {
      const { workshopId: profileWorkshopId, error: profileError } =
        await fetchOwnWorkshop(supabase);

      if (cancelled) return;

      if (profileError || !profileWorkshopId) {
        setSupplierError(profileError?.message ?? "Oficina não encontrada.");
        setSuppliersLoaded(true);
        setCatalogSyncReady(true);
        return;
      }

      const resolvedWorkshopId = profileWorkshopId;
      setWorkshopId(resolvedWorkshopId);

      try {
        const localCatalog = readLocalCatalogFromStorage();
        if (localCatalog.hasData) {
          await importLocalCatalogToSupabase(
            supabase,
            resolvedWorkshopId,
            localCatalog.products,
            localCatalog.typeOptions,
            localCatalog.serviceProductUsages
          );
          clearLocalCatalogStorage();
        }

        const loadSuppliers = async () => {
          const full = await supabase
            .from("suppliers")
            .select(SUPPLIER_SELECT_FIELDS)
            .eq("workshop_id", resolvedWorkshopId)
            .order("name", { ascending: true });
          if (!isMissingSupplierColumn(full.error)) return full;
          return supabase
            .from("suppliers")
            .select(SUPPLIER_SELECT_LEGACY)
            .eq("workshop_id", resolvedWorkshopId)
            .order("name", { ascending: true });
        };

        const [suppliersResult, catalog] = await Promise.all([
          loadSuppliers(),
          loadSupabaseCatalog(supabase, resolvedWorkshopId),
        ]);

        if (cancelled) return;

        if (suppliersResult.error) {
          setSupplierError(suppliersResult.error.message);
        } else {
          setSuppliers(
            sortSuppliers(
              ((suppliersResult.data as Record<string, unknown>[] | null) ?? []).map(
                mapSupplierRow
              )
            )
          );
        }

        setProducts(catalog.products);
        setTypeOptions(catalog.typeOptions);
        setServiceProductUsages(catalog.serviceProductUsages);
        setCatalogSyncReady(true);
        setSuppliersLoaded(true);

        void Promise.all(catalog.products.map(compactProductPhoto)).then(
          (compactProducts) => {
            if (!cancelled) {
              setProducts(compactProducts);
            }
          }
        );
      } catch (err) {
        if (cancelled) return;

        setCatalogSyncReady(true);
        setSuppliersLoaded(true);
        setError(
          err instanceof Error
            ? `Persistência de produtos no Supabase indisponível: ${err.message}`
            : "Persistência de produtos no Supabase indisponível."
        );
      }
    }

    void loadPageData();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!catalogSyncReady || !workshopId) return;

    void saveSupabaseProductTypes(supabase, workshopId, typeOptions).catch((err) => {
      setError(
        err instanceof Error
          ? `Tipos de produto não sincronizaram: ${err.message}`
          : "Tipos de produto não sincronizaram."
      );
    });
  }, [catalogSyncReady, supabase, typeOptions, workshopId]);

  useEffect(() => {
    return clearCloseFormTimeout;
  }, []);

  function showForm() {
    clearCloseFormTimeout();
    setFormClosing(false);
    setFormOpen(true);
    setFormAnimationKey((current) => current + 1);
  }

  function openCreateForm() {
    setEditingProduct(null);
    setForm(emptyProductForm);
    setError(null);
    setTypeError(null);
    showForm();
  }

  function openEditForm(product: ProductItem) {
    setEditingProduct(product);
    setForm({
      name: product.name,
      type: product.type,
      volumeMl: product.volumeMl,
      usagePerWashMl: product.usagePerWashMl,
      quantity: product.quantity,
      durabilityWashes: product.durabilityWashes,
      totalCost: product.totalCost,
      photoUrl: product.photoUrl ?? "",
      supplierId: product.supplierId ?? "",
      depreciationMode: getUtensilDepreciationMode(product),
      acquiredAt: product.acquiredOn ?? getUtensilAcquiredAt(product),
      kind: stockItemOf(product).kind,
      onHand: String(product.onHand ?? 0),
      minOnHand: product.minOnHand === null || product.minOnHand === undefined
        ? ""
        : String(product.minOnHand),
      unitLabel: stockItemOf(product).unitLabel,
      packageVolumeMl:
        product.packageVolumeMl === null || product.packageVolumeMl === undefined
          ? ""
          : String(product.packageVolumeMl),
      resaleValue:
        product.resaleValue === null || product.resaleValue === undefined
          ? ""
          : formatMoneyInput(product.resaleValue),
    });
    setError(null);
    setTypeError(null);
    showForm();
  }

  function closeForm() {
    if (!formOpen) return;

    clearCloseFormTimeout();
    setFormClosing(true);

    closeFormTimeoutRef.current = window.setTimeout(() => {
      setEditingProduct(null);
      setForm(emptyProductForm);
      setError(null);
      setTypeError(null);
      setFormOpen(false);
      setFormClosing(false);
      closeFormTimeoutRef.current = null;
    }, PRODUCT_FORM_EXIT_MS);
  }

  useBodyScrollLock(formOpen);

  useEffect(() => {
    if (!formOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || formClosing) return;
      event.preventDefault();
      closeForm();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [formClosing, formOpen]);

  function updateForm(patch: Partial<ProductForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }


  const persistedSuppliers = suppliers.filter(
    (supplier) => supplier.workshop_id !== "local"
  );
  const supplierOptions = [
    { value: "", label: "Sem fornecedor" },
    ...persistedSuppliers.map((supplier) => ({
      value: supplier.id,
      label: supplierLabel(supplier),
    })),
  ];

  function getSupplierName(supplierId?: string) {
    if (!supplierId) return "Sem fornecedor";
    const supplier = suppliers.find((item) => item.id === supplierId);
    return supplier ? supplierLabel(supplier) : "Fornecedor removido";
  }

  function updateSupplierForm(patch: Partial<SupplierForm>) {
    setSupplierForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleCnpjLookup(raw?: string) {
    const value = raw ?? supplierForm.document;
    lastCnpjLookupRef.current = onlyCnpjDigits(value);
    setCnpjMessage(null);
    setCnpjLoading(true);
    try {
      const data = await lookupCnpj(value);
      setSupplierForm((prev) => ({
        ...prev,
        document: data.cnpj,
        // O que já foi digitado manda: a consulta preenche o que está vazio,
        // não reescreve o que você corrigiu à mão.
        name: prev.name.trim() || data.razaoSocial,
        tradeName: prev.tradeName.trim() || data.nomeFantasia,
        phone: prev.phone.trim() || data.telefone,
        email: prev.email.trim() || data.email,
        cityState: prev.cityState.trim() || data.cidadeUf,
        address: prev.address.trim() || data.endereco,
        zipCode: prev.zipCode.trim() || data.cep,
      }));
      setCnpjMessage(
        data.ativa
          ? { tone: "success", text: `${data.razaoSocial} · dados preenchidos.` }
          : {
              tone: "warning",
              text: `${data.razaoSocial} · situação ${data.situacao.toLowerCase()} na Receita.`,
            }
      );
    } catch (err) {
      setCnpjMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Não foi possível consultar.",
      });
    } finally {
      setCnpjLoading(false);
    }
  }

  /** Zera o que sobrou da consulta anterior ao abrir o formulário. */
  function resetCnpjLookup(document = "") {
    lastCnpjLookupRef.current = onlyCnpjDigits(document);
    setCnpjMessage(null);
  }

  function openSupplierForm() {
    setEditingSupplierId(null);
    setSupplierForm(emptySupplierForm);
    setSupplierError(null);
    resetCnpjLookup();
    setSupplierFormOpen(true);
  }

  function startEditingSupplier(supplier: Supplier) {
    // Editando: o CNPJ que já está salvo não dispara busca sozinho.
    resetCnpjLookup(supplier.document ?? "");
    setEditingSupplierId(supplier.id);
    setSupplierForm({
      name: supplier.name,
      tradeName: getSupplierExtra(supplier, "tradeName"),
      address: getSupplierExtra(supplier, "address"),
      zipCode: getSupplierExtra(supplier, "zipCode"),
      contactName: getSupplierExtra(supplier, "contactName"),
      phone: supplier.phone ? formatPhone(supplier.phone) : "",
      email: getSupplierExtra(supplier, "email"),
      document: getSupplierExtra(supplier, "document"),
      cityState: getSupplierExtra(supplier, "cityState"),
      notes: supplier.notes ?? "",
    });
    setSupplierError(null);
    setSupplierFormOpen(true);
  }

  function resetSupplierForm() {
    setEditingSupplierId(null);
    setSupplierForm(emptySupplierForm);
    setSupplierError(null);
    setSupplierFormOpen(false);
  }

  async function handleSaveSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supplierForm.name.trim()) {
      setSupplierError("Informe o nome do fornecedor.");
      return;
    }

    if (!workshopId) {
      setSupplierError("Oficina não encontrada.");
      return;
    }

    setSavingSupplier(true);
    setSupplierError(null);

    let normalizedPhone: string | null = null;

    try {
      normalizedPhone = normalizeOptionalPhone(supplierForm.phone);
    } catch (err) {
      setSavingSupplier(false);
      setSupplierError(
        err instanceof Error ? err.message : "Informe um telefone válido com DDD."
      );
      return;
    }

    const now = new Date().toISOString();
    const existingSupplier = suppliers.find((supplier) => supplier.id === editingSupplierId);
    const payload = {
      workshop_id: workshopId,
      name: supplierForm.name.trim(),
      trade_name: supplierForm.tradeName.trim() || null,
      address: supplierForm.address.trim() || null,
      zip_code: supplierForm.zipCode.trim() || null,
      contact_name: supplierForm.contactName.trim() || null,
      phone: normalizedPhone,
      email: supplierForm.email.trim() || null,
      document: supplierForm.document.trim() || null,
      city_state: supplierForm.cityState.trim() || null,
      category: existingSupplier?.category ?? "Outros",
      notes: supplierForm.notes.trim() || null,
      updated_at: now,
    };

    const result = await saveSupplierRow(
      supabase,
      workshopId,
      payload,
      editingSupplierId
    );

    setSavingSupplier(false);

    if (result.error || !result.data) {
      setSupplierError(
        result.error?.message ?? "Não foi possível salvar o fornecedor no Supabase."
      );
      return;
    }

    const supplier = mapSupplierRow(
      result.data as unknown as Record<string, unknown>
    );

    setSuppliers((prev) =>
      editingSupplierId
        ? sortSuppliers([
            ...prev.filter((item) => item.id !== editingSupplierId),
            supplier,
          ])
        : mergeSuppliers(prev, [supplier])
    );
    setSelectedSupplierId(supplier.id);
    resetSupplierForm();
  }

  function requestDeleteSupplier(supplier: Supplier) {
    if (products.some((product) => product.supplierId === supplier.id)) {
      setSupplierError("Não é possível excluir um fornecedor vinculado a produtos.");
      return;
    }

    setDeleteConfirm({ type: "supplier", supplier });
  }

  async function executeDeleteSupplier(supplier: Supplier) {
    setDeletingItem(true);

    try {
      if (supplier.workshop_id !== "local") {
        await supabase.from("suppliers").delete().eq("id", supplier.id);
      }

      setSuppliers((prev) => prev.filter((item) => item.id !== supplier.id));
      if (selectedSupplierId === supplier.id) {
        setSelectedSupplierId(null);
      }
      if (editingSupplierId === supplier.id) {
        resetSupplierForm();
      }
      setDeleteConfirm(null);
    } finally {
      setDeletingItem(false);
    }
  }




  function createPriceHistoryEntry(
    price: string,
    reason: ProductPriceHistoryReason
  ) {
    return {
      id: createProductPriceHistoryId(),
      price,
      date: new Date().toISOString(),
      reason,
    };
  }

  function validateProductForm() {
    if (!form.name.trim()) {
      throw new Error("Informe o nome do produto.");
    }

    parseMoney(form.totalCost || "0");

    if (form.type === "liquid") {
      parsePositiveNumber(form.volumeMl);
      return;
    }

    parsePositiveNumber(form.quantity);

    if (form.type !== "utensil" || form.depreciationMode === "none") {
      return;
    }

    if (form.depreciationMode === "time") {
      if (!form.acquiredAt) {
        throw new Error("Informe a data de aquisição.");
      }
      parsePositiveNumber(form.durabilityWashes);
    }
  }

  async function handleSaveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    try {
      validateProductForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Informe os dados do produto.");
      return;
    }

    const persistedSupplierId =
      form.supplierId &&
      persistedSuppliers.some((supplier) => supplier.id === form.supplierId)
        ? form.supplierId
        : undefined;

    if (form.supplierId && !persistedSupplierId) {
      setError(
        "O fornecedor selecionado não está salvo no Supabase. Cadastre-o na aba Fornecedores antes de vincular ao produto."
      );
      return;
    }

    const isUtensil = form.type === "utensil";
    const depreciationMode = isUtensil ? form.depreciationMode : "none";
    const baseProduct: ProductItem = {
      id: editingProduct?.id ?? createProductId(),
      name: form.name.trim(),
      type: form.type,
      volumeMl: form.type === "liquid" ? form.volumeMl : "",
      usagePerWashMl: isUtensil
        ? encodeUtensilDepreciation(depreciationMode, form.acquiredAt)
        : "",
      quantity: form.type === "liquid" ? "" : form.quantity,
      durabilityWashes:
        isUtensil && depreciationMode === "time" ? form.durabilityWashes : "",
      totalCost: form.totalCost,
      photoUrl: form.photoUrl || undefined,
      supplierId: persistedSupplierId,
      priceHistory: editingProduct?.priceHistory ?? [],
      createdAt: editingProduct?.createdAt,
    };
    const previousPrice = editingProduct
      ? parseMoney(editingProduct.totalCost || "0")
      : null;
    const nextPrice = parseMoney(form.totalCost || "0");
    if (
      editingProduct &&
      previousPrice !== nextPrice &&
      editingProduct.totalCost
    ) {
      baseProduct.priceHistory = [
        createPriceHistoryEntry(editingProduct.totalCost, "edited"),
        ...(editingProduct.priceHistory ?? []),
      ];
    }
    const initialStock = getProductInitialStock(baseProduct);
    const preservedRemaining =
      editingProduct &&
      editingProduct.type === baseProduct.type &&
      getUtensilDepreciationMode(editingProduct) === depreciationMode
        ? getProductRemainingStock(editingProduct)
        : initialStock;
    // Campos do modelo por embalagem. `onHand` aqui é o que você declarou no
    // cadastro; depois dele, só entrada, baixa ou revisão mudam o saldo.
    const onHand = Number(form.onHand.replace(",", ".")) || 0;
    const minOnHand = form.minOnHand.trim()
      ? Number(form.minOnHand.replace(",", "."))
      : null;
    let resaleValue: number | null = null;
    if (form.kind === "patrimonio" && form.resaleValue.trim()) {
      try {
        resaleValue = parseCurrencyInput(form.resaleValue);
      } catch {
        setError("Informe um valor de revenda válido.");
        return;
      }
    }

    const nextProduct: ProductItem = {
      ...baseProduct,
      stockRemaining: String(Math.min(initialStock, preservedRemaining)),
      kind: form.kind,
      onHand: form.kind === "patrimonio" ? 0 : onHand,
      minOnHand: form.kind === "patrimonio" ? null : minOnHand,
      unitLabel: form.unitLabel.trim() || (form.kind === "liquido" ? "frasco" : "unidade"),
      packageVolumeMl:
        form.kind === "liquido" && form.packageVolumeMl.trim()
          ? Number(form.packageVolumeMl)
          : null,
      resaleValue,
      acquiredOn: form.kind === "patrimonio" && form.acquiredAt ? form.acquiredAt : null,
    };

    try {
      await saveSupabaseProduct(supabase, workshopId, nextProduct);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível salvar no Supabase: ${err.message}`
          : "Não foi possível salvar no Supabase."
      );
      return;
    }

    setProducts((prev) =>
      editingProduct
        ? prev.map((product) =>
            product.id === editingProduct.id ? nextProduct : product
          )
        : [nextProduct, ...prev]
    );
    closeForm();
  }


  function requestDeleteProduct(product: ProductItem) {
    const linkedServiceCount = Object.values(serviceProductUsages).filter(
      (usages) => usages.some((u) => u.productId === product.id)
    ).length;
    setDeleteConfirm({ type: "product", product, linkedServiceCount });
  }

  async function executeDeleteProduct(product: ProductItem) {
    setDeletingItem(true);
    setError(null);

    try {
      // Null out product_id in financial_transactions so historical records
      // keep the description text but drop the FK reference
      await supabase
        .from("financial_transactions")
        .update({ product_id: null })
        .eq("product_id", product.id);

      // Remove the product from all service definitions
      await supabase
        .from("service_product_usages")
        .delete()
        .eq("product_id", product.id);

      // Delete the product itself
      await deleteSupabaseProduct(supabase, product.id);

      // Update local state: remove product and strip it from all service usages
      setProducts((prev) => prev.filter((item) => item.id !== product.id));
      setServiceProductUsages((prev) => {
        const next: typeof prev = {};
        for (const [serviceId, usages] of Object.entries(prev)) {
          next[serviceId] = usages.filter((u) => u.productId !== product.id);
        }
        return next;
      });

      if (editingProduct?.id === product.id) {
        closeForm();
      }

      setDeleteConfirm(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível excluir: ${err.message}`
          : "Não foi possível excluir o produto."
      );
    } finally {
      setDeletingItem(false);
    }
  }







  function handleSort(column: ProductSortColumn) {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredProducts = products.filter((product) => {
    if (typeFilter !== "all" && stockItemOf(product).kind !== typeFilter) {
      return false;
    }
    if (!normalizedSearch) return true;
    return product.name.toLowerCase().includes(normalizedSearch);
  });
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let comparison = 0;
    if (sortColumn === "name") {
      comparison = a.name.localeCompare(b.name, "pt-BR");
    } else if (sortColumn === "value") {
      comparison =
        parseMoney(a.totalCost || "0") - parseMoney(b.totalCost || "0");
    } else {
      comparison = (a.onHand ?? 0) - (b.onHand ?? 0);
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
  // O custo cadastrado é de UMA embalagem. Investido é ele vezes o que há em
  // mãos — somar o unitário dava o valor de um frasco de cada produto.
  const totalInvested = filteredProducts.reduce((total, product) => {
    const unit = parseMoney(product.totalCost || "0");
    const stock = stockItemOf(product);
    if (!tracksStock(stock.kind)) return total + unit;
    return total + unit * stock.onHand;
  }, 0);
  // Só o que você digitou e ficou diferente do saldo atual.
  const countedChanges = filteredProducts
    .map((product) => {
      const stock = stockItemOf(product);
      if (!tracksStock(stock.kind)) return null;
      const raw = counted[product.id];
      if (raw === undefined || raw.trim() === "") return null;
      const value = Number(raw.replace(",", "."));
      if (!Number.isFinite(value) || value < 0 || value === stock.onHand) {
        return null;
      }
      return { product, stock, value };
    })
    .filter(
      (row): row is { product: ProductItem; stock: StockItem; value: number } =>
        row !== null
    );

  /**
   * Troca a categoria de vários produtos de uma vez. Patrimônio não conta
   * estoque, então o saldo vai a zero ao virar patrimônio — do mesmo jeito
   * que o cadastro faz quando você muda um só.
   */


  async function handleSaveReview() {
    if (savingReview || !workshopId || countedChanges.length === 0) return;
    setSavingReview(true);
    setError(null);
    try {
      for (const { stock, value } of countedChanges) {
        await recordMovement(supabase, workshopId, stock.onHand, {
          productId: stock.id,
          kind: "revisao",
          quantity: value,
          occurredOn: dateKey(today),
          notes: "Conferência de estoque",
        });
      }
      setProducts((prev) =>
        prev.map((product) => {
          const change = countedChanges.find(
            (row) => row.product.id === product.id
          );
          return change ? { ...product, onHand: change.value } : product;
        })
      );
      setCounted({});
      setReviewing(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível salvar a contagem."
      );
    } finally {
      setSavingReview(false);
    }
  }

  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;
  const productTypeFilterOptions = [
    { value: "all", label: "Todos" },
    ...STOCK_KIND_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ];

  return (
    <>
      <div className="mb-6 border-b border-border">
        <div className="flex items-center gap-6">
          {productPageTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveProductTab(tab.id);
                setShowProductFilter(false);
              }}
              className={`border-b-2 px-0 pb-3 pt-1 text-sm transition-all duration-200 ease-out ${
                activeProductTab === tab.id
                  ? "border-primary font-bold text-primary"
                  : "border-transparent font-semibold text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeProductTab === "products" && (
        <div key="products-tab" className="product-tab-panel-enter">
      <div className="sticky top-0 z-20 mb-6 flex flex-col gap-4 bg-background/95 py-2 backdrop-blur-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <ProductInlineFilterButton
            value={typeFilter}
            options={productTypeFilterOptions}
            open={showProductFilter}
            onToggle={() => setShowProductFilter(true)}
            onClose={() => setShowProductFilter(false)}
            onChange={setTypeFilter}
            onClear={() => setTypeFilter("all")}
          />
          <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
            <MagnifyingGlass
              size={15}
              weight={PRODUCT_ICON_WEIGHT}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar produto…"
              aria-label="Buscar produto"
              className="h-9 w-full rounded-lg border border-border/80 bg-card pl-9 pr-8 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X size={13} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
              </button>
            )}
          </div>
        </div>

        {products.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex flex-wrap items-center gap-2.5">
              <ProductStatChip
                label="Total investido"
                value={formatCurrency(totalInvested)}
                icon={<CurrencyDollar size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />}
              />
              <ProductStatChip
                label="Produtos no estoque"
                value={String(filteredProducts.length)}
                icon={<Package size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />}
              />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {reviewing ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setReviewing(false);
                      setCounted({});
                    }}
                    disabled={savingReview}
                    className="w-full sm:w-auto"
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="success"
                    onClick={() => void handleSaveReview()}
                    loading={savingReview}
                    disabled={countedChanges.length === 0}
                    className="w-full sm:w-auto"
                  >
                    {countedChanges.length > 1
                      ? `Salvar ${countedChanges.length} correções`
                      : "Salvar contagem"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setReviewing(true)}
                    className="w-full sm:w-auto"
                  >
                    <Faders size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                    Conferir estoque
                  </Button>
                  <Button
                    variant="success"
                    onClick={openCreateForm}
                    className="w-full sm:w-auto"
                  >
                    <Plus size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                    Adicionar produto
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {error && !formOpen && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section>
          {isCatalogLoading ? (
            <div className="rounded-lg border border-border bg-card shadow-card py-16 text-center text-sm text-muted shadow-card">
              Carregando produtos...
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card shadow-card py-16 text-center shadow-card">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
                <Package size={28} weight={PRODUCT_ICON_WEIGHT} className="text-success" aria-hidden />
              </div>
              <p className="font-medium text-foreground">
                Nenhum produto cadastrado
              </p>
              <p className="mt-1 text-sm text-muted">
                Crie seu catálogo para usar nos serviços.
              </p>
              <Button variant="success" className="mt-4" onClick={openCreateForm}>
                <Plus size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                Adicionar produto
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card py-14 text-center shadow-card">
              <p className="font-medium text-foreground">
                Nenhum produto encontrado
              </p>
              <p className="mt-1 text-sm text-muted">
                Troque o filtro para ver outros produtos cadastrados.
              </p>
            </div>
          ) : (
            <>
              {/* Tabela (md+) */}
              <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow-card md:block">
                <div className="overflow-x-auto">
                  <div className="min-w-[590px]">
                    <div
                      className="grid items-center gap-4 border-b border-border bg-background/60 px-4 py-3"
                      style={{ gridTemplateColumns: PRODUCTS_TABLE_GRID_TEMPLATE }}
                    >
                      <SortableColumnHeader
                        label="Produto"
                        icon={Package}
                        column="name"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Embalagem
                      </span>
                      <SortableColumnHeader
                        label="Custo unitário"
                        icon={CurrencyDollar}
                        column="value"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableColumnHeader
                        label="Unidades"
                        icon={Stack}
                        column="stock"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        align="right"
                      />
                      <span className="text-right text-xs font-semibold uppercase tracking-wide text-muted">
                        Ações
                      </span>
                    </div>

                    {sortedProducts.map((product) => {
                      const stock = stockItemOf(product);
                      const isLiquid = stock.kind === "liquido";

                      return (
                        <div
                          key={product.id}
                          className="group relative z-0 grid items-center gap-4 border-b border-border/70 px-4 py-3 transition-colors last:border-b-0 hover:z-50 hover:bg-background/70"
                          style={{ gridTemplateColumns: PRODUCTS_TABLE_GRID_TEMPLATE }}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <StockKindIcon kind={stock.kind} size={36} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {product.name}
                              </p>
                              <p className="truncate text-xs font-medium text-muted">
                                {STOCK_KIND_LABEL[stock.kind]}
                                {product.supplierId
                                  ? ` • ${getSupplierName(product.supplierId)}`
                                  : ""}
                              </p>
                            </div>
                          </div>

                          <p className="text-sm text-foreground">
                            {isLiquid && stock.packageVolumeMl
                              ? `${stock.packageVolumeMl} ml`
                              : "—"}
                          </p>

                          <ProductCostDisplay product={product} compact />

                          {/* Contagem, não barra: o saldo só muda por entrada,
                              baixa ou revisão. */}
                          {/* Só o número: a unidade é o cabeçalho da coluna.
                              Conferindo, ele vira campo na própria linha. */}
                          <div className="min-w-0 text-right">
                            {!tracksStock(stock.kind) ? (
                              <p className="text-sm text-muted" title="Patrimônio">
                                —
                              </p>
                            ) : reviewing ? (
                              <input
                                inputMode="decimal"
                                value={counted[product.id] ?? ""}
                                onChange={(event) =>
                                  setCounted((prev) => ({
                                    ...prev,
                                    [product.id]: event.target.value,
                                  }))
                                }
                                placeholder={String(stock.onHand)}
                                aria-label={`Quantas unidades de ${product.name}`}
                                className={`w-20 rounded-md border bg-input px-2 py-1.5 text-right text-sm tabular-nums text-foreground outline-none focus:ring-2 focus:ring-accent/20 ${
                                  countedChanges.some(
                                    (row) => row.product.id === product.id
                                  )
                                    ? "border-success"
                                    : "border-border"
                                }`}
                              />
                            ) : (
                              <p className="text-sm font-semibold tabular-nums text-foreground">
                                {stock.onHand}
                              </p>
                            )}
                          </div>

                          <div className="flex justify-end gap-1.5">
                            {tracksStock(stock.kind) && (
                              <button
                                type="button"
                                onClick={() => setMovementTarget(stock)}
                                className="rounded-lg bg-success/10 p-1.5 text-success transition-colors hover:bg-success hover:text-white"
                                title="Baixa e histórico"
                                aria-label={`Baixa e histórico de ${product.name}`}
                              >
                                <Faders size={15} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditForm(product)}
                              className="rounded-lg bg-success/10 p-1.5 text-success transition-colors hover:bg-success hover:text-white"
                              title="Editar produto"
                            >
                              <PencilSimple size={15} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteProduct(product)}
                              className="rounded-lg bg-danger/10 p-1.5 text-danger transition-colors hover:bg-danger hover:text-white"
                              title="Excluir produto"
                            >
                              <Trash size={15} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cards (mobile) */}
              <div className="space-y-4 md:hidden">
                {sortedProducts.map((product) => {
                  const stock = stockItemOf(product);
                  const isLiquid = stock.kind === "liquido";

                  return (
                    <article
                      key={product.id}
                      className="relative z-0 rounded-lg border border-border bg-card shadow-card p-5 transition-all hover:z-50 hover:-translate-y-0.5 hover:shadow-card-hover"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <StockKindIcon kind={stock.kind} size={40} />
                          <div>
                            <h2 className="font-semibold text-foreground">
                              {product.name}
                            </h2>
                            <p className="text-xs font-medium text-muted">
                              {STOCK_KIND_LABEL[stock.kind]}
                              {product.supplierId
                                ? ` • ${getSupplierName(product.supplierId)}`
                                : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {tracksStock(stock.kind) && (
                            <button
                              type="button"
                              onClick={() => setMovementTarget(stock)}
                              className="rounded-lg bg-success/10 p-2 text-success transition-colors hover:bg-success hover:text-white"
                              title="Baixa e histórico"
                              aria-label={`Baixa e histórico de ${product.name}`}
                            >
                              <Faders size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditForm(product)}
                            className="rounded-lg bg-success/10 p-2 text-success transition-colors hover:bg-success hover:text-white"
                            title="Editar produto"
                          >
                            <PencilSimple size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteProduct(product)}
                            className="rounded-lg bg-danger/10 p-2 text-danger transition-colors hover:bg-danger hover:text-white"
                            title="Excluir produto"
                          >
                            <Trash size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-lg bg-background px-4 py-3">
                          <span className="font-medium text-muted">
                            {isLiquid ? "Embalagem" : "Tipo"}
                          </span>
                          <p className="mt-1 font-bold text-foreground">
                            {isLiquid && stock.packageVolumeMl
                              ? `${stock.packageVolumeMl} ml`
                              : STOCK_KIND_LABEL[stock.kind]}
                          </p>
                        </div>
                        <div className="rounded-lg bg-background px-4 py-3">
                          <span className="font-medium text-muted">Valor</span>
                          <ProductCostDisplay product={product} align="left" />
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg bg-background px-4 py-3">
                        {tracksStock(stock.kind) ? (
                          <>
                            {/* No celular não há cabeçalho de coluna, então a
                                unidade é o rótulo e embaixo vai só o número. */}
                            <p className="text-xs font-medium uppercase tracking-wide text-muted">
                              Unidades
                            </p>
                            {reviewing ? (
                              <input
                                inputMode="decimal"
                                value={counted[product.id] ?? ""}
                                onChange={(event) =>
                                  setCounted((prev) => ({
                                    ...prev,
                                    [product.id]: event.target.value,
                                  }))
                                }
                                placeholder={String(stock.onHand)}
                                aria-label={`Quantas unidades de ${product.name}`}
                                className={`mt-1 w-24 rounded-md border bg-input px-2 py-1.5 text-sm tabular-nums text-foreground outline-none focus:ring-2 focus:ring-accent/20 ${
                                  countedChanges.some(
                                    (row) => row.product.id === product.id
                                  )
                                    ? "border-success"
                                    : "border-border"
                                }`}
                              />
                            ) : (
                              <p className="mt-1 text-sm font-bold tabular-nums text-foreground">
                                {stock.onHand}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-medium text-muted">
                              Patrimônio
                            </p>
                            <p className="mt-1 text-sm font-bold text-foreground">
                              {stock.resaleValue !== null
                                ? `Vale ${formatCurrency(stock.resaleValue)}`
                                : "Sem valor de revenda"}
                            </p>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
      </section>

      {formOpen &&
        mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[110] flex items-center justify-center bg-foreground/25 px-4 py-6 backdrop-blur-sm ${
              formClosing ? "product-form-overlay-exit" : "product-form-overlay-enter"
            }`}
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (formClosing) return;
              closeForm();
            }}
          >
            <form
              key={formAnimationKey}
              role="dialog"
              aria-modal="true"
              aria-labelledby="product-form-title"
              onSubmit={handleSaveProduct}
              onClick={(event) => event.stopPropagation()}
              autoComplete="off"
              className={`flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card-hover ${
                formClosing ? "product-form-card-exit" : "product-form-card-enter"
              }`}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-1 sm:px-6">
                <div className="min-w-0">
                  <h2
                    id="product-form-title"
                    className="text-base font-semibold text-foreground"
                  >
                    {editingProduct ? "Editar produto" : "Novo produto"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    Cadastre o catálogo geral usado nos serviços.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                  aria-label="Fechar"
                >
                  <X size={18} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
                {error && (
                  <div className="mb-3 rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                  <div className="sm:col-span-2">
                    <Input
                      label="Nome do produto"
                      value={form.name}
                      autoComplete="off"
                      onChange={(event) => updateForm({ name: event.target.value })}
                      placeholder="Shampoo automotivo"
                    />
                  </div>
                  {/* Uma escolha só: ela decide quais campos fazem sentido.
                      O `type` antigo segue junto para o resto do app. */}
                  <Dropdown
                    label="Categoria"
                    value={form.kind}
                    options={STOCK_KIND_OPTIONS}
                    onChange={(value) => {
                      const kind = value as StockKind;
                      updateForm({
                        kind,
                        type: kind === "liquido" ? "liquid" : "utensil",
                        unitLabel:
                          kind === "liquido"
                            ? form.unitLabel || "frasco"
                            : form.unitLabel || "unidade",
                        depreciationMode: "none",
                        durabilityWashes: "",
                        ...(kind === "patrimonio" ? {} : { resaleValue: "" }),
                        ...(kind === "liquido" ? {} : { packageVolumeMl: "" }),
                      });
                      setTypeError(null);
                    }}
                  />
                  <Dropdown
                    label="Fornecedor"
                    value={form.supplierId}
                    options={supplierOptions}
                    onChange={(supplierId) => updateForm({ supplierId })}
                    disabled={!suppliersLoaded}
                  />
                  {typeError && (
                    <p className="text-xs font-medium text-danger sm:col-span-2">
                      {typeError}
                    </p>
                  )}

                  {form.kind === "liquido" && (
                    <Input
                      label="Volume de cada embalagem (ml)"
                      type="number"
                      min="0"
                      step="1"
                      className="number-input-no-spinner"
                      value={form.packageVolumeMl}
                      onChange={(event) =>
                        updateForm({ packageVolumeMl: event.target.value })
                      }
                      placeholder="5000"
                    />
                  )}

                  {form.kind !== "patrimonio" && (
                    <>
                      <Input
                        label="Quantas você tem hoje"
                        type="number"
                        min="0"
                        step="1"
                        className="number-input-no-spinner"
                        value={form.onHand}
                        onChange={(event) => updateForm({ onHand: event.target.value })}
                        placeholder="3"
                      />
                    </>
                  )}

                  {form.kind === "patrimonio" && (
                    <>
                      <Input
                        label="Data de aquisição"
                        type="date"
                        value={form.acquiredAt}
                        onChange={(event) =>
                          updateForm({ acquiredAt: event.target.value })
                        }
                      />
                      <Input
                        label="Quanto vale hoje (opcional)"
                        prefix="R$"
                        value={form.resaleValue}
                        autoComplete="off"
                        onChange={(event) =>
                          updateForm({ resaleValue: event.target.value })
                        }
                        placeholder="500,00"
                      />
                    </>
                  )}

                  <Input
                    label={
                      form.kind === "patrimonio"
                        ? "Quanto custou"
                        : "Custo de cada unidade"
                    }
                    value={form.totalCost}
                    autoComplete="off"
                    onChange={(event) =>
                      updateForm({ totalCost: event.target.value })
                    }
                    placeholder="80,00"
                  />

                </div>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" variant="success">
                  Salvar produto
                </Button>
              </div>
            </form>
          </div>,
          document.body
        )}
        </div>
      )}

      {activeProductTab === "history" && (
        <StockHistoryTab
          key="history-tab"
          supabase={supabase}
          workshopId={workshopId}
        />
      )}

      {activeProductTab === "suppliers" && (
      <section key="suppliers-tab" className="product-tab-panel-enter space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="section-title">Fornecedores</h2>
            <p className="mt-1 text-sm text-muted">
              Cadastre fornecedores para vincular produtos e reposições de estoque.
            </p>
          </div>
          <Button
            type="button"
            variant="success"
            onClick={openSupplierForm}
            className="w-full sm:w-auto"
          >
            <Plus size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
            Adicionar fornecedor
          </Button>
        </div>

        {supplierError && (
          <p className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
            {supplierError}
          </p>
        )}

        <div className="space-y-5">
          {supplierFormOpen && (
          <form
            onSubmit={handleSaveSupplier}
            autoComplete="off"
            className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card"
          >
            <h3 className="text-sm font-semibold text-foreground">
              {editingSupplierId ? "Editar fornecedor" : "Novo fornecedor"}
            </h3>
            {/* Esquerda: a empresa, que o CNPJ preenche. Direita: contato e
                anotações, que só você sabe. */}
            <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Input
                      label="CNPJ"
                      value={supplierForm.document}
                      onChange={(event) => {
                        const typed = event.target.value;
                        const digits = onlyCnpjDigits(typed);
                        setCnpjMessage(null);
                        updateSupplierForm({ document: typed });

                        // Completou os 14 e os dígitos batem: busca sem esperar
                        // clique. O ref segura a repetição enquanto o número não
                        // muda — apagar e redigitar o mesmo CNPJ busca de novo.
                        if (
                          digits.length === 14 &&
                          digits !== lastCnpjLookupRef.current &&
                          isValidCnpj(digits)
                        ) {
                          updateSupplierForm({ document: formatCnpj(digits) });
                          void handleCnpjLookup(digits);
                        } else if (digits.length < 14) {
                          lastCnpjLookupRef.current = "";
                        }
                      }}
                      onBlur={(event) =>
                        updateSupplierForm({ document: formatCnpj(event.target.value) })
                      }
                      placeholder="00.000.000/0001-00"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      loading={cnpjLoading}
                      disabled={!supplierForm.document.trim()}
                      onClick={() => void handleCnpjLookup()}
                      className="sm:w-auto"
                    >
                      <MagnifyingGlass size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                      Buscar
                    </Button>
                  </div>
                  <p
                    className={`mt-2 text-xs font-medium ${
                      cnpjMessage
                        ? cnpjMessage.tone === "error"
                          ? "text-danger"
                          : cnpjMessage.tone === "warning"
                            ? "text-warning"
                            : "text-success"
                        : "text-muted"
                    }`}
                  >
                    {cnpjMessage?.text ??
                      "Digite o CNPJ e os dados da empresa vêm sozinhos."}
                  </p>
                </div>

                <Input
                  label="Razão social"
                  value={supplierForm.name}
                  onChange={(event) => updateSupplierForm({ name: event.target.value })}
                  placeholder="Distribuidora Auto Clean LTDA"
                />
                <Input
                  label="Nome fantasia (opcional)"
                  value={supplierForm.tradeName}
                  onChange={(event) => updateSupplierForm({ tradeName: event.target.value })}
                  placeholder="Auto Clean"
                />
                <Input
                  label="Endereço (opcional)"
                  value={supplierForm.address}
                  onChange={(event) => updateSupplierForm({ address: event.target.value })}
                  placeholder="Rua das Oficinas, 120 - Centro"
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Cidade/UF"
                    value={supplierForm.cityState}
                    onChange={(event) => updateSupplierForm({ cityState: event.target.value })}
                    placeholder="Caxias do Sul/RS"
                  />
                  <Input
                    label="CEP (opcional)"
                    value={supplierForm.zipCode}
                    onChange={(event) => updateSupplierForm({ zipCode: event.target.value })}
                    placeholder="95010-000"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <Input
                  label="Nome do contato"
                  value={supplierForm.contactName}
                  onChange={(event) =>
                    updateSupplierForm({ contactName: event.target.value })
                  }
                  placeholder="Carlos Souza"
                />
                <Input
                  label="Telefone"
                  value={supplierForm.phone}
                  onChange={(event) => updateSupplierForm({ phone: event.target.value })}
                  placeholder="(51) 99999-9999"
                />
                <Input
                  label="E-mail"
                  type="email"
                  value={supplierForm.email}
                  onChange={(event) => updateSupplierForm({ email: event.target.value })}
                  placeholder="contato@fornecedor.com"
                />
                <div className="space-y-1.5">
                  <label htmlFor="supplier-notes" className="label-caps">
                    Observações
                  </label>
                  <textarea
                    id="supplier-notes"
                    value={supplierForm.notes}
                    onChange={(event) => updateSupplierForm({ notes: event.target.value })}
                    rows={6}
                    className="w-full resize-none rounded-lg border border-border bg-input px-4 py-3 text-base text-foreground placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:py-2.5 sm:text-sm"
                    placeholder="Condições de pagamento, entrega, contato..."
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={resetSupplierForm}
                className="w-full sm:w-auto"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="success"
                loading={savingSupplier}
                className="w-full sm:w-auto"
                disabled={!suppliersLoaded}
              >
                <Plus size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                {editingSupplierId ? "Salvar alterações" : "Cadastrar fornecedor"}
              </Button>
            </div>
          </form>
          )}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
              {!suppliersLoaded ? (
                <p className="rounded-lg border border-border bg-card px-3 py-10 text-center text-sm text-muted shadow-card">
                  Carregando fornecedores...
                </p>
              ) : suppliers.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm font-semibold text-muted">
                  Nenhum fornecedor cadastrado
                </p>
              ) : (
                <div className="w-full overflow-x-auto">
                  <div className="min-w-[720px]">
                    <div className="grid grid-cols-[minmax(260px,1fr)_190px_96px] gap-4 border-b border-border px-3 py-3 text-xs font-semibold text-muted">
                      <span>Nome</span>
                      <span>Telefone</span>
                      <span className="text-right">Ações</span>
                    </div>
                    {suppliers.map((supplier) => (
                      <article
                        key={supplier.id}
                        onClick={() => setSelectedSupplierId(supplier.id)}
                        className={`grid cursor-pointer grid-cols-[minmax(260px,1fr)_190px_96px] items-center gap-4 border-b border-border/70 px-3 py-3 transition-colors hover:bg-background/70 ${
                          selectedSupplierId === supplier.id ? "bg-background/80" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {supplierLabel(supplier)}
                          </p>
                          {getSupplierExtra(supplier, "contactName") && (
                            <p className="mt-1 truncate text-xs text-muted">
                              {getSupplierExtra(supplier, "contactName")}
                            </p>
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {supplier.phone ? formatPhone(supplier.phone) : "-"}
                        </p>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditingSupplier(supplier);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-success transition-colors hover:bg-success/10"
                            aria-label={`Editar ${supplierLabel(supplier)}`}
                            title="Editar fornecedor"
                          >
                            <PencilSimple size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void requestDeleteSupplier(supplier);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                            aria-label={`Excluir ${supplierLabel(supplier)}`}
                            title="Excluir fornecedor"
                          >
                            <Trash size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <aside className="rounded-lg border border-border bg-card shadow-card p-5 shadow-card xl:sticky xl:top-4">
                {selectedSupplier ? (
                  <div>
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-muted">
                          Fornecedor
                        </p>
                        <h3 className="mt-1 text-xl font-bold text-foreground">
                          {selectedSupplier.name}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEditingSupplier(selectedSupplier)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-success transition-colors hover:bg-success/10"
                        aria-label={`Editar ${selectedSupplier.name}`}
                        title="Editar fornecedor"
                      >
                        <PencilSimple size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                      </button>
                    </div>
                    <div className="space-y-3 text-sm">
                      <SupplierDetail label="Contato" value={getSupplierExtra(selectedSupplier, "contactName")} />
                      <SupplierDetail
                        label="Telefone"
                        value={
                          selectedSupplier.phone
                            ? formatPhone(selectedSupplier.phone)
                            : ""
                        }
                      />
                      <SupplierDetail
                        label="E-mail"
                        value={getSupplierExtra(selectedSupplier, "email")}
                        href={
                          getSupplierExtra(selectedSupplier, "email")
                            ? `mailto:${getSupplierExtra(selectedSupplier, "email")}`
                            : ""
                        }
                        icon={
                          <EnvelopeSimple
                            size={16}
                            weight={PRODUCT_ICON_WEIGHT}
                            aria-hidden
                          />
                        }
                      />
                      <SupplierDetail label="Razão social" value={selectedSupplier.name} />
                      <SupplierDetail label="CNPJ" value={getSupplierExtra(selectedSupplier, "document")} />
                      <SupplierDetail label="Endereço" value={getSupplierExtra(selectedSupplier, "address")} />
                      <SupplierDetail label="Cidade/UF" value={getSupplierExtra(selectedSupplier, "cityState")} />
                      <SupplierDetail label="CEP" value={getSupplierExtra(selectedSupplier, "zipCode")} />
                      <SupplierDetail label="Observações" value={selectedSupplier.notes ?? ""} />
                    </div>
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm font-semibold text-muted">
                    Selecione um fornecedor para ver os detalhes
                  </p>
                )}
              </aside>
            </div>
        </div>
      </section>
      )}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .product-form-overlay-enter {
            animation: product-form-fade-in 220ms ease-out both;
          }

          .product-form-overlay-exit {
            animation: product-form-fade-out ${PRODUCT_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }

          .product-form-card-enter {
            animation: product-form-card-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          .product-form-card-exit {
            animation: product-form-card-exit ${PRODUCT_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }

          .product-tab-panel-enter {
            animation: product-tab-panel-enter 180ms ease-out both;
          }
        }

        .stock-range-slider {
          appearance: none;
          height: 0.5rem;
          border-radius: 9999px;
          outline: none;
        }

        .stock-range-slider::-webkit-slider-thumb {
          appearance: none;
          height: 1.15rem;
          width: 1.15rem;
          border-radius: 9999px;
          border: 3px solid #ffffff;
          background: var(--primary);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
          cursor: pointer;
        }

        .stock-range-slider::-moz-range-thumb {
          height: 1.15rem;
          width: 1.15rem;
          border-radius: 9999px;
          border: 3px solid #ffffff;
          background: var(--primary);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
          cursor: pointer;
        }

        .number-input-no-spinner::-webkit-outer-spin-button,
        .number-input-no-spinner::-webkit-inner-spin-button {
          appearance: none;
          margin: 0;
        }

        .number-input-no-spinner {
          appearance: textfield;
          -moz-appearance: textfield;
        }

        @media (hover: hover) and (prefers-reduced-motion: no-preference) {
          .product-photo-preview-popover {
            animation: product-photo-preview-popover 180ms ease-out 1s both;
          }
        }

        @media (hover: hover) and (prefers-reduced-motion: reduce) {
          .product-photo-preview:hover .product-photo-preview-popover {
            display: block;
            opacity: 1;
          }
        }

        @keyframes product-form-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes product-form-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes product-form-card-enter {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes product-form-card-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
        }

        @keyframes product-tab-panel-enter {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .product-inline-filter-card {
            transition: none !important;
          }
        }

        @keyframes product-photo-preview-popover {
          from {
            opacity: 0;
            transform: translateY(-4px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>


      <StockMovementDialog
        key={movementTarget?.id ?? "movimento-fechado"}
        open={movementTarget !== null}
        supabase={supabase}
        workshopId={workshopId}
        item={movementTarget}
        today={dateKey(today)}
        onClose={() => setMovementTarget(null)}
        onDone={() => window.location.reload()}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "product"}
        title="Excluir produto"
        description={
          deleteConfirm?.type === "product"
            ? deleteConfirm.linkedServiceCount > 0
              ? `Este produto está vinculado a ${deleteConfirm.linkedServiceCount} ${deleteConfirm.linkedServiceCount === 1 ? "serviço" : "serviços"}. Ao excluir, será removido dos serviços mas o nome será mantido no histórico financeiro.`
              : `Deseja excluir "${deleteConfirm.product.name}"? Esta ação não pode ser desfeita.`
            : ""
        }
        confirmLabel={
          deleteConfirm?.type === "product" && deleteConfirm.linkedServiceCount > 0
            ? "Excluir mesmo assim"
            : "Excluir produto"
        }
        loading={deletingItem}
        onCancel={() => {
          if (!deletingItem) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "product") {
            void executeDeleteProduct(deleteConfirm.product);
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "supplier"}
        title="Excluir fornecedor"
        description={
          deleteConfirm?.type === "supplier"
            ? `Deseja excluir ${supplierLabel(deleteConfirm.supplier)}?`
            : ""
        }
        confirmLabel="Excluir fornecedor"
        loading={deletingItem}
        onCancel={() => {
          if (!deletingItem) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "supplier") {
            void executeDeleteSupplier(deleteConfirm.supplier);
          }
        }}
      />

    </>
  );
}
