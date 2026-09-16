"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CalendarBlank,
  CaretDown,
  ClipboardText,
  FilePdf,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { ClientFormModal } from "@/components/clients/client-form-modal";
import { Header } from "@/components/layout/header";
import {
  SelectedCatalogItems,
  ServiceCatalogDialog,
  type ResolvedCatalogItem,
} from "@/components/quotes/service-catalog-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { syncVehicles } from "@/lib/clients/sync-vehicles";
import type { QuoteServiceRow } from "@/lib/quotes/catalog";
import { exportQuoteToPdf } from "@/lib/quotes/export-pdf";
import {
  MANUAL_QUOTE_STATUSES,
  QUOTE_STATUS_LABEL,
  quoteClientLabel,
  quoteStatusClasses,
  type Quote,
  type QuoteItem,
  type QuoteItemKind,
  type QuoteStatus,
} from "@/lib/quotes/types";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, normalizePhone } from "@/lib/utils/format";
import {
  formatMoneyInput,
  maskSignedCurrencyInput,
  parseSignedCurrencyInput,
} from "@/lib/utils/money";
import type { Client, ClientFormData } from "@/types/client";

const QUOTE_ICON_WEIGHT = "light" as const;
const QUOTE_FORM_EXIT_MS = 180;
const QUOTE_TABLE_COLUMNS =
  "minmax(0,1.3fr) minmax(0,1.5fr) 6.5rem 7.5rem 6rem 6.5rem 10.5rem";
const DEFAULT_VALIDITY_DAYS = 15;
const QUOTE_SELECT =
  "id, workshop_id, client_id, guest_name, guest_contact, status, valid_until, notes, total_amount, adjustment_amount, service_order_id, created_at, updated_at, clients(id, name, phone, email), quote_items(id, quote_id, service_id, name, kind, unit_price, quantity)";

type DraftItem = {
  key: string;
  serviceId: string;
  name: string;
  kind: QuoteItemKind;
  unitPrice: number;
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateKey(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function clientName(quote: Quote) {
  return quoteClientLabel(quote);
}

function itemsSummary(items: QuoteItem[] | undefined) {
  if (!items?.length) return "Sem itens";
  const names = items.map((item) => item.name);
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
}

function QuoteItemsCell({
  quoteId,
  items,
}: {
  quoteId: string;
  items: QuoteItem[] | undefined;
}) {
  const triggerRef = useRef<HTMLParagraphElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const list = items ?? [];
  const summary = itemsSummary(items);
  const tooltipId = `quote-items-tooltip-${quoteId}`;

  useLayoutEffect(() => {
    if (!open) return;

    function place() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      if (!trigger || !tooltip) return;

      const margin = 12;
      let left = trigger.left;
      if (left + tooltip.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltip.width - margin;
      }
      if (left < margin) left = margin;

      const below = trigger.bottom + 8;
      const above = trigger.top - tooltip.height - 8;
      const top =
        below + tooltip.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, above);

      setCoords({ top, left });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, list.length]);

  return (
    <>
      <p
        ref={triggerRef}
        className="min-w-0 truncate text-sm text-muted"
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setCoords({ top: rect.bottom + 8, left: rect.left });
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
      >
        {summary}
      </p>
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            className="pointer-events-none fixed z-[80] min-w-[14rem] max-w-xs rounded-lg border border-border bg-card px-3 py-2 shadow-card-hover"
          >
            {list.length === 0 ? (
              <p className="text-sm text-muted">Sem itens</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-4"
                  >
                    <span className="min-w-0 text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(Number(item.unit_price) || 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body
        )}
    </>
  );
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

function ModalFooterFade({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-b from-transparent to-card transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

function canConvert(status: QuoteStatus) {
  return status === "pendente" || status === "aprovado";
}

export function QuotesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<QuoteServiceRow[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formClosing, setFormClosing] = useState(false);
  const formCloseTimeoutRef = useRef<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [deleteQuote, setDeleteQuote] = useState<Quote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const ignoreOverlayCloseRef = useRef(false);
  const ignoreOverlayTimeoutRef = useRef<number | null>(null);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [closingStatusId, setClosingStatusId] = useState<string | null>(null);

  const [clientId, setClientId] = useState("");
  const [clientMode, setClientMode] = useState<"registered" | "guest">("registered");
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [adjustmentInput, setAdjustmentInput] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [exportingPdfId, setExportingPdfId] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const formScroll = useMoreContentBelow(formOpen, items.length);

  const addedServiceIds = useMemo(
    () => new Set(items.map((item) => item.serviceId)),
    [items]
  );
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice, 0);
  const adjustmentAmount = (() => {
    try {
      return parseSignedCurrencyInput(adjustmentInput);
    } catch {
      return 0;
    }
  })();
  const finalTotal = subtotal + adjustmentAmount;

  const loadClients = useCallback(async (wid: string) => {
    const { data, error: loadError } = await supabase
      .from("clients")
      .select(
        "id, workshop_id, name, phone, notes, email, document, address, created_at, updated_at, pre_cadastro, vehicles(id, client_id, brand, model, plate, year, photo_url_1, photo_url_2, pre_cadastro)"
      )
      .eq("workshop_id", wid)
      .order("name", { ascending: true });

    if (loadError) throw new Error(loadError.message);
    setClients((data as Client[]) ?? []);
  }, [supabase]);

  const loadServices = useCallback(async (wid: string) => {
    const { data, error: loadError } = await supabase
      .from("services")
      .select("id, name, price, duration_minutes, active, category")
      .eq("workshop_id", wid)
      .order("name", { ascending: true });

    if (loadError) throw new Error(loadError.message);
    setServices(((data ?? []) as QuoteServiceRow[]) ?? []);
  }, [supabase]);

  const loadQuotes = useCallback(
    async (wid: string) => {
      const { data, error: loadError } = await supabase
        .from("quotes")
        .select(QUOTE_SELECT)
        .eq("workshop_id", wid)
        .order("created_at", { ascending: false });

      if (loadError) {
        if (
          /could not find the table|guest_name does not exist|guest_contact does not exist|adjustment_amount does not exist/i.test(
            loadError.message
          )
        ) {
          throw new Error(
            "Falta aplicar as migrations 028_quotes.sql e 029_quote_guest_and_adjustment.sql no Supabase (SQL Editor)."
          );
        }
        throw new Error(loadError.message);
      }

      const rows = ((data ?? []) as unknown as Quote[]).map((quote) => ({
        ...quote,
        total_amount: Number(quote.total_amount) || 0,
        adjustment_amount: Number(quote.adjustment_amount) || 0,
        quote_items: (quote.quote_items ?? []).map((item) => ({
          ...item,
          unit_price: Number(item.unit_price) || 0,
        })),
      }));

      const expiredIds = rows
        .filter(
          (quote) =>
            quote.status === "pendente" &&
            quote.valid_until &&
            quote.valid_until < dateKey(new Date())
        )
        .map((quote) => quote.id);

      if (expiredIds.length > 0) {
        const { error: expireError } = await supabase
          .from("quotes")
          .update({
            status: "expirado",
            updated_at: new Date().toISOString(),
          })
          .in("id", expiredIds)
          .eq("workshop_id", wid);

        if (!expireError) {
          expiredIds.forEach((id) => {
            const row = rows.find((quote) => quote.id === id);
            if (row) row.status = "expirado";
          });
        }
      }

      setQuotes(rows);
    },
    [supabase]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { workshopId: wid, error: workshopError } =
        await fetchOwnWorkshop(supabase);
      if (!wid) throw new Error(workshopError?.message ?? "Oficina não encontrada.");
      setWorkshopId(wid);
      await Promise.all([loadClients(wid), loadServices(wid), loadQuotes(wid)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os orçamentos.");
    } finally {
      setLoading(false);
    }
  }, [loadClients, loadQuotes, loadServices, supabase]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function armOverlayGuard() {
    ignoreOverlayCloseRef.current = true;
    if (ignoreOverlayTimeoutRef.current) {
      window.clearTimeout(ignoreOverlayTimeoutRef.current);
    }
    ignoreOverlayTimeoutRef.current = window.setTimeout(() => {
      ignoreOverlayCloseRef.current = false;
      ignoreOverlayTimeoutRef.current = null;
    }, 400);
  }

  function resetForm() {
    setEditingId(null);
    setClientId("");
    setClientMode("registered");
    setGuestName("");
    setGuestContact("");
    setAdjustmentInput("");
    setValidUntil(dateKey(addDays(new Date(), DEFAULT_VALIDITY_DAYS)));
    setNotes("");
    setItems([]);
    setCatalogOpen(false);
    setFormError(null);
    setFormOpen(false);
    setFormClosing(false);
  }

  function closeForm() {
    if (!formOpen || formClosing || saving) return;
    setFormClosing(true);
    if (formCloseTimeoutRef.current) {
      window.clearTimeout(formCloseTimeoutRef.current);
    }
    formCloseTimeoutRef.current = window.setTimeout(() => {
      formCloseTimeoutRef.current = null;
      resetForm();
    }, QUOTE_FORM_EXIT_MS);
  }

  useEffect(() => {
    if (!formOpen) {
      setFormClosing(false);
      return;
    }
    setFormClosing(false);
  }, [formOpen]);

  function resizeNotesField(field = notesRef.current) {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }

  useLayoutEffect(() => {
    if (!formOpen) return;
    resizeNotesField();
  }, [formOpen, notes]);

  function openCreate() {
    if (formCloseTimeoutRef.current) {
      window.clearTimeout(formCloseTimeoutRef.current);
      formCloseTimeoutRef.current = null;
    }
    setFormClosing(false);
    armOverlayGuard();
    setEditingId(null);
    setClientId("");
    setClientMode("registered");
    setGuestName("");
    setGuestContact("");
    setAdjustmentInput("");
    setValidUntil(dateKey(addDays(new Date(), DEFAULT_VALIDITY_DAYS)));
    setNotes("");
    setItems([]);
    setCatalogOpen(false);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(quote: Quote) {
    if (formCloseTimeoutRef.current) {
      window.clearTimeout(formCloseTimeoutRef.current);
      formCloseTimeoutRef.current = null;
    }
    setFormClosing(false);
    armOverlayGuard();
    setEditingId(quote.id);
    if (quote.client_id) {
      setClientMode("registered");
      setClientId(quote.client_id);
      setGuestName("");
      setGuestContact("");
    } else {
      setClientMode("guest");
      setClientId("");
      setGuestName(quote.guest_name ?? "");
      setGuestContact(quote.guest_contact ?? "");
    }
    setAdjustmentInput(
      quote.adjustment_amount
        ? `${quote.adjustment_amount < 0 ? "-" : ""}${formatMoneyInput(Math.abs(quote.adjustment_amount))}`
        : ""
    );
    setValidUntil(quote.valid_until ?? dateKey(addDays(new Date(), DEFAULT_VALIDITY_DAYS)));
    setNotes(quote.notes ?? "");
    setItems(
      (quote.quote_items ?? []).map((item) => ({
        key: item.id,
        serviceId: item.service_id ?? item.id,
        name: item.name,
        kind: item.kind,
        unitPrice: Number(item.unit_price) || 0,
      }))
    );
    setCatalogOpen(false);
    setFormError(null);
    setFormOpen(true);
  }

  function openCatalog() {
    armOverlayGuard();
    setCatalogOpen(true);
  }

  function closeCatalog() {
    setCatalogOpen(false);
  }

  useEffect(() => {
    if (!formOpen || saving) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || clientModalOpen || formClosing) return;
      if (catalogOpen) return;
      closeForm();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [catalogOpen, clientModalOpen, formClosing, formOpen, saving]);

  async function handleCatalogAdded(
    resolved: ResolvedCatalogItem[],
    latestServices: QuoteServiceRow[]
  ) {
    if (!workshopId) return;
    setItems((prev) => [
      ...prev,
      ...resolved.map((item, index) => ({
        key: `${item.serviceId}-${Date.now()}-${index}`,
        serviceId: item.serviceId,
        name: item.name,
        kind: item.kind,
        unitPrice: item.price,
      })),
    ]);
    if (latestServices !== services) {
      setServices(latestServices);
      await loadServices(workshopId);
    }
  }

  async function handleSaveClient(data: ClientFormData) {
    if (!workshopId) throw new Error("Oficina não encontrada.");

    const payload = {
      name: data.name.trim(),
      phone: normalizePhone(data.phone),
      notes: data.notes.trim() || null,
      pre_cadastro: false,
    };

    const { data: newClient, error: insertError } = await supabase
      .from("clients")
      .insert({ ...payload, workshop_id: workshopId })
      .select("id")
      .single();

    if (insertError || !newClient) {
      throw new Error(insertError?.message ?? "Não foi possível criar o cliente.");
    }

    await syncVehicles(supabase, workshopId, newClient.id, data.vehicles);
    await loadClients(workshopId);
    setClientMode("registered");
    setClientId(newClient.id);
    setGuestName("");
    setGuestContact("");
    setClientModalOpen(false);
  }

  async function handleSaveQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workshopId) {
      setFormError("Oficina não encontrada.");
      return;
    }
    if (clientMode === "registered" && !clientId) {
      setFormError("Selecione um cliente.");
      return;
    }
    if (clientMode === "guest" && !guestName.trim()) {
      setFormError("Informe o nome do cliente avulso.");
      return;
    }
    if (items.length === 0) {
      setFormError("Adicione pelo menos um item.");
      return;
    }
    if (finalTotal < 0) {
      setFormError("O total final não pode ser negativo.");
      return;
    }

    setSaving(true);
    setFormError(null);

    const payload = {
      workshop_id: workshopId,
      client_id: clientMode === "registered" ? clientId : null,
      guest_name: clientMode === "guest" ? guestName.trim() : null,
      guest_contact: clientMode === "guest" ? guestContact.trim() || null : null,
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      total_amount: finalTotal,
      adjustment_amount: adjustmentAmount,
      updated_at: new Date().toISOString(),
    };

    try {
      let quoteId = editingId;

      if (editingId) {
        const { error: updateError } = await supabase
          .from("quotes")
          .update(payload)
          .eq("id", editingId)
          .eq("workshop_id", workshopId);
        if (updateError) throw updateError;

        const { error: deleteItemsError } = await supabase
          .from("quote_items")
          .delete()
          .eq("quote_id", editingId);
        if (deleteItemsError) throw deleteItemsError;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("quotes")
          .insert({ ...payload, status: "pendente" })
          .select("id")
          .single();
        if (insertError || !inserted) {
          throw new Error(insertError?.message ?? "Não foi possível criar o orçamento.");
        }
        quoteId = inserted.id;
      }

      if (!quoteId) throw new Error("Orçamento não encontrado.");

      const { error: itemsError } = await supabase.from("quote_items").insert(
        items.map((item) => ({
          quote_id: quoteId,
          service_id: item.serviceId,
          name: item.name,
          kind: item.kind,
          unit_price: item.unitPrice,
          quantity: 1,
        }))
      );
      if (itemsError) throw itemsError;

      await loadQuotes(workshopId);
      setSaving(false);
      closeForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setFormError(
        /could not find the table|guest_name|guest_contact|adjustment_amount/i.test(message)
          ? "Falta aplicar as migrations 028_quotes.sql e 029_quote_guest_and_adjustment.sql no Supabase (SQL Editor)."
          : message || "Não foi possível salvar o orçamento."
      );
      setSaving(false);
    }
  }

  function closeStatusMenu(quoteId: string) {
    setOpenStatusId(null);
    setClosingStatusId(quoteId);
    window.setTimeout(() => {
      setClosingStatusId((current) => (current === quoteId ? null : current));
    }, 160);
  }

  function toggleStatusMenu(quoteId: string) {
    if (openStatusId === quoteId) {
      closeStatusMenu(quoteId);
      return;
    }
    setClosingStatusId(null);
    setOpenStatusId(quoteId);
  }

  useEffect(() => {
    if (!openStatusId) return;
    const quoteId = openStatusId;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-quote-status-menu]")) return;
      closeStatusMenu(quoteId);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeStatusMenu(quoteId);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openStatusId]);

  async function handleChangeStatus(quote: Quote, status: QuoteStatus) {
    if (!workshopId || quote.status === "convertido") return;
    const { error: updateError } = await supabase
      .from("quotes")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", quote.id)
      .eq("workshop_id", workshopId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setQuotes((prev) =>
      prev.map((item) => (item.id === quote.id ? { ...item, status } : item))
    );
  }

  function handleConvert(quote: Quote) {
    if (!quote.client_id) return;
    const serviceIds = (quote.quote_items ?? [])
      .map((item) => item.service_id)
      .filter((id): id is string => Boolean(id));
    const params = new URLSearchParams({
      clientId: quote.client_id,
      quoteId: quote.id,
    });
    if (serviceIds.length > 0) {
      params.set("packageServices", serviceIds.join(","));
    }
    router.push(`/agenda?${params.toString()}`);
  }

  async function handleExportPdf(quote: Quote) {
    if (!workshopId) return;
    setExportingPdfId(quote.id);
    setError(null);
    try {
      await exportQuoteToPdf(supabase, workshopId, quote);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível gerar o PDF do orçamento."
      );
    } finally {
      setExportingPdfId(null);
    }
  }

  async function handleDeleteQuote() {
    if (!deleteQuote || !workshopId) return;
    setDeleting(true);
    const { error: deleteError } = await supabase
      .from("quotes")
      .delete()
      .eq("id", deleteQuote.id)
      .eq("workshop_id", workshopId);
    setDeleting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setQuotes((prev) => prev.filter((quote) => quote.id !== deleteQuote.id));
    if (editingId === deleteQuote.id) closeForm();
    setDeleteQuote(null);
  }

  return (
    <>
      <Header
        title="Orçamentos"
        description="Monte propostas com cliente e serviços, depois converta em agendamento."
        actions={
          <Button type="button" variant="success" onClick={openCreate}>
            <Plus size={16} weight={QUOTE_ICON_WEIGHT} aria-hidden />
            Novo orçamento
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="w-full">
          <div
            className="grid items-center gap-x-3 border-b border-border px-3 py-3 text-xs font-semibold text-muted"
            style={{
              gridTemplateColumns: QUOTE_TABLE_COLUMNS,
            }}
          >
            <span>Cliente</span>
            <span>Itens</span>
            <span>Total</span>
            <span>Status</span>
            <span>Criado</span>
            <span>Validade</span>
            <span className="text-right">Ações</span>
          </div>

          {loading ? (
            <p className="px-3 py-10 text-center text-sm font-semibold text-muted">
              Carregando orçamentos...
            </p>
          ) : quotes.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <ClipboardText
                size={32}
                weight={QUOTE_ICON_WEIGHT}
                className="text-muted/40"
                aria-hidden
              />
              <p className="mt-3 text-sm font-semibold text-foreground">
                Nenhum orçamento cadastrado
              </p>
              <p className="mt-1 text-sm text-muted">
                Use o botão Novo orçamento para montar a primeira proposta.
              </p>
            </div>
          ) : (
            quotes.map((quote) => (
              <article
                key={quote.id}
                className="grid items-center gap-x-3 border-b border-border/70 px-3 py-3 transition-colors hover:bg-background/70"
                style={{
                  gridTemplateColumns: QUOTE_TABLE_COLUMNS,
                }}
              >
                <p className="truncate text-sm font-semibold text-foreground">
                  {clientName(quote)}
                </p>
                <QuoteItemsCell quoteId={quote.id} items={quote.quote_items} />
                <p className="text-sm font-bold text-foreground">
                  {formatCurrency(Number(quote.total_amount) || 0)}
                </p>
                <div className="relative" data-quote-status-menu>
                  {quote.status === "convertido" ? (
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${quoteStatusClasses(quote.status)}`}
                    >
                      {QUOTE_STATUS_LABEL[quote.status]}
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleStatusMenu(quote.id)}
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-shadow hover:shadow-card sm:min-h-0 sm:py-1 sm:text-xs ${quoteStatusClasses(quote.status)}`}
                        aria-haspopup="menu"
                        aria-expanded={openStatusId === quote.id}
                        aria-label={`Status do orçamento de ${clientName(quote)}`}
                      >
                        {QUOTE_STATUS_LABEL[quote.status]}
                        <CaretDown
                          size={12}
                          weight={QUOTE_ICON_WEIGHT}
                          className={`transition-transform duration-200 ${
                            openStatusId === quote.id ? "rotate-180" : ""
                          }`}
                          aria-hidden
                        />
                      </button>
                      {(openStatusId === quote.id ||
                        closingStatusId === quote.id) && (
                        <div
                          role="menu"
                          className={`absolute left-0 top-full z-30 mt-2 w-40 rounded-lg border border-border bg-card p-2 shadow-card-hover ${
                            closingStatusId === quote.id
                              ? "dropdown-menu-exit"
                              : "dropdown-menu-enter"
                          }`}
                        >
                          {MANUAL_QUOTE_STATUSES.map((status) => (
                            <button
                              key={status}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                void handleChangeStatus(quote, status);
                                closeStatusMenu(quote.id);
                              }}
                              className={`mb-1 flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors last:mb-0 hover:opacity-90 sm:min-h-0 sm:text-xs ${quoteStatusClasses(status)}`}
                            >
                              {QUOTE_STATUS_LABEL[status]}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <p className="text-sm text-muted">
                  {formatDateKey(quote.created_at)}
                </p>
                <p className="text-sm text-muted">
                  {formatDateKey(quote.valid_until)}
                </p>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => void handleExportPdf(quote)}
                    disabled={exportingPdfId === quote.id}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                    title="Baixar orçamento em PDF"
                    aria-label={`Baixar PDF do orçamento de ${clientName(quote)}`}
                  >
                    <FilePdf size={16} weight={QUOTE_ICON_WEIGHT} />
                  </button>
                  {canConvert(quote.status) && quote.client_id && (
                    <button
                      type="button"
                      onClick={() => handleConvert(quote)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
                      title="Ir para agendamento"
                      aria-label={`Converter orçamento de ${clientName(quote)}`}
                    >
                      <CalendarBlank size={16} weight={QUOTE_ICON_WEIGHT} />
                    </button>
                  )}
                  {quote.status !== "convertido" && (
                    <button
                      type="button"
                      onClick={() => openEdit(quote)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
                      title="Editar"
                      aria-label={`Editar orçamento de ${clientName(quote)}`}
                    >
                      <PencilSimple size={16} weight={QUOTE_ICON_WEIGHT} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteQuote(quote)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                    title="Excluir"
                    aria-label={`Excluir orçamento de ${clientName(quote)}`}
                  >
                    <Trash size={16} weight={QUOTE_ICON_WEIGHT} />
                  </button>
                </div>
              </article>
            ))
          )}
      </div>

      {formOpen &&
        mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[110] flex items-center justify-center bg-foreground/25 px-4 py-6 backdrop-blur-sm ${
              formClosing ? "quote-form-overlay-exit" : "quote-form-overlay-enter"
            }`}
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (
                ignoreOverlayCloseRef.current ||
                saving ||
                clientModalOpen ||
                catalogOpen ||
                formClosing
              ) {
                return;
              }
              closeForm();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="quote-form-title"
              onSubmit={(event) => void handleSaveQuote(event)}
              onClick={(event) => event.stopPropagation()}
              className={`flex min-h-[min(34rem,92vh)] max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card-hover ${
                formClosing ? "quote-form-card-exit" : "quote-form-card-enter"
              }`}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-1 sm:px-6">
                <div className="min-w-0">
                  <h2
                    id="quote-form-title"
                    className="text-base font-semibold text-foreground"
                  >
                    {editingId ? "Editar orçamento" : "Novo orçamento"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">
                    Cliente, itens e validade. O total final soma os valores editados e o ajuste.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!saving) closeForm();
                  }}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                  aria-label="Fechar"
                >
                  <X size={18} weight={QUOTE_ICON_WEIGHT} aria-hidden />
                </button>
              </div>

              <div
                ref={formScroll.ref}
                className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6"
              >
                {formError && (
                  <div className="mb-3 rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <p className="label-caps mb-1.5">Cliente</p>
                    <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setClientMode("registered");
                          setGuestName("");
                          setGuestContact("");
                        }}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                          clientMode === "registered"
                            ? "bg-primary text-white"
                            : "text-muted hover:text-foreground"
                        }`}
                      >
                        Cliente cadastrado
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setClientMode("guest");
                          setClientId("");
                        }}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                          clientMode === "guest"
                            ? "bg-primary text-white"
                            : "text-muted hover:text-foreground"
                        }`}
                      >
                        Cliente avulso
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted">
                      {clientMode === "guest"
                        ? "Nome e contato só neste orçamento — não cria cadastro no sistema."
                        : "Use um cliente já cadastrado ou crie um cadastro completo."}
                    </p>
                  </div>
                  {clientMode === "registered" ? (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label htmlFor="cliente" className="label-caps">
                          Cliente cadastrado
                        </label>
                        <button
                          type="button"
                          onClick={() => setClientModalOpen(true)}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-white"
                        >
                          <Plus size={12} weight={QUOTE_ICON_WEIGHT} aria-hidden />
                          Novo cliente
                        </button>
                      </div>
                      <Dropdown
                        id="cliente"
                        value={clientId}
                        options={clients.map((client) => ({
                          value: client.id,
                          label: client.name,
                        }))}
                        onChange={setClientId}
                        searchable
                        searchPlaceholder="Buscar cliente..."
                        placeholder="Selecione um cliente"
                        actionLabel="Novo cliente"
                        onAction={() => setClientModalOpen(true)}
                      />
                    </div>
                  ) : (
                    <>
                      <Input
                        label="Nome"
                        value={guestName}
                        onChange={(event) => setGuestName(event.target.value)}
                        placeholder="Nome do cliente"
                        autoComplete="name"
                      />
                      <Input
                        label="Contato"
                        value={guestContact}
                        onChange={(event) => setGuestContact(event.target.value)}
                        placeholder="Telefone ou e-mail"
                        autoComplete="off"
                      />
                    </>
                  )}
                  <Input
                    label="Validade"
                    type="date"
                    value={validUntil}
                    onChange={(event) => setValidUntil(event.target.value)}
                  />
                  <div className="sm:col-span-2">
                    <label className="label-caps mb-1.5 block">
                      Observações (opcional)
                    </label>
                    <textarea
                      ref={notesRef}
                      value={notes}
                      rows={2}
                      onChange={(event) => {
                        setNotes(event.target.value);
                        resizeNotesField(event.target);
                      }}
                      placeholder="Condições, prazo de execução, observações para o cliente..."
                      className="block w-full resize-none overflow-hidden rounded-md border border-border bg-input px-3 py-2 text-sm leading-5 text-foreground placeholder:text-muted/60 transition-colors duration-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <SelectedCatalogItems
                      items={items.map((item) => ({
                        serviceId: item.serviceId,
                        name: item.name,
                        kind: item.kind,
                        price: item.unitPrice,
                      }))}
                      onSelect={openCatalog}
                      onRemove={(serviceId) =>
                        setItems((prev) =>
                          prev.filter((row) => row.serviceId !== serviceId)
                        )
                      }
                      onChangePrice={(serviceId, price) =>
                        setItems((prev) =>
                          prev.map((row) =>
                            row.serviceId === serviceId
                              ? { ...row, unitPrice: price }
                              : row
                          )
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label="Ajuste final (opcional)"
                      value={adjustmentInput}
                      onChange={(event) =>
                        setAdjustmentInput(maskSignedCurrencyInput(event.target.value))
                      }
                      placeholder="0,00"
                      inputMode="decimal"
                      prefix="R$"
                    />
                    <p className="mt-1 text-[11px] text-muted">
                      Valor em reais. Use negativo para desconto (ex.: -150,00) ou positivo para acréscimo.
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative shrink-0 bg-card">
                <ModalFooterFade visible={formScroll.showMoreBelow} />
                <div className="space-y-1 px-5 py-3 sm:px-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="label-caps text-muted">Subtotal</p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(subtotal)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="label-caps text-muted">Ajuste</p>
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        adjustmentAmount < 0
                          ? "text-danger"
                          : adjustmentAmount > 0
                            ? "text-primary"
                            : "text-muted"
                      }`}
                    >
                      {adjustmentAmount > 0 ? "+" : ""}
                      {formatCurrency(adjustmentAmount)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
                    <p className="label-caps text-muted">Total final</p>
                    <p
                      className={`text-lg font-semibold tracking-tight tabular-nums sm:text-xl ${
                        finalTotal < 0 ? "text-danger" : "text-foreground"
                      }`}
                    >
                      {formatCurrency(finalTotal)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col-reverse gap-2 px-5 pb-4 sm:flex-row sm:justify-end sm:px-6">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeForm}
                    disabled={saving || formClosing}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" variant="success" loading={saving}>
                    {editingId ? "Atualizar orçamento" : "Salvar orçamento"}
                  </Button>
                </div>
              </div>
            </form>
          </div>,
          document.body
        )}

      {workshopId ? (
        <ServiceCatalogDialog
          open={catalogOpen}
          onClose={closeCatalog}
          services={services}
          excludedServiceIds={addedServiceIds}
          supabase={supabase}
          workshopId={workshopId}
          description="Marque quantos quiser e confirme para adicionar ao orçamento."
          onAdded={handleCatalogAdded}
        />
      ) : null}

      <ClientFormModal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        onSave={handleSaveClient}
      />

      <ConfirmDialog
        open={Boolean(deleteQuote)}
        title="Excluir orçamento"
        description={
          deleteQuote
            ? `Deseja excluir o orçamento de ${clientName(deleteQuote)}?`
            : ""
        }
        confirmLabel="Excluir orçamento"
        loading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteQuote(null);
        }}
        onConfirm={() => {
          void handleDeleteQuote();
        }}
      />
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .quote-form-overlay-enter {
            animation: quote-form-fade-in 220ms ease-out both;
          }
          .quote-form-overlay-exit {
            animation: quote-form-fade-out ${QUOTE_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }
          .quote-form-card-enter {
            animation: quote-form-card-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .quote-form-card-exit {
            animation: quote-form-card-exit ${QUOTE_FORM_EXIT_MS}ms ease-in both;
            pointer-events: none;
          }
        }
        @keyframes quote-form-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes quote-form-fade-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes quote-form-card-enter {
          from {
            opacity: 0;
            transform: translateY(14px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes quote-form-card-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
        }
      `}</style>
    </>
  );
}
