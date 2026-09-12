"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowCounterClockwise,
  Camera,
  CaretDown,
  CaretUp,
  CaretUpDown,
  CurrencyDollar,
  Drop,
  EnvelopeSimple,
  Faders,
  Funnel,
  MagnifyingGlassPlus,
  Package,
  PencilSimple,
  Plus,
  Trash,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { formatCurrency, formatPhone, normalizeOptionalPhone } from "@/lib/utils/format";
import {
  createProductId,
  createProductPriceHistoryId,
  createProductTypeId,
  emptyProductForm,
  formatStockAmount,
  getProductInitialStock,
  getProductRemainingStock,
  getProductStockPercent,
  getProductStockUnit,
  getProductTypeLabel,
  parseMoney,
  parsePositiveNumber,
  productTypeOptions,
  type ProductForm,
  type ProductItem,
  type ProductPriceHistoryReason,
  type ServiceProductUsage,
  type ProductType,
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
type ProductPageTab = "products" | "suppliers";
type ProductSortColumn = "name" | "value" | "stock";
type ProductSortDirection = "asc" | "desc";

type ProductDeleteConfirm =
  | { type: "product"; product: ProductItem; linkedServiceCount: number }
  | { type: "supplier"; supplier: Supplier }
  | null;

interface Supplier {
  id: string;
  workshop_id: string;
  name: string;
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
  contactName: string;
  phone: string;
  email: string;
  document: string;
  cityState: string;
  notes: string;
}

interface ReplenishForm {
  supplierId: string;
  amount: string;
  paidAmount: string;
  purchaseDate: string;
}

const PRODUCT_FILTER_EXIT_MS = 300;

// Single source of truth for the products table column widths, applied via
// inline style to both the header row and every product row so they can
// never drift out of alignment regardless of CSS class generation.
const PRODUCTS_TABLE_GRID_TEMPLATE =
  "minmax(220px, 1fr) 110px 120px 190px 172px";

function filterLabelForType(option: ProductTypeOption) {
  if (option.value === "liquid") return "Líquidos";
  if (option.value === "utensil") return "Utensílios";
  return option.label;
}

function ProductInlineFilterButton({
  value,
  options,
  open,
  onToggle,
  onClose,
  onChange,
  onClear,
  onCreateOption,
  onDeleteOption,
}: {
  value: ProductTypeFilter;
  options: { value: string; label: string; custom?: boolean }[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: ProductTypeFilter) => void;
  onClear: () => void;
  onCreateOption: (label: string) => string | void;
  onDeleteOption: (value: string) => void;
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
              label="Tipo"
              value={value}
              options={options}
              onChange={(nextValue) => onChange(nextValue as ProductTypeFilter)}
              actionLabel="Adicionar"
              createPlaceholder="Ex: Cera, Equipamento, Químico"
              onCreateOption={onCreateOption}
              onDeleteOption={onDeleteOption}
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
  { id: "suppliers", label: "Fornecedores" },
];
const emptySupplierForm: SupplierForm = {
  name: "",
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

const SUPPLIER_SELECT_FIELDS =
  "id, workshop_id, name, contact_name, phone, email, document, city_state, category, notes, created_at, updated_at";

function mapSupplierRow(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id),
    workshop_id: String(row.workshop_id),
    name: String(row.name),
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

function SortableColumnHeader({
  label,
  column,
  activeColumn,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  column: ProductSortColumn;
  activeColumn: ProductSortColumn;
  direction: ProductSortDirection;
  onSort: (column: ProductSortColumn) => void;
  align?: "left" | "right";
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

function ProductReplenishModal({
  product,
  amount,
  error,
  onAmountChange,
  onCancel,
  onConfirm,
}: {
  product: ProductItem;
  amount: string;
  error: string | null;
  onAmountChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="replenish-modal-title"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-card-hover"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <ArrowCounterClockwise size={20} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2
              id="replenish-modal-title"
              className="text-sm font-semibold text-foreground"
            >
              Repor estoque
            </h2>
            <p className="truncate text-xs text-muted">{product.name}</p>
          </div>
        </div>

        <p className="mb-3 text-xs text-muted">
          Estoque será preenchido ao máximo. Informe o novo custo do produto (opcional).
        </p>
        <Input
          label="Custo total (R$)"
          type="number"
          min="0"
          step="0.01"
          className="number-input-no-spinner"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder={product.totalCost || "0,00"}
        />
        {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="success" onClick={onConfirm}>
            Repor
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ProductStockEditModal({
  product,
  value,
  onValueChange,
  onCancel,
  onConfirm,
}: {
  product: ProductItem;
  value: string;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  if (typeof document === "undefined") return null;

  const initialStock = getProductInitialStock(product);
  const stockUnit = getProductStockUnit(product);
  const percent =
    initialStock > 0
      ? Math.max(0, Math.min(100, ((Number(value) || 0) / initialStock) * 100))
      : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-edit-modal-title"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-card-hover"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <Faders size={20} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2
              id="stock-edit-modal-title"
              className="text-sm font-semibold text-foreground"
            >
              Editar estoque
            </h2>
            <p className="truncate text-xs text-muted">{product.name}</p>
          </div>
        </div>

        <p className="mb-3 text-sm font-bold text-foreground">
          {formatStockAmount(Number(value) || 0)} {stockUnit} /{" "}
          {formatStockAmount(initialStock)} {stockUnit}
        </p>
        <input
          type="range"
          min="0"
          max={initialStock}
          step={product.type === "liquid" ? "1" : "0.01"}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="stock-range-slider w-full"
          style={{
            background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percent}%, #e2e8f0 ${percent}%, #e2e8f0 100%)`,
          }}
          aria-label={`Ajustar estoque atual de ${product.name}`}
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={() => onConfirm(value)}
          >
            Salvar
          </Button>
        </div>
      </div>
    </div>,
    document.body
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
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [typeOptions, setTypeOptions] =
    useState<ProductTypeOption[]>(productTypeOptions);
  const [serviceProductUsages, setServiceProductUsages] = useState<
    Record<string, ServiceProductUsage[]>
  >({});
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<ProductTypeFilter>("all");
  const [sortColumn, setSortColumn] = useState<ProductSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<ProductSortDirection>("asc");
  const [activeProductTab, setActiveProductTab] = useState<ProductPageTab>("products");
  const [showProductFilter, setShowProductFilter] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formClosing, setFormClosing] = useState(false);
  const [formAnimationKey, setFormAnimationKey] = useState(0);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProductForm);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProductDeleteConfirm>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [replenishingProductId, setReplenishingProductId] = useState<string | null>(
    null
  );
  const [replenishForm, setReplenishForm] = useState<ReplenishForm>({
    supplierId: "",
    amount: "",
    paidAmount: "",
    purchaseDate: dateKey(today),
  });
  const [replenishError, setReplenishError] = useState<string | null>(null);
  const [editingStockProductId, setEditingStockProductId] = useState<string | null>(
    null
  );
  const [stockEditValue, setStockEditValue] = useState("");
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

        const [suppliersResult, catalog] = await Promise.all([
          supabase
            .from("suppliers")
            .select(SUPPLIER_SELECT_FIELDS)
            .eq("workshop_id", resolvedWorkshopId)
            .order("name", { ascending: true }),
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
    setReplenishingProductId(null);
    setReplenishForm({
      supplierId: "",
      amount: "",
      paidAmount: "",
      purchaseDate: dateKey(today),
    });
    setReplenishError(null);
    setEditingStockProductId(null);
    setStockEditValue("");
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
    });
    setError(null);
    setTypeError(null);
    setReplenishingProductId(null);
    setReplenishForm({
      supplierId: product.supplierId ?? "",
      amount: "",
      paidAmount: "",
      purchaseDate: dateKey(today),
    });
    setReplenishError(null);
    setEditingStockProductId(null);
    setStockEditValue("");
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

  function updateForm(patch: Partial<ProductForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function getTypeLabel(type: ProductType) {
    return (
      typeOptions.find((option) => option.value === type)?.label ??
      getProductTypeLabel(type)
    );
  }

  const persistedSuppliers = suppliers.filter(
    (supplier) => supplier.workshop_id !== "local"
  );
  const supplierOptions = [
    { value: "", label: "Sem fornecedor" },
    ...persistedSuppliers.map((supplier) => ({
      value: supplier.id,
      label: supplier.name,
    })),
  ];

  function getSupplierName(supplierId?: string) {
    if (!supplierId) return "Sem fornecedor";
    return suppliers.find((supplier) => supplier.id === supplierId)?.name ?? "Fornecedor removido";
  }

  function updateSupplierForm(patch: Partial<SupplierForm>) {
    setSupplierForm((prev) => ({ ...prev, ...patch }));
  }

  function openSupplierForm() {
    setEditingSupplierId(null);
    setSupplierForm(emptySupplierForm);
    setSupplierError(null);
    setSupplierFormOpen(true);
  }

  function startEditingSupplier(supplier: Supplier) {
    setEditingSupplierId(supplier.id);
    setSupplierForm({
      name: supplier.name,
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
      contact_name: supplierForm.contactName.trim() || null,
      phone: normalizedPhone,
      email: supplierForm.email.trim() || null,
      document: supplierForm.document.trim() || null,
      city_state: supplierForm.cityState.trim() || null,
      category: existingSupplier?.category ?? "Outros",
      notes: supplierForm.notes.trim() || null,
      updated_at: now,
    };

    const result = editingSupplierId
      ? await supabase
          .from("suppliers")
          .update(payload)
          .eq("id", editingSupplierId)
          .eq("workshop_id", workshopId)
          .select(SUPPLIER_SELECT_FIELDS)
          .single()
      : await supabase
          .from("suppliers")
          .insert(payload)
          .select(SUPPLIER_SELECT_FIELDS)
          .single();

    setSavingSupplier(false);

    if (result.error || !result.data) {
      setSupplierError(
        result.error?.message ?? "Não foi possível salvar o fornecedor no Supabase."
      );
      return;
    }

    const supplier = mapSupplierRow(result.data as Record<string, unknown>);

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

  function handleAddType(label: string, selectIn?: "form" | "filter") {
    const alreadyExists = typeOptions.some(
      (option) => option.label.toLowerCase() === label.toLowerCase()
    );

    if (alreadyExists) {
      return "Esse tipo já existe.";
    }

    const nextType: ProductTypeOption = {
      value: createProductTypeId(label),
      label,
      custom: true,
    };

    setTypeOptions((prev) => [...prev, nextType]);
    if (selectIn === "filter") {
      setTypeFilter(nextType.value);
    } else {
      updateForm({ type: nextType.value });
      setTypeError(null);
    }
  }

  function handleDeleteType(type: string) {
    const option = typeOptions.find((item) => item.value === type);
    if (!option?.custom) return;

    const typeInUse = products.some((product) => product.type === type);
    if (typeInUse) {
      const message =
        "Não é possível apagar um tipo usado em produtos cadastrados.";
      setTypeError(message);
      setError(message);
      return;
    }

    setTypeOptions((prev) => prev.filter((item) => item.value !== type));
    if (form.type === type) {
      updateForm({ type: "liquid" });
    }
    if (typeFilter === type) {
      setTypeFilter("all");
    }
    setTypeError(null);
  }

  async function handleProductPhotoChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Selecione uma imagem válida para a foto do produto.");
      return;
    }

    try {
      updateForm({ photoUrl: await resizeProductImage(file) });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar a foto.");
    }
    event.target.value = "";
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

    const baseProduct: ProductItem = {
      id: editingProduct?.id ?? createProductId(),
      name: form.name.trim(),
      type: form.type,
      volumeMl: form.type === "liquid" ? form.volumeMl : "",
      usagePerWashMl: "",
      quantity: form.type === "utensil" ? form.quantity : "",
      durabilityWashes: "",
      totalCost: form.totalCost,
      photoUrl: form.photoUrl || undefined,
      supplierId: persistedSupplierId,
      priceHistory: editingProduct?.priceHistory ?? [],
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
      editingProduct && editingProduct.type === baseProduct.type
        ? getProductRemainingStock(editingProduct)
        : initialStock;
    const nextProduct: ProductItem = {
      ...baseProduct,
      stockRemaining: String(Math.min(initialStock, preservedRemaining)),
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

  function openReplenish(productId: string) {
    const product = products.find((item) => item.id === productId);
    setReplenishingProductId(productId);
    setReplenishForm({
      supplierId: "",
      amount: product?.totalCost ?? "",
      paidAmount: "",
      purchaseDate: dateKey(today),
    });
    setReplenishError(null);
    setEditingStockProductId(null);
    setStockEditValue("");
  }

  function closeReplenish() {
    setReplenishingProductId(null);
    setReplenishForm({
      supplierId: "",
      amount: "",
      paidAmount: "",
      purchaseDate: dateKey(today),
    });
    setReplenishError(null);
  }

  async function handleReplenishProduct(product: ProductItem) {
    setReplenishError(null);

    if (!workshopId) {
      setReplenishError("Oficina não encontrada.");
      return;
    }

    // Fill bar to 100%: set stockRemaining = initialStock (keep max unchanged)
    const initialStock = getProductInitialStock(product);
    const newPrice = replenishForm.amount.trim();

    const updatedProduct: ProductItem = {
      ...product,
      stockRemaining: String(initialStock),
      totalCost: newPrice || product.totalCost,
      priceHistory: product.priceHistory ?? [],
    };

    try {
      await saveSupabaseProduct(supabase, workshopId, updatedProduct);
    } catch (err) {
      setReplenishError(
        err instanceof Error ? err.message : "Erro ao salvar."
      );
      return;
    }

    setProducts((prev) =>
      prev.map((item) => (item.id === product.id ? updatedProduct : item))
    );
    closeReplenish();
  }

  function openStockEdit(product: ProductItem) {
    setEditingStockProductId(product.id);
    setStockEditValue(String(getProductRemainingStock(product)));
    setReplenishingProductId(null);
    setReplenishForm({
      supplierId: "",
      amount: "",
      paidAmount: "",
      purchaseDate: dateKey(today),
    });
    setReplenishError(null);
  }

  function closeStockEdit() {
    setEditingStockProductId(null);
    setStockEditValue("");
  }

  function updateCurrentStock(product: ProductItem, value: string) {
    const currentStock = Number(value);
    const maxStock = getProductInitialStock(product);
    const nextStock = Math.min(maxStock, Math.max(0, currentStock));
    const nextProduct = { ...product, stockRemaining: String(nextStock) };

    if (workshopId) {
      void saveSupabaseProduct(supabase, workshopId, nextProduct).catch((err) => {
        setError(
          err instanceof Error
            ? `Estoque ajustado na tela, mas não sincronizou: ${err.message}`
            : "Estoque ajustado na tela, mas não sincronizou."
        );
      });
    }

    setProducts((prev) =>
      prev.map((item) =>
        item.id === product.id
          ? nextProduct
          : item
      )
    );
  }

  function handleSort(column: ProductSortColumn) {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  const filteredProducts = products.filter((product) => {
    if (typeFilter === "all") return true;
    return product.type === typeFilter;
  });
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let comparison = 0;
    if (sortColumn === "name") {
      comparison = a.name.localeCompare(b.name, "pt-BR");
    } else if (sortColumn === "value") {
      comparison =
        parseMoney(a.totalCost || "0") - parseMoney(b.totalCost || "0");
    } else {
      comparison = getProductStockPercent(a) - getProductStockPercent(b);
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
  const totalInvested = filteredProducts.reduce(
    (total, product) => total + parseMoney(product.totalCost || "0"),
    0
  );
  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;
  const productTypeFilterOptions = [
    { value: "all", label: "Todos" },
    ...typeOptions.map((option) => ({
      value: option.value,
      label: filterLabelForType(option),
      custom: option.custom,
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
        <ProductInlineFilterButton
          value={typeFilter}
          options={productTypeFilterOptions}
          open={showProductFilter}
          onToggle={() => setShowProductFilter(true)}
          onClose={() => setShowProductFilter(false)}
          onChange={setTypeFilter}
          onClear={() => setTypeFilter("all")}
          onCreateOption={(label) => handleAddType(label, "filter")}
          onDeleteOption={handleDeleteType}
        />

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
            <Button
              variant="success"
              onClick={openCreateForm}
              className="w-full sm:w-auto"
            >
              <Plus size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
              Adicionar produto
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div
        className={`grid grid-cols-1 items-start gap-6 ${
          formOpen ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""
        }`}
      >
        <section className="order-2 lg:order-1">
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
                  <div className="min-w-[840px]">
                    <div
                      className="grid items-center gap-4 border-b border-border bg-background/60 px-4 py-3"
                      style={{ gridTemplateColumns: PRODUCTS_TABLE_GRID_TEMPLATE }}
                    >
                      <SortableColumnHeader
                        label="Produto"
                        column="name"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Volume total
                      </span>
                      <SortableColumnHeader
                        label="Valor"
                        column="value"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableColumnHeader
                        label="Estoque atual"
                        column="stock"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                      <span className="text-right text-xs font-semibold uppercase tracking-wide text-muted">
                        Ações
                      </span>
                    </div>

                    {sortedProducts.map((product) => {
                      const isLiquid = product.type === "liquid";
                      const remainingStock = getProductRemainingStock(product);
                      const initialStock = getProductInitialStock(product);
                      const stockPercent = getProductStockPercent(product);
                      const stockUnit = getProductStockUnit(product);
                      const progressWidth = Math.max(0, Math.min(100, stockPercent));
                      const criticalStock = stockPercent < 20;
                      const warningStock = stockPercent >= 20 && stockPercent <= 50;
                      const progressClass = criticalStock
                        ? "bg-danger"
                        : warningStock
                          ? "bg-warning"
                          : "bg-success";

                      return (
                        <div
                          key={product.id}
                          className="group relative z-0 grid items-center gap-4 border-b border-border/70 px-4 py-3 transition-colors last:border-b-0 hover:z-50 hover:bg-background/70"
                          style={{ gridTemplateColumns: PRODUCTS_TABLE_GRID_TEMPLATE }}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {product.photoUrl ? (
                              <span className="product-photo-preview group/photo relative h-9 w-9 shrink-0 cursor-zoom-in overflow-visible rounded-lg border border-border bg-card shadow-card transition-all duration-300 hover:border-success/40 hover:shadow-card-hover hover:ring-2 hover:ring-success/15">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={product.photoUrl}
                                  alt={`Foto de ${product.name}`}
                                  className="h-full w-full rounded-lg object-cover transition duration-300 group-hover/photo:scale-105 group-hover/photo:brightness-110"
                                />
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-foreground/0 text-white opacity-0 transition-all duration-300 group-hover/photo:bg-foreground/25 group-hover/photo:opacity-100">
                                  <MagnifyingGlassPlus
                                    size={14}
                                    weight={PRODUCT_ICON_WEIGHT}
                                    className="drop-shadow-card"
                                    aria-hidden
                                  />
                                </span>
                                <span className="pointer-events-none absolute left-0 top-11 z-[999] hidden h-44 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-card p-1 opacity-0 shadow-2xl ring-1 ring-slate-900/5 group-hover/photo:block product-photo-preview-popover">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={product.photoUrl}
                                    alt={`Prévia ampliada de ${product.name}`}
                                    className="h-full w-full rounded-lg object-cover"
                                  />
                                </span>
                              </span>
                            ) : (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                                {isLiquid ? (
                                  <Drop size={18} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                                ) : (
                                  <Wrench size={18} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                                )}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {product.name}
                              </p>
                              <p className="truncate text-xs font-medium text-muted">
                                {getTypeLabel(product.type)}
                                {product.supplierId
                                  ? ` • ${getSupplierName(product.supplierId)}`
                                  : ""}
                              </p>
                            </div>
                          </div>

                          <p className="text-sm text-foreground">
                            {isLiquid ? `${product.volumeMl} ml` : product.quantity}
                          </p>

                          <p className="text-right text-sm font-semibold text-foreground">
                            {formatCurrency(parseMoney(product.totalCost || "0"))}
                          </p>

                          <div className="min-w-0">
                            <p className="truncate text-xs text-muted">
                              {formatStockAmount(remainingStock)} {stockUnit} /{" "}
                              {formatStockAmount(initialStock)} {stockUnit}
                            </p>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
                              <div
                                className={`h-full rounded-full transition-all ${progressClass}`}
                                style={{ width: `${progressWidth}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openReplenish(product.id)}
                              className="rounded-lg bg-success/10 p-1.5 text-success transition-colors hover:bg-success hover:text-white"
                              title="Repor estoque"
                            >
                              <ArrowCounterClockwise size={15} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => openStockEdit(product)}
                              className="rounded-lg bg-success/10 p-1.5 text-success transition-colors hover:bg-success hover:text-white"
                              title="Editar estoque"
                            >
                              <Faders size={15} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                            </button>
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
                  const isLiquid = product.type === "liquid";
                  const remainingStock = getProductRemainingStock(product);
                  const initialStock = getProductInitialStock(product);
                  const stockPercent = getProductStockPercent(product);
                  const stockUnit = getProductStockUnit(product);
                  const progressWidth = Math.max(0, Math.min(100, stockPercent));
                  const criticalStock = stockPercent < 20;
                  const warningStock = stockPercent >= 20 && stockPercent <= 50;
                  const progressClass = criticalStock
                    ? "bg-danger"
                    : warningStock
                      ? "bg-warning"
                      : "bg-success";

                  return (
                    <article
                      key={product.id}
                      className="relative z-0 rounded-lg border border-border bg-card shadow-card p-5 transition-all hover:z-50 hover:-translate-y-0.5 hover:shadow-card-hover"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          {product.photoUrl ? (
                            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-card">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={product.photoUrl}
                                alt={`Foto de ${product.name}`}
                                className="h-full w-full rounded-lg object-cover"
                              />
                            </span>
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                              {isLiquid ? (
                                <Drop size={20} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                              ) : (
                                <Wrench size={20} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                              )}
                            </span>
                          )}
                          <div>
                            <h2 className="font-semibold text-foreground">
                              {product.name}
                            </h2>
                            <p className="text-xs font-medium text-muted">
                              {getTypeLabel(product.type)}
                              {product.supplierId
                                ? ` • ${getSupplierName(product.supplierId)}`
                                : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openReplenish(product.id)}
                            className="rounded-lg bg-success/10 p-2 text-success transition-colors hover:bg-success hover:text-white"
                            title="Repor estoque"
                          >
                            <ArrowCounterClockwise size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => openStockEdit(product)}
                            className="rounded-lg bg-success/10 p-2 text-success transition-colors hover:bg-success hover:text-white"
                            title="Editar estoque"
                          >
                            <Faders size={16} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          </button>
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
                            {isLiquid ? "Volume total" : "Quantidade"}
                          </span>
                          <p className="mt-1 font-bold text-foreground">
                            {isLiquid ? `${product.volumeMl} ml` : product.quantity}
                          </p>
                        </div>
                        <div className="rounded-lg bg-background px-4 py-3">
                          <span className="font-medium text-muted">Valor</span>
                          <p className="mt-1 font-bold text-foreground">
                            {formatCurrency(parseMoney(product.totalCost || "0"))}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg bg-background px-4 py-3">
                        <p className="text-xs font-medium text-muted">
                          Estoque atual
                        </p>
                        <p className="mt-1 text-xs font-semibold text-foreground">
                          {formatStockAmount(remainingStock)} {stockUnit} /{" "}
                          {formatStockAmount(initialStock)} {stockUnit}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-full rounded-full transition-all ${progressClass}`}
                            style={{ width: `${progressWidth}%` }}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <aside className="order-1 w-full lg:order-2 lg:sticky lg:top-4 lg:w-[320px] lg:shrink-0 lg:self-start">
          {formOpen ? (
            <form
              key={formAnimationKey}
              onSubmit={handleSaveProduct}
              autoComplete="off"
              className={`rounded-lg border border-border bg-card shadow-card p-6 shadow-card ${
                formClosing ? "product-form-exit" : "product-form-enter"
              }`}
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {editingProduct ? "Editar produto" : "Novo produto"}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Cadastre o catálogo geral usado nos serviços.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-background hover:text-foreground"
                  aria-label="Fechar formulário"
                >
                  <X size={20} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-lg border border-border bg-background shadow-card p-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card shadow-card bg-cover bg-center text-muted"
                      style={
                        form.photoUrl
                          ? { backgroundImage: `url(${form.photoUrl})` }
                          : undefined
                      }
                    >
                      {!form.photoUrl && (
                        <Camera size={24} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        Foto do produto
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Opcional. Use uma imagem para identificar o produto.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-semibold text-success transition-colors hover:bg-success hover:text-white">
                          <Camera size={14} weight={PRODUCT_ICON_WEIGHT} aria-hidden />
                          {form.photoUrl ? "Trocar foto" : "Adicionar foto"}
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={handleProductPhotoChange}
                          />
                        </label>
                        {form.photoUrl && (
                          <button
                            type="button"
                            onClick={() => updateForm({ photoUrl: "" })}
                            className="rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger hover:text-white"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <Input
                  label="Nome do produto"
                  value={form.name}
                  autoComplete="off"
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder="Shampoo automotivo"
                />
                <Dropdown
                  label="Tipo"
                  value={form.type}
                  options={typeOptions}
                  onChange={(type) => {
                    updateForm({ type: type as ProductType });
                    setTypeError(null);
                  }}
                  actionLabel="Adicionar"
                  createPlaceholder="Ex: Cera, Equipamento, Químico"
                  onCreateOption={handleAddType}
                  onDeleteOption={handleDeleteType}
                />
                {typeError && (
                  <p className="text-xs font-medium text-danger">{typeError}</p>
                )}

                <Dropdown
                  label="Fornecedor"
                  value={form.supplierId}
                  options={supplierOptions}
                  onChange={(supplierId) => updateForm({ supplierId })}
                  disabled={!suppliersLoaded}
                />

                {form.type === "liquid" ? (
                  <Input
                    label="Volume total (ml)"
                    type="number"
                    min="0"
                    step="1"
                    className="number-input-no-spinner"
                    value={form.volumeMl}
                    onChange={(event) =>
                      updateForm({ volumeMl: event.target.value })
                    }
                    placeholder="5000"
                    suffix={
                      <CaretUpDown
                        size={16}
                        weight={PRODUCT_ICON_WEIGHT}
                        aria-hidden
                      />
                    }
                  />
                ) : (
                  <Input
                    label="Quantidade"
                    type="number"
                    min="0"
                    step="1"
                    value={form.quantity}
                    onChange={(event) =>
                      updateForm({ quantity: event.target.value })
                    }
                    placeholder="3"
                  />
                )}

                <Input
                  label="Custo total do produto"
                  value={form.totalCost}
                  autoComplete="off"
                  onChange={(event) =>
                    updateForm({ totalCost: event.target.value })
                  }
                  placeholder="80,00"
                />
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" variant="success">
                  Salvar produto
                </Button>
              </div>
            </form>
          ) : null}
        </aside>
      </div>
        </div>
      )}

      {activeProductTab === "suppliers" && (
      <section key="suppliers-tab" className="product-tab-panel-enter space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Fornecedores</h2>
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
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Nome da empresa"
                value={supplierForm.name}
                onChange={(event) => updateSupplierForm({ name: event.target.value })}
                placeholder="Distribuidora Auto Clean"
              />
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
              <Input
                label="CNPJ"
                value={supplierForm.document}
                onChange={(event) => updateSupplierForm({ document: event.target.value })}
                placeholder="00.000.000/0001-00"
              />
              <Input
                label="Cidade/UF"
                value={supplierForm.cityState}
                onChange={(event) => updateSupplierForm({ cityState: event.target.value })}
                placeholder="Caxias do Sul/RS"
              />
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-foreground">
                  Observações
                </label>
                <textarea
                  value={supplierForm.notes}
                  onChange={(event) => updateSupplierForm({ notes: event.target.value })}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-border bg-input px-4 py-3 text-base text-foreground placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:py-2.5 sm:text-sm"
                  placeholder="Condições de pagamento, entrega, contato..."
                />
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
                            {supplier.name}
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
                            aria-label={`Editar ${supplier.name}`}
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
                            aria-label={`Excluir ${supplier.name}`}
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
                      <SupplierDetail label="CNPJ" value={getSupplierExtra(selectedSupplier, "document")} />
                      <SupplierDetail label="Cidade/UF" value={getSupplierExtra(selectedSupplier, "cityState")} />
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
          .product-form-enter {
            animation: product-form-enter 220ms ease-out both;
            transform-origin: top center;
          }

          .product-form-exit {
            animation: product-form-exit ${PRODUCT_FORM_EXIT_MS}ms ease-in both;
            transform-origin: top center;
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

        @keyframes product-form-enter {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes product-form-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
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
            ? `Deseja excluir ${deleteConfirm.supplier.name}?`
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

      {replenishingProductId &&
        (() => {
          const product = products.find((item) => item.id === replenishingProductId);
          if (!product) return null;

          return (
            <ProductReplenishModal
              product={product}
              amount={replenishForm.amount}
              error={replenishError}
              onAmountChange={(value) => {
                setReplenishForm((prev) => ({ ...prev, amount: value }));
                setReplenishError(null);
              }}
              onCancel={closeReplenish}
              onConfirm={() => handleReplenishProduct(product)}
            />
          );
        })()}

      {editingStockProductId &&
        (() => {
          const product = products.find((item) => item.id === editingStockProductId);
          if (!product) return null;

          return (
            <ProductStockEditModal
              product={product}
              value={stockEditValue}
              onValueChange={setStockEditValue}
              onCancel={closeStockEdit}
              onConfirm={(value) => {
                updateCurrentStock(product, value);
                closeStockEdit();
              }}
            />
          );
        })()}
    </>
  );
}
