"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MagnifyingGlass, Plus, Trash } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import {
  buildQuoteCatalogOptions,
  resolveCatalogOption,
  type QuoteCatalogOption,
  type QuoteServiceRow,
} from "@/lib/quotes/catalog";
import {
  QUOTE_KIND_LABEL,
  quoteKindBadgeClasses,
  type QuoteItemKind,
} from "@/lib/quotes/types";
import { formatCurrency } from "@/lib/utils/format";

const ICON_WEIGHT = "light" as const;
const CATALOG_KIND_ORDER: QuoteItemKind[] = ["coating", "stage", "servico"];

export interface ResolvedCatalogItem {
  serviceId: string;
  name: string;
  kind: QuoteItemKind;
  price: number;
}

function useMoreContentBelow(active: boolean, watch: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    function update() {
      const node = ref.current;
      if (!node) return;
      setVisible(node.scrollHeight - node.scrollTop - node.clientHeight > 8);
    }

    const el = ref.current;
    if (!el) return;

    update();
    const frame = window.requestAnimationFrame(update);
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      window.cancelAnimationFrame(frame);
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [active, watch]);

  return { ref, showMoreBelow: visible };
}

interface SelectedCatalogItemsProps {
  items: ResolvedCatalogItem[];
  onRemove: (serviceId: string) => void;
  onSelect: () => void;
  emptyText?: string;
  label?: string;
}

export function SelectedCatalogItems({
  items,
  onRemove,
  onSelect,
  emptyText = "Nenhum item ainda. Selecione coatings, stages ou serviços.",
  label = "Itens",
}: SelectedCatalogItemsProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="label-caps">{label}</p>
        <button
          type="button"
          onClick={onSelect}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-white"
        >
          <Plus size={12} weight={ICON_WEIGHT} aria-hidden />
          Selecionar
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">{emptyText}</p>
        ) : (
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-1/2" />
              <col className="w-1/5" />
              <col className="w-1/4" />
              <col className="w-[5%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Serviço
                </th>
                <th className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Tipo
                </th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Valor
                </th>
                <th>
                  <span className="sr-only">Remover</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.serviceId}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="truncate px-3 py-2 text-sm font-medium text-foreground">
                    {item.name}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${quoteKindBadgeClasses(item.kind)}`}
                    >
                      {QUOTE_KIND_LABEL[item.kind]}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-base font-semibold tabular-nums text-foreground">
                    {formatCurrency(item.price)}
                  </td>
                  <td className="px-1 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onRemove(item.serviceId)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                      aria-label={`Remover ${item.name}`}
                    >
                      <Trash size={14} weight={ICON_WEIGHT} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface ServiceCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  services: QuoteServiceRow[];
  excludedServiceIds: Set<string>;
  supabase: SupabaseClient;
  workshopId: string;
  description?: string;
  onAdded: (
    items: ResolvedCatalogItem[],
    latestServices: QuoteServiceRow[]
  ) => void | Promise<void>;
}

export function ServiceCatalogDialog({
  open,
  onClose,
  services,
  excludedServiceIds,
  supabase,
  workshopId,
  description = "Marque quantos quiser e confirme para adicionar.",
  onAdded,
}: ServiceCatalogDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ignoreOverlayCloseRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedKeys([]);
    setError(null);
    ignoreOverlayCloseRef.current = true;
    const timeout = window.setTimeout(() => {
      ignoreOverlayCloseRef.current = false;
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open || saving) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, saving, onClose]);

  const catalogOptions = useMemo(
    () => buildQuoteCatalogOptions(services),
    [services]
  );
  const addableCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalogOptions.filter((option) => {
      if (option.serviceId && excludedServiceIds.has(option.serviceId)) {
        return false;
      }
      if (!query) return true;
      return (
        option.name.toLowerCase().includes(query) ||
        QUOTE_KIND_LABEL[option.kind].toLowerCase().includes(query)
      );
    });
  }, [catalogOptions, excludedServiceIds, search]);
  const catalogGroups = useMemo(
    () =>
      CATALOG_KIND_ORDER.map((kind) => ({
        kind,
        options: addableCatalog.filter((option) => option.kind === kind),
      })).filter((group) => group.options.length > 0),
    [addableCatalog]
  );
  const catalogScroll = useMoreContentBelow(open, addableCatalog.length);
  const selectedOptions = catalogOptions.filter((option) =>
    selectedKeys.includes(option.key)
  );
  const selectedTotal = selectedOptions.reduce(
    (sum, option) => sum + option.price,
    0
  );

  function toggleOption(option: QuoteCatalogOption) {
    setSelectedKeys((prev) =>
      prev.includes(option.key)
        ? prev.filter((key) => key !== option.key)
        : [...prev, option.key]
    );
  }

  async function handleConfirm() {
    if (!workshopId || selectedKeys.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextItems: ResolvedCatalogItem[] = [];
      let latestServices = services;

      for (const key of selectedKeys) {
        const option = catalogOptions.find((item) => item.key === key);
        if (!option) continue;

        const resolved = await resolveCatalogOption(
          supabase,
          workshopId,
          latestServices,
          option
        );
        if (
          excludedServiceIds.has(resolved.serviceId) ||
          nextItems.some((item) => item.serviceId === resolved.serviceId)
        ) {
          continue;
        }

        nextItems.push({
          serviceId: resolved.serviceId,
          name: resolved.name,
          kind: resolved.kind,
          price: resolved.price,
        });

        if (!latestServices.some((service) => service.id === resolved.serviceId)) {
          latestServices = [
            ...latestServices,
            {
              id: resolved.serviceId,
              name: resolved.name,
              price: resolved.price,
              duration_minutes: null,
              active: true,
              category: resolved.kind,
            },
          ];
        }
      }

      if (nextItems.length > 0) {
        await onAdded(nextItems, latestServices);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível adicionar os itens."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center bg-foreground/25 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (ignoreOverlayCloseRef.current || saving) return;
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-catalog-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card-hover"
      >
        <div className="shrink-0 px-4 pt-3">
          <h2
            id="service-catalog-title"
            className="text-base font-semibold text-foreground"
          >
            Selecionar itens
          </h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>

        <div className="shrink-0 px-4 pt-2">
          <div className="relative">
            <MagnifyingGlass
              size={15}
              weight={ICON_WEIGHT}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar coating, stage ou serviço..."
              autoFocus
              className="w-full rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        <div
          ref={catalogScroll.ref}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {catalogGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              Nenhum item disponível para adicionar.
            </p>
          ) : (
            <div className="space-y-3">
              {catalogGroups.map((group) => (
                <section key={group.kind}>
                  <p className="label-caps mb-1.5">
                    {QUOTE_KIND_LABEL[group.kind]}
                  </p>
                  <ul className="overflow-hidden rounded-md border border-border">
                    {group.options.map((option) => {
                      const selected = selectedKeys.includes(option.key);
                      return (
                        <li
                          key={option.key}
                          className="border-b border-border last:border-b-0"
                        >
                          <button
                            type="button"
                            onClick={() => toggleOption(option)}
                            className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_6rem] items-center gap-2.5 px-2.5 py-2 text-left transition-colors ${
                              selected ? "bg-premium/10" : "hover:bg-background"
                            }`}
                          >
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded border ${
                                selected
                                  ? "border-premium bg-premium text-white"
                                  : "border-border bg-input"
                              }`}
                              aria-hidden
                            >
                              {selected ? (
                                <Check size={12} weight={ICON_WEIGHT} />
                              ) : null}
                            </span>
                            <span className="min-w-0 truncate text-sm font-medium text-foreground">
                              {option.name}
                            </span>
                            <span
                              className={`inline-flex w-full justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${quoteKindBadgeClasses(option.kind)}`}
                            >
                              {QUOTE_KIND_LABEL[option.kind]}
                            </span>
                            <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                              {formatCurrency(option.price)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="relative flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background/70 px-4 py-3">
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-b from-transparent to-card transition-opacity duration-200 ${
              catalogScroll.showMoreBelow ? "opacity-100" : "opacity-0"
            }`}
          />
          <div>
            <p className="text-xs text-muted">
              {selectedKeys.length === 0
                ? "Nenhum item marcado"
                : `${selectedKeys.length} ${
                    selectedKeys.length === 1 ? "item" : "itens"
                  }`}
            </p>
            <p className="text-sm font-semibold text-foreground">
              {formatCurrency(selectedTotal)}
            </p>
            {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="success"
              loading={saving}
              disabled={selectedKeys.length === 0}
              onClick={() => void handleConfirm()}
            >
              Adicionar
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
