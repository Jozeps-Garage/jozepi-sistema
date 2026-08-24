"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarBlank,
  CheckCircle,
  Clock,
  Funnel,
  PencilSimple,
  Plus,
  Power,
  Trash,
  Wrench,
  X,
} from "@phosphor-icons/react";
import {
  COATING_PACKAGES,
  ensurePackageServicesInCatalog,
  loadCoatingPackages,
  loadStagePackages,
  packageCatalogName,
  saveCoatingPackageOverride,
  saveStagePackageOverride,
  STAGE_PACKAGES,
  type ServicePackage,
} from "@/lib/services/packages";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { assertMutationRows } from "@/lib/supabase/mutations";
import { formatCurrency } from "@/lib/utils/format";
import {
  calculateProductUsageCost,
  createProductId,
  createProductTypeId,
  createUsageId,
  emptyProductForm,
  getProductAmountLabel,
  getProductTypeLabel,
  parsePositiveNumber,
  productTypeOptions,
  type ProductForm,
  type ProductItem,
  type ProductType,
  type ProductTypeOption,
  type ServiceProductUsage,
} from "@/lib/products/catalog";
import {
  clearLocalCatalogStorage,
  importLocalCatalogToSupabase,
  loadSupabaseCatalog,
  readLocalCatalogFromStorage,
  saveSupabaseProduct,
  saveSupabaseProductTypes,
  replaceSupabaseServiceUsages,
} from "@/lib/products/supabase-catalog";

interface ServiceItem {
  id: string;
  workshop_id: string;
  name: string;
  description: string | null;
  price: number | string;
  duration_minutes: number | null;
  active: boolean;
  category?: string | null;
}

interface ServiceForm {
  name: string;
  category: string;
  description: string;
  price: string;
  durationMinutes: string;
  productUsages: ServiceProductUsage[];
}

const emptyForm: ServiceForm = {
  name: "",
  category: "Outros",
  description: "",
  price: "",
  durationMinutes: "60",
  productUsages: [],
};

const SERVICE_ICON_WEIGHT = "light" as const;

const durationOptions = Array.from({ length: 16 }, (_, index) => {
  const minutes = 30 + index * 30;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return {
    value: String(minutes),
    label:
      hours === 0
        ? "30 min"
        : remainingMinutes === 0
          ? `${hours}h`
          : `${hours}h30`,
  };
});

const SERVICE_FORM_EXIT_MS = 180;
const LEGACY_SERVICE_CATEGORIES_STORAGE_KEY = "auto-estetica-service-categories";
const SERVICE_CATEGORY_OPTIONS_STORAGE_KEY =
  "auto-estetica-service-category-options";

type ServiceStatusFilter = "all" | "active" | "inactive";

interface ServiceCategoryOption {
  value: string;
  label: string;
  custom?: boolean;
}

const defaultServiceCategoryOptions: ServiceCategoryOption[] = [
  { value: "Coating", label: "Coating" },
  { value: "Lavagem", label: "Lavagem" },
  { value: "Polimento", label: "Polimento" },
  { value: "Higienização", label: "Higienização" },
  { value: "Detalhamento", label: "Detalhamento" },
  { value: "Outros", label: "Outros" },
];

const statusFilterOptions = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativo" },
  { value: "inactive", label: "Inativo" },
];

function parsePrice(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Informe um preço válido.");
  }

  return price;
}

function parseDuration(value: string) {
  const duration = Number(value);

  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error("Informe uma duração válida.");
  }

  return duration;
}

function formatDuration(minutes: number | null) {
  if (!minutes) return "0h";

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) return `${remainingMinutes} min`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h${String(remainingMinutes).padStart(2, "0")}`;
}

function getServiceCategory(service: Pick<ServiceItem, "category">) {
  return service.category?.trim() || "Outros";
}

function mergeServiceCategoryOptions(
  services: ServiceItem[],
  customOptions: ServiceCategoryOption[]
) {
  const values = new Set<string>([
    ...defaultServiceCategoryOptions.map((option) => option.value),
    ...services.map((service) => getServiceCategory(service)),
    ...customOptions.map((option) => option.value),
  ]);

  const options: ServiceCategoryOption[] = [];
  defaultServiceCategoryOptions.forEach((option) => {
    if (values.has(option.value)) {
      options.push(option);
      values.delete(option.value);
    }
  });
  customOptions.forEach((option) => {
    if (values.has(option.value)) {
      options.push(option);
      values.delete(option.value);
    }
  });
  values.forEach((value) => {
    options.push({ value, label: value, custom: true });
  });

  return options;
}

async function migrateLegacyServiceCategories(
  supabase: ReturnType<typeof createClient>,
  workshopId: string,
  services: ServiceItem[]
) {
  if (typeof window === "undefined" || services.length === 0) {
    return services;
  }

  const storedCategories = window.localStorage.getItem(
    LEGACY_SERVICE_CATEGORIES_STORAGE_KEY
  );
  if (!storedCategories) {
    return services;
  }

  let legacyCategories: Record<string, string>;
  try {
    legacyCategories = JSON.parse(storedCategories) as Record<string, string>;
  } catch {
    window.localStorage.removeItem(LEGACY_SERVICE_CATEGORIES_STORAGE_KEY);
    return services;
  }

  const pendingUpdates = services.filter((service) => {
    const legacyCategory = legacyCategories[service.id]?.trim();
    return legacyCategory && legacyCategory !== getServiceCategory(service);
  });

  if (pendingUpdates.length > 0) {
    await Promise.all(
      pendingUpdates.map((service) =>
        supabase
          .from("services")
          .update({ category: legacyCategories[service.id] })
          .eq("id", service.id)
          .eq("workshop_id", workshopId)
      )
    );

    const { data } = await supabase
      .from("services")
      .select("*")
      .eq("workshop_id", workshopId)
      .order("active", { ascending: false })
      .order("name", { ascending: true });

    window.localStorage.removeItem(LEGACY_SERVICE_CATEGORIES_STORAGE_KEY);
    return (data as ServiceItem[]) ?? services;
  }

  window.localStorage.removeItem(LEGACY_SERVICE_CATEGORIES_STORAGE_KEY);
  return services;
}

export function ServicesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // Stage packages state (loaded from localStorage overrides merged over defaults)
  // Use static defaults for SSR + first client paint; apply localStorage overrides after mount.
  const [stagePackages, setStagePackages] =
    useState<ServicePackage[]>(STAGE_PACKAGES);
  const [coatingPackages, setCoatingPackages] =
    useState<ServicePackage[]>(COATING_PACKAGES);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [pkgEditPrice, setPkgEditPrice] = useState("");
  const [pkgEditItems, setPkgEditItems] = useState<string[]>([]);
  const [pkgEditNewItem, setPkgEditNewItem] = useState("");
  const [activeTab, setActiveTab] = useState<"coating" | "stages" | "servicos">(
    "stages"
  );
  const servicesTabs = [
    { id: "coating", label: "Coating" },
    { id: "stages", label: "Stages" },
    { id: "servicos", label: "Serviços" },
  ] as const;
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabsRowRef = useRef<HTMLDivElement | null>(null);
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [typeOptions, setTypeOptions] =
    useState<ProductTypeOption[]>(productTypeOptions);
  const [serviceProductUsages, setServiceProductUsages] = useState<
    Record<string, ServiceProductUsage[]>
  >({});
  const [serviceCategoryOptions, setServiceCategoryOptions] = useState<
    ServiceCategoryOption[]
  >(defaultServiceCategoryOptions);
  const [serviceCategoryOptionsLoaded, setServiceCategoryOptionsLoaded] =
    useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<ServiceStatusFilter>("active");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formClosing, setFormClosing] = useState(false);
  const [formAnimationKey, setFormAnimationKey] = useState(0);
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [productForm, setProductForm] =
    useState<ProductForm>(emptyProductForm);
  const [addingProduct, setAddingProduct] = useState(false);
  const [productTypeError, setProductTypeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<ServiceItem | null>(null);
  const [deletingService, setDeletingService] = useState(false);
  const [deleteServiceError, setDeleteServiceError] = useState<string | null>(null);
  const [deleteBlockedByHistory, setDeleteBlockedByHistory] = useState(false);
  const closeFormTimeoutRef = useRef<number | null>(null);
  const catalogSyncStartedRef = useRef(false);

  function clearCloseFormTimeout() {
    if (closeFormTimeoutRef.current) {
      window.clearTimeout(closeFormTimeoutRef.current);
      closeFormTimeoutRef.current = null;
    }
  }

  async function loadServices() {
    setLoading(true);

    const { workshopId: profileWorkshopId } = await fetchOwnWorkshop(supabase);

    if (!profileWorkshopId) {
      setLoading(false);
      return;
    }

    setWorkshopId(profileWorkshopId);

    const { data, error: servicesError } = await supabase
      .from("services")
      .select("*")
      .eq("workshop_id", profileWorkshopId)
      .order("active", { ascending: false })
      .order("name", { ascending: true });

    if (servicesError) {
      setError(servicesError.message);
    } else {
      const loadedServices = await migrateLegacyServiceCategories(
        supabase,
        profileWorkshopId,
        (data as ServiceItem[]) ?? []
      );
      setServices(loadedServices);
    }

    setLoading(false);
  }

  useEffect(() => {
    function updateTabIndicator() {
      const button = tabButtonRefs.current[activeTab];
      const row = tabsRowRef.current;
      if (!button || !row) return;
      setTabIndicator({
        left: button.offsetLeft,
        width: button.offsetWidth,
      });
    }

    updateTabIndicator();
    window.addEventListener("resize", updateTabIndicator);
    return () => window.removeEventListener("resize", updateTabIndicator);
  }, [activeTab]);

  useEffect(() => {
    setStagePackages(loadStagePackages());
    setCoatingPackages(loadCoatingPackages());
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadServices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const storedServiceCategoryOptions = window.localStorage.getItem(
        SERVICE_CATEGORY_OPTIONS_STORAGE_KEY
      );

      if (storedServiceCategoryOptions) {
        try {
          const customCategories = JSON.parse(
            storedServiceCategoryOptions
          ) as ServiceCategoryOption[];
          setServiceCategoryOptions((prev) =>
            mergeServiceCategoryOptions([], [
              ...prev.filter((option) => option.custom),
              ...customCategories,
            ])
          );
        } catch {
          window.localStorage.removeItem(SERVICE_CATEGORY_OPTIONS_STORAGE_KEY);
        }
      }
      setServiceCategoryOptionsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!workshopId || catalogSyncStartedRef.current) {
      return;
    }

    catalogSyncStartedRef.current = true;

    void Promise.resolve().then(async () => {
      try {
        const localCatalog = readLocalCatalogFromStorage();
        if (localCatalog.hasData) {
          await importLocalCatalogToSupabase(
            supabase,
            workshopId,
            localCatalog.products,
            localCatalog.typeOptions,
            localCatalog.serviceProductUsages
          );
          clearLocalCatalogStorage();
        }

        const catalog = await loadSupabaseCatalog(supabase, workshopId);
        setProducts(catalog.products);
        setTypeOptions(catalog.typeOptions);
        setServiceProductUsages(catalog.serviceProductUsages);
      } catch (err) {
        setProductError(
          err instanceof Error
            ? `Produtos no Supabase indisponíveis: ${err.message}`
            : "Produtos no Supabase indisponíveis."
        );
      }
    });
  }, [supabase, workshopId]);

  useEffect(() => {
    if (!serviceCategoryOptionsLoaded) return;

    const customCategories = serviceCategoryOptions.filter(
      (option) => option.custom
    );
    window.localStorage.setItem(
      SERVICE_CATEGORY_OPTIONS_STORAGE_KEY,
      JSON.stringify(customCategories)
    );
  }, [serviceCategoryOptions, serviceCategoryOptionsLoaded]);

  useEffect(() => {
    if (!serviceCategoryOptionsLoaded) return;

    setServiceCategoryOptions((prev) => {
      const merged = mergeServiceCategoryOptions(
        services,
        prev.filter((option) => option.custom)
      );
      const prevValues = prev.map((option) => option.value).join("|");
      const mergedValues = merged.map((option) => option.value).join("|");
      return prevValues === mergedValues ? prev : merged;
    });
  }, [services, serviceCategoryOptionsLoaded]);

  useEffect(() => {
    return clearCloseFormTimeout;
  }, []);

  function showForm() {
    clearCloseFormTimeout();
    setFormClosing(false);
    setFormOpen(true);
    setFormAnimationKey((current) => current + 1);
  }

  function openCreateForm(presetCategory?: string) {
    setEditingService(null);
    const category = presetCategory?.trim() || emptyForm.category;
    if (
      presetCategory &&
      !serviceCategoryOptions.some((option) => option.value === category)
    ) {
      setServiceCategoryOptions((prev) => [
        ...prev,
        { value: category, label: category, custom: true },
      ]);
    }
    setForm({ ...emptyForm, category });
    setError(null);
    setAddingProduct(false);
    setProductFormOpen(false);
    showForm();
  }

  function openEditForm(service: ServiceItem) {
    setEditingService(service);
    setForm({
      name: service.name,
      category: getServiceCategory(service),
      description: service.description ?? "",
      price: String(service.price ?? ""),
      durationMinutes: String(service.duration_minutes ?? 60),
      productUsages: serviceProductUsages[service.id] ?? [],
    });
    setError(null);
    setAddingProduct(false);
    setProductFormOpen(false);
    // do not open the top form — editing is inline in the card
  }

  function closeForm() {
    // If editing inline (no top form open), just reset editing state immediately
    if (!formOpen) {
      setEditingService(null);
      setForm(emptyForm);
      setError(null);
      setAddingProduct(false);
      setProductFormOpen(false);
      return;
    }

    clearCloseFormTimeout();
    setFormClosing(true);

    closeFormTimeoutRef.current = window.setTimeout(() => {
      setEditingService(null);
      setForm(emptyForm);
      setError(null);
      setAddingProduct(false);
      setProductFormOpen(false);
      setFormOpen(false);
      setFormClosing(false);
      closeFormTimeoutRef.current = null;
    }, SERVICE_FORM_EXIT_MS);
  }

  async function handleSaveService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    if (!form.name.trim()) {
      setError("Informe o nome do serviço.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const productUsages = form.productUsages.filter((usage) => {
        const product = products.find((item) => item.id === usage.productId);
        return product && calculateProductUsageCost(product, usage.amount) > 0;
      });
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: parsePrice(form.price || "0"),
        duration_minutes: parseDuration(form.durationMinutes),
        category: form.category,
      };
      let savedServiceId = editingService?.id;

      if (editingService) {
        const { data: updatedRows, error: updateError } = await supabase
          .from("services")
          .update(payload)
          .eq("id", editingService.id)
          .select("id");

        assertMutationRows(updatedRows, updateError, "atualizar o serviço");
      } else {
        const { data: insertedService, error: insertError } = await supabase
          .from("services")
          .insert({
            ...payload,
            workshop_id: workshopId,
          })
          .select("id")
          .single();

        if (insertError) throw insertError;
        savedServiceId = insertedService.id;
      }

      if (savedServiceId) {
        await replaceSupabaseServiceUsages(
          supabase,
          workshopId,
          savedServiceId,
          productUsages
        );
        setServiceProductUsages((prev) => ({
          ...prev,
          [savedServiceId]: productUsages,
        }));
      }

      await loadServices();
      closeForm();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao salvar o serviço."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(service: ServiceItem) {
    const nextActive = !service.active;

    setError(null);

    const { data: updatedRows, error: updateError } = await supabase
      .from("services")
      .update({ active: nextActive })
      .eq("id", service.id)
      .select("id, active");

    try {
      assertMutationRows(
        updatedRows,
        updateError,
        "alterar o status do serviço"
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao alterar o status do serviço."
      );
      return;
    }

    setServices((prev) =>
      prev.map((item) =>
        item.id === service.id ? { ...item, active: nextActive } : item
      )
    );
  }

  function requestDeleteService(service: ServiceItem) {
    setDeleteServiceError(null);
    setDeleteBlockedByHistory(false);
    setServiceToDelete(service);
  }

  async function executeDeleteService(service: ServiceItem) {
    setDeletingService(true);
    setDeleteServiceError(null);

    try {
      const { error: deleteError } = await supabase
        .from("services")
        .delete()
        .eq("id", service.id);

      if (deleteError) {
        if (deleteError.message.includes("foreign key") || deleteError.code === "23503") {
          // Service linked to history — offer to deactivate instead
          setDeleteBlockedByHistory(true);
          return;
        }
        setDeleteServiceError(deleteError.message);
        return;
      }

      setServiceProductUsages((prev) => {
        const next = { ...prev };
        delete next[service.id];
        return next;
      });
      setServiceToDelete(null);
      await loadServices();
    } catch (err) {
      setDeleteServiceError(
        err instanceof Error ? err.message : "Erro ao excluir o serviço."
      );
    } finally {
      setDeletingService(false);
    }
  }

  async function deactivateServiceInsteadOfDelete(service: ServiceItem) {
    setDeletingService(true);
    try {
      await supabase.from("services").update({ active: false }).eq("id", service.id);
      setServiceToDelete(null);
      setDeleteBlockedByHistory(false);
      await loadServices();
    } catch {
      setDeleteServiceError("Erro ao desativar o serviço.");
    } finally {
      setDeletingService(false);
    }
  }

  function closeProductForm() {
    setProductForm(emptyProductForm);
    setProductError(null);
    setProductTypeError(null);
    setProductFormOpen(false);
  }

  function updateProductForm(patch: Partial<ProductForm>) {
    setProductForm((prev) => ({ ...prev, ...patch }));
  }

  function getTypeLabel(type: ProductType) {
    return (
      typeOptions.find((option) => option.value === type)?.label ??
      getProductTypeLabel(type)
    );
  }

  function handleAddProductType(label: string) {
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
    updateProductForm({ type: nextType.value });
    setProductTypeError(null);
  }

  function handleDeleteProductType(type: string) {
    const option = typeOptions.find((item) => item.value === type);
    if (!option?.custom) return;

    const typeInUse = products.some((product) => product.type === type);
    if (typeInUse) {
      setProductTypeError(
        "Não é possível apagar um tipo usado em produtos cadastrados."
      );
      return;
    }

    setTypeOptions((prev) => prev.filter((item) => item.value !== type));
    if (productForm.type === type) {
      updateProductForm({ type: "liquid" });
    }
    setProductTypeError(null);
  }

  async function handleSaveProduct() {
    setProductError(null);

    if (!workshopId) {
      setProductError("Oficina não encontrada.");
      return;
    }

    if (!productForm.name.trim()) {
      setProductError("Informe o nome do produto.");
      return;
    }

    try {
      parsePrice(productForm.totalCost || "0");

      if (productForm.type === "liquid") {
        parsePositiveNumber(productForm.volumeMl);
      } else {
        parsePositiveNumber(productForm.quantity);
      }
    } catch (err) {
      setProductError(
        err instanceof Error ? err.message : "Informe os dados do produto."
      );
      return;
    }

    const nextProduct: ProductItem = {
      id: createProductId(),
      name: productForm.name.trim(),
      type: productForm.type,
      volumeMl: productForm.type === "liquid" ? productForm.volumeMl : "",
      usagePerWashMl: "",
      quantity: productForm.type === "utensil" ? productForm.quantity : "",
      durabilityWashes: "",
      totalCost: productForm.totalCost,
    };

    try {
      await saveSupabaseProduct(supabase, workshopId, nextProduct);
      await saveSupabaseProductTypes(supabase, workshopId, typeOptions);
    } catch (err) {
      setProductError(
        err instanceof Error
          ? `Não foi possível salvar o produto no Supabase: ${err.message}`
          : "Não foi possível salvar o produto no Supabase."
      );
      return;
    }

    setProducts((prev) => [nextProduct, ...prev]);
    setForm((prev) => ({
      ...prev,
      productUsages: [
        ...prev.productUsages,
        {
          id: createUsageId(),
          productId: nextProduct.id,
          amount: nextProduct.type === "liquid" ? "" : "1",
        },
      ],
    }));
    setAddingProduct(false);

    closeProductForm();
  }

  function addProductToService(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    setForm((prev) => {
      if (prev.productUsages.some((usage) => usage.productId === productId)) {
        return prev;
      }

      return {
        ...prev,
        productUsages: [
          ...prev.productUsages,
          {
            id: createUsageId(),
            productId,
            amount: product.type === "liquid" ? "" : "1",
          },
        ],
      };
    });
    setAddingProduct(false);
  }

  function updateProductUsageAmount(usageId: string, amount: string) {
    setForm((prev) => ({
      ...prev,
      productUsages: prev.productUsages.map((usage) =>
        usage.id === usageId ? { ...usage, amount } : usage
      ),
    }));
  }

  function removeProductUsage(usageId: string) {
    setForm((prev) => ({
      ...prev,
      productUsages: prev.productUsages.filter((usage) => usage.id !== usageId),
    }));
  }

  const availableProducts = products.filter(
    (product) =>
      !form.productUsages.some((usage) => usage.productId === product.id)
  );
  const productOptions = availableProducts.map((product) => ({
    value: product.id,
    label: product.name,
  }));
  const serviceProductsTotal = form.productUsages.reduce((total, usage) => {
    const product = products.find((item) => item.id === usage.productId);
    return product ? total + calculateProductUsageCost(product, usage.amount) : total;
  }, 0);

  // Cost is informational only (how much is spent on products for this
  // service) — it must never be netted against/subtracted from the
  // service's price shown to the user.
  function getServiceFinancials(serviceId: string) {
    const usages = serviceProductUsages[serviceId] ?? [];
    const cost = usages.reduce((total, usage) => {
      const product = products.find((item) => item.id === usage.productId);
      return product ? total + calculateProductUsageCost(product, usage.amount) : total;
    }, 0);
    const hasCost = usages.some((usage) => {
      const product = products.find((item) => item.id === usage.productId);
      return product ? calculateProductUsageCost(product, usage.amount) > 0 : false;
    });

    return { cost, hasCost };
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredServices = services.filter((service) => {
    const matchesSearch =
      !normalizedSearchTerm ||
      service.name.toLowerCase().includes(normalizedSearchTerm);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && service.active) ||
      (statusFilter === "inactive" && !service.active);

    return matchesSearch && matchesStatus;
  });
  const servicesByCategory = filteredServices.reduce<Record<string, ServiceItem[]>>(
    (acc, service) => {
      const category = getServiceCategory(service);
      acc[category] = [...(acc[category] ?? []), service];
      return acc;
    },
    {}
  );
  const orderedCategories = Array.from(
    new Set([
      ...serviceCategoryOptions.map((option) => option.value),
      ...Object.keys(servicesByCategory),
    ])
  ).filter((category) => servicesByCategory[category]?.length > 0);

  function openPackageEdit(pkg: ServicePackage) {
    setEditingPackageId(pkg.id);
    setPkgEditPrice(String(pkg.price));
    setPkgEditItems([...pkg.newItems]);
    setPkgEditNewItem("");
  }

  function cancelPackageEdit() {
    setEditingPackageId(null);
    setPkgEditNewItem("");
  }

  function savePackageEdit(pkg: ServicePackage) {
    const price = parseFloat(pkgEditPrice.replace(",", "."));
    if (isNaN(price) || price < 0) return;
    const newItems = pkgEditItems.filter((i) => i.trim() !== "");
    const isCoating = pkg.id.startsWith("coating-");
    if (isCoating) {
      saveCoatingPackageOverride(pkg.id, { price, newItems });
      setCoatingPackages((prev) =>
        prev.map((p) => (p.id === pkg.id ? { ...p, price, newItems } : p))
      );
    } else {
      saveStagePackageOverride(pkg.id, { price, newItems });
      setStagePackages((prev) =>
        prev.map((p) => (p.id === pkg.id ? { ...p, price, newItems } : p))
      );
    }
    setEditingPackageId(null);
    setPkgEditNewItem("");
  }

  async function handleBookPackage(pkg: ServicePackage) {
    const kind = pkg.id.startsWith("coating-") ? "coating" : "stage";
    const catalogName = packageCatalogName(pkg, kind);

    if (workshopId) {
      try {
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
        if (matched) {
          router.push(`/agenda?packageServices=${matched.id}`);
          return;
        }
      } catch {
        // fall through to name lookup below
      }
    }

    const existing = services.find(
      (service) => service.name.trim().toLowerCase() === catalogName.toLowerCase()
    );
    router.push(
      existing ? `/agenda?packageServices=${existing.id}` : "/agenda"
    );
  }

  function handleBookService(serviceId: string) {
    router.push(`/agenda?packageServices=${serviceId}`);
  }

  return (
    <>
      <nav className="mb-6 overflow-x-auto" aria-label="Seções de serviços">
        <div
          ref={tabsRowRef}
          className="relative flex min-w-max items-center gap-8 border-b border-border pb-0 sm:gap-10"
        >
          {servicesTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabButtonRefs.current[tab.id] = node;
                }}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative pb-3 text-sm font-medium tracking-wide transition-colors ${
                  isActive
                    ? "text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {tab.label}
              </button>
            );
          })}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-foreground transition-all duration-300 ease-out"
            style={{
              left: tabIndicator.left,
              width: tabIndicator.width,
            }}
          />
        </div>
      </nav>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {activeTab === "coating" && (
<section className="mb-10 space-y-5">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Coatings Cerâmicos — CarPro
          </h2>
        </div>

        {coatingPackages.map((pkg) => {
          const isGold = pkg.id === "coating-dquartz-go";
          const isEditing = editingPackageId === pkg.id;

          return (
            <div
              key={pkg.id}
              className={`relative overflow-hidden rounded-xl bg-card shadow-card ${
                isGold
                  ? "border border-[#c9a84c]/50 shadow-[0_2px_16px_0_rgba(201,168,76,0.10)]"
                  : "border border-border"
              }`}
            >
              {/* Edit toggle button */}
              <button
                type="button"
                onClick={() => isEditing ? cancelPackageEdit() : openPackageEdit(pkg)}
                className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                title={isEditing ? "Cancelar edição" : "Editar pacote"}
                aria-label={isEditing ? "Cancelar edição" : "Editar pacote"}
              >
                {isEditing
                  ? <X size={13} weight="bold" aria-hidden />
                  : <PencilSimple size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                }
              </button>

              {isEditing ? (
                /* ── Edit form ─────────────────────────────────────── */
                <div className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      className="rounded-md px-2.5 py-1 text-[11px] font-bold tracking-[0.18em]"
                      style={{ background: pkg.badgeBg, color: pkg.badgeText }}
                    >
                      {pkg.badge}
                    </span>
                    <span className="text-sm font-semibold text-foreground">Editar pacote</span>
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    <label className="mb-1 block text-xs font-semibold text-muted">
                      Preço (R$)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pkgEditPrice}
                      onChange={(e) => setPkgEditPrice(e.target.value)}
                      className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none [appearance:textfield] focus:border-primary focus:ring-1 focus:ring-primary/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>

                  {/* Items */}
                  <div className="mb-4">
                    <label className="mb-2 block text-xs font-semibold text-muted">
                      Itens incluídos neste coating
                    </label>
                    <div className="space-y-2">
                      {pkgEditItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const next = [...pkgEditItems];
                              next[idx] = e.target.value;
                              setPkgEditItems(next);
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                          />
                          <button
                            type="button"
                            onClick={() => setPkgEditItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger transition-colors hover:bg-danger hover:text-white"
                            aria-label="Remover item"
                          >
                            <Trash size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add new item */}
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={pkgEditNewItem}
                        onChange={(e) => setPkgEditNewItem(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && pkgEditNewItem.trim()) {
                            e.preventDefault();
                            setPkgEditItems((prev) => [...prev, pkgEditNewItem.trim()]);
                            setPkgEditNewItem("");
                          }
                        }}
                        placeholder="Novo serviço... (Enter para adicionar)"
                        className="min-w-0 flex-1 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!pkgEditNewItem.trim()) return;
                          setPkgEditItems((prev) => [...prev, pkgEditNewItem.trim()]);
                          setPkgEditNewItem("");
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success transition-colors hover:bg-success hover:text-white"
                        aria-label="Adicionar item"
                      >
                        <Plus size={13} weight="bold" aria-hidden />
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => savePackageEdit(pkg)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-success/90"
                    >
                      Salvar alterações
                    </button>
                    <button
                      type="button"
                      onClick={cancelPackageEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-muted transition-colors hover:bg-card"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Normal view ────────────────────────────────────── */
                <div className="flex flex-col gap-0 sm:flex-row">
                  {/* LEFT — badge + price */}
                  <div
                    className="flex shrink-0 flex-col justify-between gap-6 rounded-tl-xl rounded-bl-xl p-5 sm:w-52 sm:rounded-tr-none sm:rounded-bl-xl"
                    style={isGold ? { background: "rgba(201,168,76,0.07)" } : { background: "var(--color-background, transparent)" }}
                  >
                    <div className="flex flex-col gap-2">
                      <span
                        className="self-start rounded-md px-2.5 py-1 text-[11px] font-bold tracking-[0.18em]"
                        style={{ background: pkg.badgeBg, color: pkg.badgeText }}
                      >
                        {pkg.badge}
                      </span>
                    </div>
                    <div>
                      <p
                        className="whitespace-nowrap text-xl font-extrabold leading-tight tracking-tight tabular-nums sm:text-2xl"
                        style={isGold ? { color: "#c9a84c" } : undefined}
                      >
                        {formatCurrency(pkg.price)}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleBookPackage(pkg)}
                        className={`mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          isGold
                            ? "border-[#c9a84c]/60 bg-[#c9a84c]/10 text-[#a07830] hover:bg-[#c9a84c]/20"
                            : "border-success/30 bg-success/10 text-success hover:bg-success/20"
                        }`}
                      >
                        <CalendarBlank size={13} weight="bold" aria-hidden />
                        Agendar
                      </button>
                    </div>
                  </div>

                  {/* RIGHT — items list */}
                  <div className="flex-1 p-5">
                    {pkg.subtitle && (
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        {pkg.subtitle}
                      </p>
                    )}
                    <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      {pkg.newItems.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                          <CheckCircle
                            size={15}
                            weight="fill"
                            className="mt-0.5 shrink-0 text-success"
                            aria-hidden
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
      )}

      {activeTab === "stages" && (
<section className="mb-10 space-y-5">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Pacotes — Lavagem Detalhada por Stages
          </h2>
        </div>

        {stagePackages.map((pkg) => {
          const isGold = pkg.id === "stage-4";
          const isEditing = editingPackageId === pkg.id;

          return (
            <div
              key={pkg.id}
              className={`relative overflow-hidden rounded-xl bg-card shadow-card ${
                isGold
                  ? "border border-[#c9a84c]/50 shadow-[0_2px_16px_0_rgba(201,168,76,0.10)]"
                  : "border border-border"
              }`}
            >
              {/* Edit toggle button */}
              <button
                type="button"
                onClick={() => isEditing ? cancelPackageEdit() : openPackageEdit(pkg)}
                className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                title={isEditing ? "Cancelar edição" : "Editar pacote"}
                aria-label={isEditing ? "Cancelar edição" : "Editar pacote"}
              >
                {isEditing
                  ? <X size={13} weight="bold" aria-hidden />
                  : <PencilSimple size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                }
              </button>

              {isEditing ? (
                /* ── Edit form ─────────────────────────────────────── */
                <div className="p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      className="rounded-md px-2.5 py-1 text-[11px] font-bold tracking-[0.18em]"
                      style={{ background: pkg.badgeBg, color: pkg.badgeText }}
                    >
                      {pkg.badge}
                    </span>
                    <span className="text-sm font-semibold text-foreground">Editar pacote</span>
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    <label className="mb-1 block text-xs font-semibold text-muted">
                      Preço (R$)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pkgEditPrice}
                      onChange={(e) => setPkgEditPrice(e.target.value)}
                      className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm font-bold text-foreground outline-none [appearance:textfield] focus:border-primary focus:ring-1 focus:ring-primary/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>

                  {/* Items */}
                  <div className="mb-4">
                    <label className="mb-2 block text-xs font-semibold text-muted">
                      Serviços incluídos neste stage
                    </label>
                    <div className="space-y-2">
                      {pkgEditItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const next = [...pkgEditItems];
                              next[idx] = e.target.value;
                              setPkgEditItems(next);
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                          />
                          <button
                            type="button"
                            onClick={() => setPkgEditItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger transition-colors hover:bg-danger hover:text-white"
                            aria-label="Remover item"
                          >
                            <Trash size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add new item */}
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={pkgEditNewItem}
                        onChange={(e) => setPkgEditNewItem(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && pkgEditNewItem.trim()) {
                            e.preventDefault();
                            setPkgEditItems((prev) => [...prev, pkgEditNewItem.trim()]);
                            setPkgEditNewItem("");
                          }
                        }}
                        placeholder="Novo serviço... (Enter para adicionar)"
                        className="min-w-0 flex-1 rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!pkgEditNewItem.trim()) return;
                          setPkgEditItems((prev) => [...prev, pkgEditNewItem.trim()]);
                          setPkgEditNewItem("");
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success transition-colors hover:bg-success hover:text-white"
                        aria-label="Adicionar item"
                      >
                        <Plus size={13} weight="bold" aria-hidden />
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 border-t border-border pt-4">
                    <button
                      type="button"
                      onClick={() => savePackageEdit(pkg)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-success/90"
                    >
                      Salvar alterações
                    </button>
                    <button
                      type="button"
                      onClick={cancelPackageEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-muted transition-colors hover:bg-card"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Normal view ────────────────────────────────────── */
                <div className="flex flex-col gap-0 sm:flex-row">
                  {/* LEFT — badge + price */}
                  <div
                    className="flex shrink-0 flex-col justify-between gap-6 rounded-tl-xl rounded-bl-xl p-5 sm:w-52 sm:rounded-tr-none sm:rounded-bl-xl"
                    style={isGold ? { background: "rgba(201,168,76,0.07)" } : { background: "var(--color-background, transparent)" }}
                  >
                    <div className="flex flex-col gap-2">
                      <span
                        className="self-start rounded-md px-2.5 py-1 text-[11px] font-bold tracking-[0.18em]"
                        style={{ background: pkg.badgeBg, color: pkg.badgeText }}
                      >
                        {pkg.badge}
                      </span>
                    </div>
                    <div>
                      <p
                        className="whitespace-nowrap text-xl font-extrabold leading-tight tracking-tight tabular-nums sm:text-2xl"
                        style={isGold ? { color: "#c9a84c" } : undefined}
                      >
                        {formatCurrency(pkg.price)}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleBookPackage(pkg)}
                        className={`mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          isGold
                            ? "border-[#c9a84c]/60 bg-[#c9a84c]/10 text-[#a07830] hover:bg-[#c9a84c]/20"
                            : "border-success/30 bg-success/10 text-success hover:bg-success/20"
                        }`}
                      >
                        <CalendarBlank size={13} weight="bold" aria-hidden />
                        Agendar
                      </button>
                    </div>
                  </div>

                  {/* RIGHT — items list */}
                  <div className="flex-1 p-5">
                    {pkg.subtitle && (
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        {pkg.subtitle}
                      </p>
                    )}
                    <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      {pkg.newItems.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                          <CheckCircle
                            size={15}
                            weight="fill"
                            className="mt-0.5 shrink-0 text-success"
                            aria-hidden
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
      )}

      {activeTab === "servicos" && (
        <>
      <div className="mb-5 flex justify-stretch sm:mb-6 sm:justify-end">
        <Button variant="success" onClick={() => openCreateForm()} className="w-full sm:w-auto">
          <Plus size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
          Novo serviço
        </Button>
      </div>

      {formOpen && !editingService && (
        <form
          key={formAnimationKey}
          onSubmit={handleSaveService}
          autoComplete="off"
          className={`mb-6 rounded-lg border border-border bg-card shadow-card p-4 shadow-card sm:p-6 ${
            formClosing ? "service-form-exit" : "service-form-enter"
          }`}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {editingService ? "Editar serviço" : "Novo serviço"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Cadastre os serviços que poderão ser usados na agenda.
              </p>
            </div>
            <button
              type="button"
              onClick={closeForm}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground sm:min-h-0 sm:min-w-0 sm:p-2"
              aria-label="Fechar formulário"
            >
              <X size={20} weight={SERVICE_ICON_WEIGHT} aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Nome do serviço"
              value={form.name}
              autoComplete="off"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Lavagem completa"
            />
            <Input
              label="Preço base"
              prefix="R$"
              value={form.price}
              autoComplete="off"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, price: event.target.value }))
              }
              placeholder="150,00"
            />
            <Dropdown
              id="service-duration"
              label="Duração em horas"
              value={form.durationMinutes}
              options={durationOptions}
              onChange={(durationMinutes) =>
                setForm((prev) => ({
                  ...prev,
                  durationMinutes,
                }))
              }
            />
            <Input
              label="Descrição"
              value={form.description}
              autoComplete="off"
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Detalhes do serviço"
            />
          </div>

          <div className="mt-5 rounded-lg border border-border bg-background shadow-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Produtos utilizados neste serviço
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Escolha produtos do catálogo e informe quanto será usado.
                </p>
              </div>

              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <button
                  type="button"
                  onClick={() => setAddingProduct(true)}
                  disabled={availableProducts.length === 0}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-success/10 px-3 py-2 text-sm font-semibold text-success transition-all hover:bg-success hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:justify-center sm:py-1.5 sm:text-xs"
                >
                  <Plus size={14} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                  Adicionar produto
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProductForm(emptyProductForm);
                    setProductError(null);
                    setProductTypeError(null);
                    setProductFormOpen(true);
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-success/10 px-3 py-2 text-sm font-semibold text-success transition-all hover:bg-success hover:text-white sm:min-h-0 sm:justify-center sm:py-1.5 sm:text-xs"
                >
                  <Plus size={14} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                  Cadastrar novo produto
                </button>
              </div>
            </div>

            {addingProduct && (
              <div className="mt-4">
                <Dropdown
                  label="Selecionar produto"
                  value=""
                  placeholder={
                    availableProducts.length === 0
                      ? "Todos os produtos já foram adicionados"
                      : "Selecione um produto"
                  }
                  options={productOptions}
                  onChange={addProductToService}
                  disabled={availableProducts.length === 0}
                />
              </div>
            )}

            {products.length === 0 && (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-3 text-center text-xs text-muted">
                Nenhum produto cadastrado no catálogo.
              </p>
            )}

            {productError && (
              <div className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                {productError}
              </div>
            )}

            {productFormOpen && (
              <div className="mt-4 rounded-lg border border-border bg-card shadow-card p-4 shadow-card">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">
                    Produto rápido
                  </h4>
                  <button
                    type="button"
                    onClick={closeProductForm}
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                    aria-label="Fechar produto rápido"
                  >
                    <X size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Nome do produto"
                    value={productForm.name}
                    autoComplete="off"
                    onChange={(event) =>
                      updateProductForm({ name: event.target.value })
                    }
                    placeholder="Shampoo automotivo"
                  />
                  <Dropdown
                    label="Tipo"
                    value={productForm.type}
                    options={typeOptions}
                    onChange={(type) => {
                      updateProductForm({ type: type as ProductType });
                      setProductTypeError(null);
                    }}
                    actionLabel="Adicionar"
                    createPlaceholder="Ex: Cera, Equipamento, Químico"
                    onCreateOption={handleAddProductType}
                    onDeleteOption={handleDeleteProductType}
                  />

                  {productTypeError && (
                    <p className="text-xs font-medium text-danger">
                      {productTypeError}
                    </p>
                  )}

                  {productForm.type === "liquid" ? (
                    <Input
                      label="Volume total (ml)"
                      type="number"
                      min="0"
                      step="1"
                      value={productForm.volumeMl}
                      onChange={(event) =>
                        updateProductForm({ volumeMl: event.target.value })
                      }
                      placeholder="5000"
                    />
                  ) : (
                    <Input
                      label="Quantidade"
                      type="number"
                      min="0"
                      step="1"
                      value={productForm.quantity}
                      onChange={(event) =>
                        updateProductForm({ quantity: event.target.value })
                      }
                      placeholder="3"
                    />
                  )}

                  <Input
                    label="Custo total do produto"
                    value={productForm.totalCost}
                    autoComplete="off"
                    onChange={(event) =>
                      updateProductForm({ totalCost: event.target.value })
                    }
                    placeholder="80,00"
                  />
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeProductForm}
                    className="w-full sm:w-auto"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    onClick={handleSaveProduct}
                    className="w-full sm:w-auto"
                  >
                    Salvar e adicionar
                  </Button>
                </div>
              </div>
            )}

            {form.productUsages.length > 0 && (
              <div className="mt-4 space-y-3">
                {form.productUsages.map((usage) => {
                  const product = products.find(
                    (item) => item.id === usage.productId
                  );
                  if (!product) return null;

                  const usageCost = calculateProductUsageCost(
                    product,
                    usage.amount
                  );

                  return (
                    <div
                      key={usage.id}
                      className="rounded-lg border border-border bg-card shadow-card p-4 shadow-card"
                    >
                  <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {product.name}
                          </p>
                          <p className="text-xs text-muted">
                            {getTypeLabel(product.type)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProductUsage(usage.id)}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-danger/10 p-2 text-danger transition-colors hover:bg-danger hover:text-white sm:min-h-0 sm:min-w-0"
                          aria-label={`Remover ${product.name}`}
                        >
                          <X size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <Input
                          label={getProductAmountLabel(product.type)}
                          type="number"
                          min="0"
                          step={product.type === "liquid" ? "1" : "0.01"}
                          value={usage.amount}
                          onChange={(event) =>
                            updateProductUsageAmount(
                              usage.id,
                              event.target.value
                            )
                          }
                          placeholder={product.type === "liquid" ? "50" : "1"}
                        />
                        <div className="rounded-lg border border-success/20 bg-success/10 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-success">
                            Custo
                          </p>
                          <p className="text-base font-bold text-success">
                            {formatCurrency(usageCost)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="flex flex-col gap-1 rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium text-muted">
                    Custo total de produtos
                  </span>
                  <span className="text-base font-bold text-foreground">
                    {formatCurrency(serviceProductsTotal)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={closeForm}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="success"
              loading={saving}
              className="w-full sm:w-auto"
            >
              Salvar serviço
            </Button>
          </div>
        </form>
      )}

      {activeTab === "servicos" && (
        <>
      <div className="mb-5 rounded-lg border border-border bg-card p-3 shadow-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              label="Buscar serviço"
              value={searchTerm}
              autoComplete="off"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Digite o nome do serviço"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 self-end sm:pb-0.5">
            <span className="hidden text-xs font-medium text-muted sm:inline">
              {filteredServices.length} serviço
              {filteredServices.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => setFiltersExpanded((open) => !open)}
              aria-expanded={filtersExpanded}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors sm:min-h-0 ${
                filtersExpanded || statusFilter !== "all"
                  ? "border-premium/40 bg-premium/10 text-premium"
                  : "border-border bg-input text-foreground hover:bg-background"
              }`}
            >
              <Funnel size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
              Filtros
              {statusFilter !== "all" && (
                <span className="flex h-2 w-2 rounded-full bg-premium" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {!filtersExpanded && (
          <p className="mt-2 text-xs font-medium text-muted sm:hidden">
            {filteredServices.length} serviço
            {filteredServices.length !== 1 ? "s" : ""} encontrado
            {filteredServices.length !== 1 ? "s" : ""}
          </p>
        )}

        {filtersExpanded && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <Dropdown
              label="Status"
              value={statusFilter}
              options={statusFilterOptions}
              onChange={(status) => setStatusFilter(status as ServiceStatusFilter)}
            />
            <p className="text-xs font-medium text-muted sm:col-span-2">
              {filteredServices.length} serviço
              {filteredServices.length !== 1 ? "s" : ""} encontrado
              {filteredServices.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

        </>
      )}

      {loading ? (
        <div className="rounded-lg border border-border bg-card shadow-card py-16 text-center text-sm text-muted shadow-card">
          Carregando serviços...
        </div>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card shadow-card py-16 text-center shadow-card">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <Wrench size={28} weight={SERVICE_ICON_WEIGHT} className="text-success" aria-hidden />
          </div>
          <p className="font-medium text-foreground">
            Nenhum serviço cadastrado
          </p>
          <p className="mt-1 text-sm text-muted">
            Crie sua lista para usar os serviços na agenda.
          </p>
          <Button
            variant="success"
            className="mt-4 w-full sm:w-auto"
            onClick={() => openCreateForm()}
          >
            <Plus size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
            Novo serviço
          </Button>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card py-14 text-center shadow-card">
          <p className="font-medium text-foreground">
            Nenhum serviço encontrado
          </p>
          <p className="mt-1 text-sm text-muted">
            Ajuste a busca ou os filtros para ver outros resultados.
          </p>
        </div>
      ) : (
        <div>
          {/* Service cards — single container with dividers */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card divide-y divide-border">
            {filteredServices.map((service) => {
                  const financials = getServiceFinancials(service.id);

                  const isEditingThis = editingService?.id === service.id;

                  return (
                    <article
                      key={service.id}
                      className={`transition-colors ${
                        isEditingThis
                          ? "bg-background/60"
                          : `flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5 sm:py-4 hover:bg-background/40 ${service.active ? "" : "opacity-60"}`
                      }`}
                    >
                      {isEditingThis ? (
                        /* ── Inline edit form ───────────────────────────────────── */
                        <form onSubmit={handleSaveService} autoComplete="off" className="w-full p-4 sm:p-5">
                          {/* Header */}
                          <div className="mb-4 flex items-center justify-between gap-4">
                            <div>
                              <h3 className="text-sm font-semibold text-foreground">
                                Editar serviço
                              </h3>
                              <p className="mt-0.5 text-xs text-muted">{service.name}</p>
                            </div>
                            <button
                              type="button"
                              onClick={closeForm}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
                              aria-label="Fechar edição"
                            >
                              <X size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                            </button>
                          </div>

                          {/* Fields */}
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <Input
                              label="Nome do serviço"
                              value={form.name}
                              autoComplete="off"
                              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                              placeholder="Lavagem completa"
                            />
                            <Input
                              label="Preço base"
                              prefix="R$"
                              value={form.price}
                              autoComplete="off"
                              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                              placeholder="150,00"
                            />
                            <Dropdown
                              id="service-duration-inline"
                              label="Duração em horas"
                              value={form.durationMinutes}
                              options={durationOptions}
                              onChange={(durationMinutes) => setForm((prev) => ({ ...prev, durationMinutes }))}
                            />
                            <Input
                              label="Descrição"
                              value={form.description}
                              autoComplete="off"
                              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                              placeholder="Detalhes do serviço"
                            />
                          </div>

                          {/* Products section */}
                          <div className="mt-5 rounded-lg border border-border bg-card p-4 sm:p-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h4 className="text-sm font-semibold text-foreground">
                                  Produtos utilizados neste serviço
                                </h4>
                                <p className="mt-1 text-xs text-muted">
                                  Escolha produtos do catálogo e informe quanto será usado.
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                                <button
                                  type="button"
                                  onClick={() => setAddingProduct(true)}
                                  disabled={availableProducts.length === 0}
                                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-success/10 px-3 py-2 text-sm font-semibold text-success transition-all hover:bg-success hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1.5 sm:text-xs"
                                >
                                  <Plus size={14} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                  Adicionar produto
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setProductForm(emptyProductForm); setProductError(null); setProductTypeError(null); setProductFormOpen(true); }}
                                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-success/10 px-3 py-2 text-sm font-semibold text-success transition-all hover:bg-success hover:text-white sm:min-h-0 sm:py-1.5 sm:text-xs"
                                >
                                  <Plus size={14} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                  Cadastrar novo produto
                                </button>
                              </div>
                            </div>

                            {addingProduct && (
                              <div className="mt-4">
                                <Dropdown
                                  label="Selecionar produto"
                                  value=""
                                  placeholder={availableProducts.length === 0 ? "Todos os produtos já foram adicionados" : "Selecione um produto"}
                                  options={productOptions}
                                  onChange={addProductToService}
                                  disabled={availableProducts.length === 0}
                                />
                              </div>
                            )}

                            {products.length === 0 && (
                              <p className="mt-4 rounded-lg border border-dashed border-border bg-background px-4 py-3 text-center text-xs text-muted">
                                Nenhum produto cadastrado no catálogo.
                              </p>
                            )}

                            {productError && (
                              <div className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                                {productError}
                              </div>
                            )}

                            {productFormOpen && (
                              <div className="mt-4 rounded-lg border border-border bg-background p-4">
                                <div className="mb-4 flex items-center justify-between">
                                  <h4 className="text-sm font-semibold text-foreground">Produto rápido</h4>
                                  <button type="button" onClick={closeProductForm} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card hover:text-foreground" aria-label="Fechar produto rápido">
                                    <X size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                  <Input label="Nome do produto" value={productForm.name} autoComplete="off" onChange={(e) => updateProductForm({ name: e.target.value })} placeholder="Shampoo automotivo" />
                                  <Dropdown label="Tipo" value={productForm.type} options={typeOptions} onChange={(type) => { updateProductForm({ type: type as ProductType }); setProductTypeError(null); }} actionLabel="Adicionar" createPlaceholder="Ex: Cera, Equipamento, Químico" onCreateOption={handleAddProductType} onDeleteOption={handleDeleteProductType} />
                                  {productTypeError && <p className="text-xs font-medium text-danger">{productTypeError}</p>}
                                  {productForm.type === "liquid" ? (
                                    <Input label="Volume total (ml)" type="number" min="0" step="1" value={productForm.volumeMl} onChange={(e) => updateProductForm({ volumeMl: e.target.value })} placeholder="5000" />
                                  ) : (
                                    <Input label="Quantidade" type="number" min="0" step="1" value={productForm.quantity} onChange={(e) => updateProductForm({ quantity: e.target.value })} placeholder="3" />
                                  )}
                                  <Input label="Custo total do produto" value={productForm.totalCost} autoComplete="off" onChange={(e) => updateProductForm({ totalCost: e.target.value })} placeholder="80,00" />
                                </div>
                                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                                  <Button type="button" variant="secondary" onClick={closeProductForm} className="w-full sm:w-auto">Cancelar</Button>
                                  <Button type="button" variant="success" onClick={handleSaveProduct} className="w-full sm:w-auto">Salvar e adicionar</Button>
                                </div>
                              </div>
                            )}

                            {form.productUsages.length > 0 && (
                              <div className="mt-4 space-y-3">
                                {form.productUsages.map((usage) => {
                                  const product = products.find((item) => item.id === usage.productId);
                                  if (!product) return null;
                                  const usageCost = calculateProductUsageCost(product, usage.amount);
                                  return (
                                    <div key={usage.id} className="rounded-lg border border-border bg-background p-4">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="text-sm font-semibold text-foreground">{product.name}</p>
                                          <p className="text-xs text-muted">{getTypeLabel(product.type)}</p>
                                        </div>
                                        <button type="button" onClick={() => removeProductUsage(usage.id)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-danger/10 p-2 text-danger transition-colors hover:bg-danger hover:text-white sm:min-h-0 sm:min-w-0" aria-label={`Remover ${product.name}`}>
                                          <X size={16} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                        </button>
                                      </div>
                                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                                        <Input label={getProductAmountLabel(product.type)} type="number" min="0" step={product.type === "liquid" ? "1" : "0.01"} value={usage.amount} onChange={(e) => updateProductUsageAmount(usage.id, e.target.value)} placeholder="0" />
                                        {usageCost !== null && (
                                          <p className="pb-2 text-sm font-semibold text-foreground sm:text-right">
                                            Custo: {formatCurrency(usageCost)}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {error && (
                            <div className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                              {error}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                            <Button type="button" variant="secondary" onClick={closeForm} className="w-full sm:w-auto">
                              Cancelar
                            </Button>
                            <Button type="submit" variant="success" disabled={saving} className="w-full sm:w-auto">
                              {saving ? "Salvando…" : "Salvar alterações"}
                            </Button>
                          </div>
                        </form>
                      ) : (
                        /* ── Normal card view ───────────────────────────────────── */
                        <>
                          {/* Left: name, badges, duration, description */}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-sans text-sm font-semibold text-foreground">
                                {service.name}
                              </h3>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  service.active
                                    ? "bg-success/10 text-success"
                                    : "bg-muted/10 text-muted"
                                }`}
                              >
                                {service.active ? "Ativo" : "Inativo"}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                              <Clock size={12} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                              {formatDuration(service.duration_minutes)}
                            </div>
                            {service.description && (
                              <p className="mt-1.5 line-clamp-2 text-xs text-muted">
                                {service.description}
                              </p>
                            )}
                          </div>

                          {/* Right: price block + agendar + icon actions */}
                          <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-2">
                            {/* Financials */}
                            <div className="text-right">
                              <p className="text-base font-bold leading-tight text-foreground">
                                {formatCurrency(Number(service.price))}
                              </p>
                              {financials.hasCost && (
                                <p className="text-[11px] leading-tight text-muted">
                                  Custo em produtos {formatCurrency(financials.cost)}
                                </p>
                              )}
                            </div>

                            {/* Agendar + icon actions stacked */}
                            <div className="flex flex-col items-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleBookService(service.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20"
                                title="Agendar serviço"
                                aria-label="Agendar serviço"
                              >
                                <CalendarBlank size={12} weight="bold" aria-hidden />
                                Agendar
                              </button>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditForm(service)}
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted/60 transition-colors hover:bg-background hover:text-foreground"
                                  title="Editar"
                                  aria-label="Editar serviço"
                                >
                                  <PencilSimple size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActive(service)}
                                  className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-background ${
                                    service.active ? "text-muted/60 hover:text-primary" : "text-muted/60 hover:text-foreground"
                                  }`}
                                  title={service.active ? "Desativar" : "Ativar"}
                                  aria-label={service.active ? "Desativar serviço" : "Ativar serviço"}
                                >
                                  <Power size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => requestDeleteService(service)}
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted/60 transition-colors hover:bg-background hover:text-danger"
                                  title="Excluir"
                                  aria-label="Excluir serviço"
                                >
                                  <Trash size={13} weight={SERVICE_ICON_WEIGHT} aria-hidden />
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
          </div>
        </div>
      )}
        </>
      )}

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .service-form-enter {
            animation: service-form-enter 220ms ease-out both;
            transform-origin: top center;
          }

          .service-form-exit {
            animation: service-form-exit ${SERVICE_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
            transform-origin: top center;
          }
        }

        @keyframes service-form-enter {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes service-form-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
          }
        }
      `}</style>

      <ConfirmDialog
        open={Boolean(serviceToDelete)}
        title={deleteBlockedByHistory ? "Serviço com histórico" : "Excluir serviço"}
        description={
          deleteBlockedByHistory
            ? `"${serviceToDelete?.name}" está vinculado a agendamentos anteriores. O histórico será mantido — deseja desativar o serviço para que não apareça mais em novos agendamentos?`
            : deleteServiceError
            ? deleteServiceError
            : serviceToDelete
            ? `Deseja excluir o serviço "${serviceToDelete.name}"? Esta ação não pode ser desfeita.`
            : ""
        }
        confirmLabel={deleteBlockedByHistory ? "Desativar serviço" : "Excluir serviço"}
        loading={deletingService}
        onCancel={() => {
          if (!deletingService) {
            setServiceToDelete(null);
            setDeleteServiceError(null);
            setDeleteBlockedByHistory(false);
          }
        }}
        onConfirm={() => {
          if (deleteBlockedByHistory && serviceToDelete) {
            void deactivateServiceInsteadOfDelete(serviceToDelete);
          } else if (serviceToDelete && !deleteServiceError) {
            void executeDeleteService(serviceToDelete);
          } else {
            setServiceToDelete(null);
            setDeleteServiceError(null);
          }
        }}
      />
    </>
  );
}
