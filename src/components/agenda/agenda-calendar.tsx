"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarBlank,
  CalendarX,
  Car,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Note,
  PencilSimple,
  Plus,
  Trash,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { ClientFormModal } from "@/components/clients/client-form-modal";
import { createClient } from "@/lib/supabase/client";
import { assertMutationRows } from "@/lib/supabase/mutations";
import { formatCurrency } from "@/lib/utils/format";
import {
  DEFAULT_TIME_ZONE,
  resolveTimeZone,
  wallClockInTimeZone,
} from "@/lib/timezone";
import {
  ensurePackageServicesInCatalog,
  isPackageCatalogServiceName,
} from "@/lib/services/packages";
import { type Client, type ClientFormData } from "@/types/client";
import {
  fetchWorkshopProfile,
  fetchWorkshopCapacity,
  fetchClients,
  fetchServices,
  fetchAppointments,
  fetchAppointmentsLegacy,
} from "@/lib/agenda/queries";
import {
  updateAppointmentOrder,
  insertAppointmentOrder,
  saveAppointmentItems,
  deleteAppointmentItems,
  deleteAppointment,
  deleteAppointmentsForDay,
  updateAppointmentStatus,
  updateAppointmentStatusBulk,
  updateAppointmentNotes as updateAppointmentNotesDb,
  updateWorkshopCapacity,
  syncFinanceRevenue,
  deleteFinanceRevenue,
  applyStockDiscount,
  importLocalAppointments,
  createClientWithVehicles,
  createPreCadastroClient,
} from "@/lib/agenda/mutations";
import type {
  Appointment,
  AppointmentForm,
  AgendaService,
  AppointmentStatus,
  ServiceOrderStatus,
  AppointmentOrderRow,
  AppointmentOrderItem,
  AppointmentOrderService,
  SelectOption,
  AppointmentOccurrence,
  AgendaSelectId,
  AgendaPageTab,
  AgendaDeleteConfirm,
} from "@/lib/agenda/types";
import {
  timeToMinutes,
  isTimeBetween,
  isTimeInRange,
  rangesOverlap,
  startOfMonth,
  addMonths,
  dateKey,
  parseLocalDate,
  addDays,
  getDateRangeKeys,
  getAppointmentEndDate,
  getAppointmentDurationDays,
  getDailyTimeWindow,
  appointmentOccursOnDate,
  formatShortDate,
  formatAppointmentDuration,
  isAppointmentPast,
  formatLongDate,
  formatMonthTitle,
  getShortClientName,
  getServicePrice,
  parseAppointmentAmount,
  calculateServicesTotal,
  isCustomAppointmentTotal,
  buildServiceOrderItems,
  firstRelation,
  normalizeDbTime,
  getAppointmentStatus,
  getServiceOrderStatus,
  isMissingAgendaMigrationError,
  isMissingAgendaCapacityError,
  normalizeAgendaCapacity,
  getLocalAgendaCapacityKey,
  readLocalAgendaCapacityForImport,
  clearLocalAgendaCapacity,
  mapOrderToAppointment,
  formatServiceDuration,
  buildCalendarDays,
  formatAppointmentCount,
} from "@/lib/agenda/utils";
import {
  BUSINESS_START_TIME,
  BUSINESS_END_TIME,
  DEFAULT_AGENDA_CAPACITY,
  AGENDA_ICON_WEIGHT,
  agendaPageTabs,
  appointmentStatuses,
  statusStyles,
  weekdays,
  timeSlots,
} from "@/lib/agenda/constants";

function getStatusStyle(status: AppointmentStatus) {
  return statusStyles[status];
}

function AppointmentStatusLabel({
  status,
  iconSize = 14,
}: {
  status: AppointmentStatus;
  iconSize?: number;
}) {
  if (status !== "Concluído") {
    return status;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <CheckCircle
        size={iconSize}
        weight={AGENDA_ICON_WEIGHT}
        className="shrink-0"
        aria-hidden
      />
      {status}
    </span>
  );
}

function AppointmentNotesRow({
  appointmentId,
  notes,
  onUpdateNotes,
}: {
  appointmentId: string;
  notes: string;
  onUpdateNotes: (
    appointmentId: string,
    notes: string | null
  ) => Promise<void>;
}) {
  const trimmedNotes = notes.trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmedNotes);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(trimmedNotes);
    setConfirmRemove(false);
    setError(null);
  }, [editing, trimmedNotes]);

  if (!trimmedNotes && !editing) return null;

  async function handleSave() {
    const nextNotes = draft.trim();
    if (!nextNotes) {
      setError("Informe uma observação ou use Excluir.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onUpdateNotes(appointmentId, nextNotes);
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao salvar observação."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError(null);
    try {
      await onUpdateNotes(appointmentId, null);
      setEditing(false);
      setConfirmRemove(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao remover observação."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1.5 border-t border-border/60 pt-1.5">
      {editing ? (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
            placeholder="Escreva uma observação..."
            className="w-full resize-none border-0 border-b border-border bg-transparent px-0 py-1 text-xs text-foreground outline-none placeholder:text-muted/60 focus:border-primary/40 disabled:opacity-60"
          />
          {error && (
            <p className="text-xs font-medium text-danger">{error}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(trimmedNotes);
                setEditing(false);
                setError(null);
              }}
              className="text-[11px] font-semibold text-muted transition-colors hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="text-[11px] font-semibold text-success transition-colors hover:text-success/80 disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-foreground">Obs:</span>{" "}
            <span className="whitespace-pre-wrap break-words">{trimmedNotes}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {confirmRemove ? (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmRemove(false)}
                  className="text-[11px] font-semibold text-muted transition-colors hover:text-foreground disabled:opacity-60"
                >
                  Não
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleRemove()}
                  className="text-[11px] font-semibold text-danger transition-colors hover:text-danger/80 disabled:opacity-60"
                >
                  {saving ? "..." : "Confirmar"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-[11px] font-semibold text-foreground transition-colors hover:text-success"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="text-[11px] font-semibold text-danger transition-colors hover:text-danger/80"
                >
                  Excluir
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceListNotesIcon({
  appointmentId,
  notes,
  onUpdateNotes,
}: {
  appointmentId: string;
  notes: string;
  onUpdateNotes: (id: string, notes: string | null) => Promise<void>;
}) {
  const trimmedNotes = notes.trim();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmedNotes);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
        setDraft(trimmedNotes);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, trimmedNotes]);

  if (!trimmedNotes) return <span className="text-xs text-muted/40">—</span>;

  async function handleSave() {
    const next = draft.trim();
    if (!next) return;
    setSaving(true);
    try {
      await onUpdateNotes(appointmentId, next);
      setEditing(false);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      await onUpdateNotes(appointmentId, null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={ref}
      className="relative z-20 flex items-center justify-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
          setEditing(false);
          setDraft(trimmedNotes);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
        aria-label="Ver observação"
      >
        <Note size={20} weight="light" aria-hidden />
      </button>

      {open && (
        <div
          className="absolute left-1/2 top-full z-40 mt-2 w-72 -translate-x-1/2 rounded-md border border-border bg-card p-3 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
            Observação
          </p>

          {editing ? (
            <div className="space-y-2">
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                className="w-full resize-none border-0 border-b border-border bg-transparent px-0 py-1 text-xs text-foreground outline-none placeholder:text-muted/60 focus:border-primary/40 disabled:opacity-60"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setDraft(trimmedNotes);
                  }}
                  className="text-[11px] font-semibold text-muted hover:text-foreground disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="text-[11px] font-semibold text-success hover:text-success/80 disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                {trimmedNotes}
              </p>
              <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    setDraft(trimmedNotes);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground transition-colors hover:text-success"
                >
                  <PencilSimple size={12} weight="light" aria-hidden />
                  Editar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleRemove()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger transition-colors hover:text-danger/80 disabled:opacity-60"
                >
                  <Trash size={12} weight="light" aria-hidden />
                  {saving ? "..." : "Excluir"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ServiceListActions({
  appointment,
  onEdit,
  onDelete,
  onContact,
}: {
  appointment: Appointment;
  onEdit: (appointment: Appointment) => void;
  onDelete: (appointment: Appointment) => void;
  onContact: (appointment: Appointment) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onContact(appointment); }}
        title="Contato via WhatsApp"
        aria-label="Contato via WhatsApp"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-emerald-50 hover:text-emerald-600"
      >
        <WhatsappLogo size={14} weight="light" aria-hidden />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(appointment); }}
        title="Opções"
        aria-label="Opções do agendamento"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-success/10 hover:text-success"
      >
        <PencilSimple size={14} weight="light" aria-hidden />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(appointment); }}
        title="Excluir"
        aria-label="Excluir agendamento"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash size={14} weight="light" aria-hidden />
      </button>
    </div>
  );
}


function AgendaDropdown({
  id,
  value,
  placeholder,
  emptyMessage,
  options,
  disabled = false,
  open,
  searchable = false,
  searchPlaceholder = "Digite para pesquisar",
  noResultsMessage = "Nenhum resultado encontrado.",
  onToggle,
  onSelect,
  onClear,
  clearLabel = "Limpar seleção",
}: {
  id: string;
  value: string;
  placeholder: string;
  emptyMessage: string;
  options: SelectOption[];
  disabled?: boolean;
  open: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  noResultsMessage?: string;
  onToggle: () => void;
  onSelect: (value: string) => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOptions =
    searchable && normalizedSearchQuery
      ? options.filter((option) =>
          [option.label, option.description]
            .filter(Boolean)
            .some((field) =>
              field?.toLowerCase().includes(normalizedSearchQuery)
            )
        )
      : options;

  useEffect(() => {
    if (searchable) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  return (
    <div className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) setSearchQuery("");
          onToggle();
        }}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3 text-left text-base text-foreground shadow-card transition-all duration-200 hover:border-success/40 hover:bg-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-2.5 sm:text-sm"
      >
        <span className={selectedOption ? "font-medium" : "text-muted"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <CaretDown
          size={16}
          weight={AGENDA_ICON_WEIGHT}
          className="shrink-0 text-muted transition-transform duration-200"
        />
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-white p-2 shadow-xl ring-1 ring-slate-900/5">
          {searchable && (
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSearchQuery("");
                  onToggle();
                }
              }}
              placeholder={searchPlaceholder}
              className="mb-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-3 text-base font-medium text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:min-h-0 sm:py-2.5 sm:text-sm"
            />
          )}
          {selectedOption && onClear && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                onClear();
              }}
              className="mb-2 flex min-h-11 w-full items-center justify-between rounded-lg border border-danger/10 bg-danger/5 px-3 py-3 text-left text-base font-semibold text-danger transition-colors hover:bg-danger hover:text-white sm:min-h-0 sm:py-2.5 sm:text-sm"
            >
              {clearLabel}
              <X size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
            </button>
          )}
          {filteredOptions.length > 0 ? (
            <div role="listbox" aria-labelledby={id} className="space-y-1">
              {filteredOptions.map((option) => {
                const selected = option.value === value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setSearchQuery("");
                      onSelect(option.value);
                    }}
                    className={`min-h-11 w-full rounded-lg px-3 py-3 text-left text-base transition-colors sm:min-h-0 sm:py-2.5 sm:text-sm ${
                      selected
                        ? "bg-success/10 text-success"
                        : "text-foreground hover:bg-background"
                    }`}
                  >
                    <span className="block text-sm font-semibold">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block text-xs text-muted">
                        {option.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg bg-background px-3 py-2.5 text-sm text-muted">
              {options.length > 0 ? noResultsMessage : emptyMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AgendaCalendar() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const linkedClientId = searchParams.get("clientId");
  const linkedClientHandledRef = useRef<string | null>(null);
  const linkedServiceIds = searchParams.get("packageServices");
  const linkedServicesHandledRef = useRef<string | null>(null);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [now, setNow] = useState(() =>
    wallClockInTimeZone(new Date(), DEFAULT_TIME_ZONE)
  );
  const [currentMonth, setCurrentMonth] = useState(() =>
    startOfMonth(wallClockInTimeZone(new Date(), DEFAULT_TIME_ZONE))
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    wallClockInTimeZone(new Date(), DEFAULT_TIME_ZONE)
  );
  const [dayDrawerOpen, setDayDrawerOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<AgendaService[]>([]);
  const [workshopId, setWorkshopId] = useState<string | null>(null);
  const [agendaCapacity, setAgendaCapacity] = useState(DEFAULT_AGENDA_CAPACITY);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formClosing, setFormClosing] = useState(false);
  const [addingService, setAddingService] = useState(false);
  const [editingTotalAmount, setEditingTotalAmount] = useState(false);
  const [openSelectId, setOpenSelectId] = useState<AgendaSelectId | null>(null);
  const [openStatusMenuId, setOpenStatusMenuId] = useState<string | null>(null);
  const [closingStatusMenuId, setClosingStatusMenuId] = useState<string | null>(
    null
  );
  const [focusedAppointmentId, setFocusedAppointmentId] = useState<string | null>(
    null
  );
  const [editingAppointmentId, setEditingAppointmentId] = useState<
    string | null
  >(null);
  const [form, setForm] = useState<AppointmentForm>({
    date: dateKey(now),
    endDate: dateKey(now),
    isMultiDay: false,
    startTime: "",
    endTime: "",
    clientId: "",
    vehicleId: "",
    serviceIds: [],
    totalAmount: "",
    notes: "",
    preCadastro: false,
    preCadastroLabel: "",
  });
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeAgendaTab, setActiveAgendaTab] = useState<AgendaPageTab>("calendar");
  const [deleteConfirm, setDeleteConfirm] = useState<AgendaDeleteConfirm>(null);
  const [deletingAppointments, setDeletingAppointments] = useState(false);
  const [contactAppointment, setContactAppointment] = useState<Appointment | null>(
    null
  );
  const [serviceListActionsAppointment, setServiceListActionsAppointment] =
    useState<Appointment | null>(null);
  const [formFromServiceList, setFormFromServiceList] = useState(false);
  const [creatingServiceInline, setCreatingServiceInline] = useState(false);
  const [inlineServiceForm, setInlineServiceForm] = useState({
    name: "",
    price: "",
    durationMinutes: "60",
  });
  const [savingInlineService, setSavingInlineService] = useState(false);
  const [inlineServiceError, setInlineServiceError] = useState<string | null>(null);

  const syncFinanceRevenueForAppointment = useCallback(
    (appointment: Appointment) => syncFinanceRevenue(supabase, workshopId ?? "", appointment),
    [supabase, workshopId]
  );

  const deleteFinanceRevenueForAppointment = useCallback(
    (appointmentId: string) => deleteFinanceRevenue(supabase, appointmentId),
    [supabase]
  );

  const applySupabaseStockDiscountForAppointment = useCallback(
    (appointment: Appointment) => applyStockDiscount(supabase, workshopId ?? "", appointment),
    [supabase, workshopId]
  );

  function importLocalAppointmentsToSupabase(
    resolvedWorkshopId: string,
    remoteAppointments: Appointment[]
  ) {
    return importLocalAppointments(supabase, resolvedWorkshopId, remoteAppointments);
  }

  async function loadAgendaData() {
    setLoadingClients(true);
    setLoadingServices(true);
    setLoadingAppointments(true);

    const { data: profile } = await fetchWorkshopProfile(supabase);

    if (!profile?.workshop_id) {
      setLoadingClients(false);
      setLoadingServices(false);
      setLoadingAppointments(false);
      return;
    }

    setWorkshopId(profile.workshop_id);

    const { data: workshopData, error: workshopError } = await fetchWorkshopCapacity(
      supabase,
      profile.workshop_id
    );

    if (workshopError) {
      if (isMissingAgendaCapacityError(workshopError)) {
        setAgendaCapacity(DEFAULT_AGENDA_CAPACITY);
        setError(
          "A coluna agenda_capacity ainda não existe no Supabase. Aplique a migration 009."
        );
      } else {
        setError(workshopError.message);
      }
    } else {
      const localCapacity = readLocalAgendaCapacityForImport(profile.workshop_id);
      if (localCapacity !== null && localCapacity !== normalizeAgendaCapacity(workshopData?.agenda_capacity)) {
        const { error: capacityImportError } = await updateWorkshopCapacity(
          supabase,
          profile.workshop_id,
          localCapacity
        );

        if (!capacityImportError) {
          clearLocalAgendaCapacity(profile.workshop_id);
          setAgendaCapacity(localCapacity);
        } else {
          setAgendaCapacity(normalizeAgendaCapacity(workshopData?.agenda_capacity));
        }
      } else {
        if (localCapacity !== null) {
          clearLocalAgendaCapacity(profile.workshop_id);
        }
        setAgendaCapacity(normalizeAgendaCapacity(workshopData?.agenda_capacity));
      }

      const nextTimeZone = resolveTimeZone(
        workshopData && "timezone" in workshopData
          ? (workshopData.timezone as string | null)
          : null
      );
      setTimeZone(nextTimeZone);
      setNow(wallClockInTimeZone(new Date(), nextTimeZone));
    }

    const { data: clientsData, error: clientsError } = await fetchClients(
      supabase,
      profile.workshop_id
    );

    if (!clientsError) {
      setClients((clientsData as Client[]) ?? []);
    }

    const { data: servicesData, error: servicesError } = await fetchServices(
      supabase,
      profile.workshop_id
    );

    if (!servicesError) {
      const loadedServices = (servicesData as AgendaService[]) ?? [];
      try {
        const withPackages = await ensurePackageServicesInCatalog(
          supabase,
          profile.workshop_id,
          loadedServices
        );
        setServices(withPackages as AgendaService[]);
      } catch {
        setServices(loadedServices);
      }
    }

    const { data: appointmentsData, error: appointmentsError } = await fetchAppointments(
      supabase,
      profile.workshop_id
    );

    if (appointmentsError) {
      const { data: legacyAppointmentsData, error: legacyAppointmentsError } =
        await fetchAppointmentsLegacy(supabase, profile.workshop_id);

      if (!legacyAppointmentsError) {
        const remoteAppointments =
          ((legacyAppointmentsData as (Omit<
            AppointmentOrderRow,
            "scheduled_end_date"
          > & { scheduled_end_date?: string | null })[] | null) ?? []).map(
            (appointment) =>
              mapOrderToAppointment({
                ...appointment,
                scheduled_end_date: appointment.scheduled_end_date ?? null,
              })
          );
        try {
          setAppointments(
            await importLocalAppointmentsToSupabase(
              profile.workshop_id,
              remoteAppointments
            )
          );
        } catch (err) {
          setAppointments(remoteAppointments);
          setError(
            err instanceof Error
              ? `Não foi possível importar agendamentos locais para o Supabase: ${err.message}`
              : "Não foi possível importar agendamentos locais para o Supabase."
          );
        }
        setError((current) =>
          current ??
            "A coluna scheduled_end_date ainda não existe no Supabase. Aplique a migration 010 para serviços de múltiplos dias."
        );
      } else if (isMissingAgendaMigrationError(legacyAppointmentsError)) {
        setAppointments([]);
        setError(
          "As colunas da Agenda ainda não existem no Supabase. Aplique as migrations da Agenda."
        );
      } else {
        setError(legacyAppointmentsError.message);
      }
    } else {
      const remoteAppointments =
        ((appointmentsData as AppointmentOrderRow[] | null) ?? []).map(
          mapOrderToAppointment
        );

      try {
        setAppointments(
          await importLocalAppointmentsToSupabase(profile.workshop_id, remoteAppointments)
        );
      } catch (err) {
        setAppointments(remoteAppointments);
        setError(
          err instanceof Error
            ? `Não foi possível importar agendamentos locais para o Supabase: ${err.message}`
            : "Não foi possível importar agendamentos locais para o Supabase."
        );
      }
    }

    setLoadingClients(false);
    setLoadingServices(false);
    setLoadingAppointments(false);
  }

  useEffect(() => {
    void Promise.resolve().then(loadAgendaData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const realNow = new Date();
      const nextNow = wallClockInTimeZone(realNow, timeZone);
      setNow(nextNow);
      setAppointments((prev) => {
        const completedAppointmentIds: string[] = [];
        const completedAppointments: Appointment[] = [];
        const next = prev.map((appointment) => {
          if (
            appointment.status === "Confirmado" &&
            isAppointmentPast(appointment, nextNow)
          ) {
            completedAppointmentIds.push(appointment.id);
            completedAppointments.push(appointment);
            void applySupabaseStockDiscountForAppointment(appointment).catch((err) => {
              setError(
                err instanceof Error
                  ? `Estoque não sincronizou no Supabase: ${err.message}`
                  : "Estoque não sincronizou no Supabase."
              );
            });
            return { ...appointment, status: "Concluído" as const };
          }

          return appointment;
        });

        if (completedAppointmentIds.length > 0) {
          void updateAppointmentStatusBulk(supabase, completedAppointmentIds, realNow.toISOString())
            .then(async ({ error: updateError }) => {
              if (updateError) {
                setError(updateError.message);
                return;
              }

              const financeErrors = await Promise.all(
                completedAppointments.map((appointment) =>
                  syncFinanceRevenueForAppointment(appointment)
                )
              );
              const financeError = financeErrors.find(Boolean);
              if (financeError) setError(financeError);
            });
        }

        return completedAppointmentIds.length > 0 ? next : prev;
      });
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [
    applySupabaseStockDiscountForAppointment,
    supabase,
    syncFinanceRevenueForAppointment,
    timeZone,
  ]);

  const selectedKey = dateKey(selectedDate);
  const calendarDays = useMemo(
    () => buildCalendarDays(currentMonth),
    [currentMonth]
  );
  const normalizedAppointments = useMemo(() => {
    return appointments.map((appointment) =>
      appointment.status === "Confirmado" && isAppointmentPast(appointment, now)
        ? { ...appointment, status: "Concluído" as const }
        : appointment
    );
  }, [appointments, now]);
  const serviceListAppointments = useMemo(() => {
    return [...normalizedAppointments].sort((a, b) => {
      const endDateA = getAppointmentEndDate(a);
      const endDateB = getAppointmentEndDate(b);
      const dateCompare = endDateB.localeCompare(endDateA);
      if (dateCompare !== 0) return dateCompare;
      return b.startTime.localeCompare(a.startTime);
    });
  }, [normalizedAppointments]);
  const appointmentsByDate = useMemo(() => {
    return normalizedAppointments.reduce<Record<string, AppointmentOccurrence[]>>(
      (acc, appointment) => {
        const endDate = getAppointmentEndDate(appointment);
        const dateRange = getDateRangeKeys(appointment.date, endDate);
        const durationDays = dateRange.length;

        dateRange.forEach((occurrenceDate, index) => {
          const occurrence: AppointmentOccurrence = {
            ...appointment,
            occurrenceDate,
            isMultiDay: durationDays > 1,
            isContinuation: index > 0,
            isFirstDay: index === 0,
            isLastDay: index === dateRange.length - 1,
            durationDays,
          };

          acc[occurrenceDate] = [...(acc[occurrenceDate] ?? []), occurrence];
        });

        return acc;
      },
      {}
    );
  }, [normalizedAppointments]);
  const selectedAppointments = (appointmentsByDate[selectedKey] ?? []).sort(
    (a, b) => a.startTime.localeCompare(b.startTime)
  );
  const selectedAppointmentGroups = selectedAppointments.reduce<
    { time: string; appointments: AppointmentOccurrence[] }[]
  >((groups, appointment) => {
    const currentGroup = groups.find((group) => group.time === appointment.startTime);

    if (currentGroup) {
      currentGroup.appointments.push(appointment);
      return groups;
    }

    return [...groups, { time: appointment.startTime, appointments: [appointment] }];
  }, []);
  const selectedTimelineLaneCount = Math.max(
    1,
    Math.max(
      ...timeSlots.map(
        (time) =>
          selectedAppointments.filter((appointment) =>
            isTimeInRange(time, appointment.startTime, appointment.endTime)
          ).length
      )
    )
  );
  const currentDateKey = dateKey(now);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
  const selectedDateIsToday = selectedKey === currentDateKey;
  const occupancyTitle = selectedDateIsToday ? "Ocupação hoje" : "Ocupação do dia";
  const timelineBlocks = (() => {
    const laneEnds: string[] = [];

    return [...selectedAppointments]
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((appointment, index, dayAppointments) => {
        const availableLaneIndex = laneEnds.findIndex(
          (endTime) => timeToMinutes(endTime) <= timeToMinutes(appointment.startTime)
        );
        const laneIndex =
          availableLaneIndex >= 0 ? availableLaneIndex : laneEnds.length;
        laneEnds[laneIndex] = appointment.endTime;
      const start =
        ((timeToMinutes(appointment.startTime) -
          timeToMinutes(BUSINESS_START_TIME)) /
          (timeToMinutes(BUSINESS_END_TIME) -
            timeToMinutes(BUSINESS_START_TIME))) *
        100;
      const width =
        ((timeToMinutes(appointment.endTime) -
          timeToMinutes(appointment.startTime)) /
          (timeToMinutes(BUSINESS_END_TIME) -
            timeToMinutes(BUSINESS_START_TIME))) *
        100;
      const connectsStart =
        index > 0 && dayAppointments[index - 1].endTime === appointment.startTime;
      const connectsEnd =
        index < dayAppointments.length - 1 &&
        appointment.endTime === dayAppointments[index + 1].startTime;
      const roundedClass =
        connectsStart && connectsEnd
          ? "rounded-none"
          : connectsStart
            ? "rounded-l-none rounded-r-full"
            : connectsEnd
              ? "rounded-l-full rounded-r-none"
              : "rounded-full";

      return {
        appointment,
        laneIndex,
        roundedClass,
        start: Math.max(0, Math.min(start, 100)),
        width: Math.max(0, Math.min(width, 100 - start)),
      };
      });
  })();
  const timelineMarkers = ["07h", "09h", "11h", "13h", "15h", "17h", "19h"];
  const selectedStatusCounts = appointmentStatuses.map((status) => ({
    status,
    count: selectedAppointments.filter((appointment) => appointment.status === status)
      .length,
  }));
  const focusedAppointment =
    selectedAppointments.find((appointment) => appointment.id === focusedAppointmentId) ??
    null;
  const automaticNextAppointment =
    selectedAppointments
      .filter(
        (appointment) =>
          (appointment.status === "Pendente" ||
            appointment.status === "Confirmado") &&
          (selectedKey !== currentDateKey ||
            timeToMinutes(appointment.endTime) > timeToMinutes(currentTime))
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ?? null;
  const nextAppointment = focusedAppointment ?? automaticNextAppointment;
  const nextAppointmentStyle = nextAppointment
    ? getStatusStyle(nextAppointment.status)
    : null;
  const nextAppointmentServices = nextAppointment?.service
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean) ?? [];
  const selectedClient = clients.find((client) => client.id === form.clientId);
  const selectedClientVehicles = selectedClient?.vehicles ?? [];
  const clientOptions = clients.map((client) => ({
    value: client.id,
    label: client.name,
    description: client.phone || "Cliente cadastrado",
  }));
  const vehicleOptions = selectedClientVehicles.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.brand} ${vehicle.model}`,
    description: `${vehicle.plate}${vehicle.year ? ` • ${vehicle.year}` : ""}`,
  }));
  const selectedServices = services.filter((service) =>
    form.serviceIds.includes(service.id)
  );
  const availableServices = services.filter(
    (service) => !form.serviceIds.includes(service.id)
  );
  const availableServiceOptions = [...availableServices]
    .sort((a, b) => {
      const aPackage = isPackageCatalogServiceName(a.name);
      const bPackage = isPackageCatalogServiceName(b.name);
      if (aPackage !== bPackage) return aPackage ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((service) => {
      const duration = formatServiceDuration(service.duration_minutes);
      const isPackage = isPackageCatalogServiceName(service.name);
      const kindLabel = service.name.toLowerCase().startsWith("coating")
        ? "Coating"
        : service.name.toLowerCase().startsWith("pacote")
          ? "Stage"
          : null;
      const details = [
        kindLabel,
        duration,
        getServicePrice(service) > 0 ? formatCurrency(getServicePrice(service)) : null,
      ].filter(Boolean);

      return {
        value: service.id,
        label: service.name,
        description: details.length > 0
          ? details.join(" • ")
          : isPackage
            ? "Pacote"
            : "Serviço cadastrado",
      };
    });
  const servicesTotal = selectedServices.reduce(
    (total, service) => total + getServicePrice(service),
    0
  );
  const customTotalAmount = (() => {
    const normalized = form.totalAmount.trim().replace(/\./g, "").replace(",", ".");
    return normalized ? Number(normalized) : NaN;
  })();
  const hasCustomTotalAmount = form.totalAmount.trim() !== "";
  const displayTotalAmount =
    hasCustomTotalAmount && !Number.isNaN(customTotalAmount)
      ? customTotalAmount
      : servicesTotal;

  function startEditingTotalAmount() {
    setForm((prev) => {
      const current =
        hasCustomTotalAmount && !Number.isNaN(customTotalAmount)
          ? prev.totalAmount
          : servicesTotal.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });

      return { ...prev, totalAmount: current };
    });
    setEditingTotalAmount(true);
  }

  function saveTotalAmount() {
    try {
      const amount = parseAppointmentAmount(form.totalAmount);
      setForm((prev) => ({ ...prev, totalAmount: String(amount) }));
      setEditingTotalAmount(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Informe um valor válido para o total."
      );
    }
  }

  function resetTotalAmountToServicesSum() {
    setForm((prev) => ({ ...prev, totalAmount: "" }));
    setEditingTotalAmount(false);
    setError(null);
  }
  const slotOccupancyForFormDate = useMemo(() => {
    const appointmentsForDate = appointments.filter(
      (appointment) =>
        appointmentOccursOnDate(appointment, form.date) &&
        appointment.id !== editingAppointmentId
    );

    return timeSlots.reduce<Map<string, number>>((acc, time) => {
      const count = appointmentsForDate.filter((appointment) =>
        isTimeInRange(time, appointment.startTime, appointment.endTime)
      ).length;

      acc.set(time, count);
      return acc;
    }, new Map());
  }, [appointments, editingAppointmentId, form.date]);

  function resetForm() {
    setForm({
      date: selectedKey,
      endDate: selectedKey,
      isMultiDay: false,
      startTime: "",
      endTime: "",
      clientId: "",
      vehicleId: "",
      serviceIds: [],
      totalAmount: "",
      notes: "",
      preCadastro: false,
      preCadastroLabel: "",
    });
    setError(null);
    setAddingService(false);
    setEditingTotalAmount(false);
    setOpenSelectId(null);
    setNotesPanelOpen(false);
    setNotesDraft("");
  }

  function openCreateForm() {
    resetForm();
    setEditingAppointmentId(null);
    setFormClosing(false);
    setCreating(true);
  }

  useEffect(() => {
    if (
      !linkedClientId ||
      loadingClients ||
      linkedClientHandledRef.current === linkedClientId
    ) {
      return;
    }

    const linkedClient = clients.find((client) => client.id === linkedClientId);
    if (!linkedClient) return;

    void Promise.resolve().then(() => {
      const targetDate = wallClockInTimeZone(new Date(), timeZone);
      const targetKey = dateKey(targetDate);

      linkedClientHandledRef.current = linkedClientId;
      setCurrentMonth(startOfMonth(targetDate));
      setSelectedDate(targetDate);
      setFocusedAppointmentId(null);
      setDayDrawerOpen(true);
      setEditingAppointmentId(null);
      setForm({
        date: targetKey,
        endDate: targetKey,
        isMultiDay: false,
        startTime: "",
        endTime: "",
        clientId: linkedClient.id,
        vehicleId: linkedClient.vehicles?.[0]?.id ?? "",
        serviceIds: [],
        totalAmount: "",
        notes: "",
        preCadastro: false,
        preCadastroLabel: "",
      });
      setError(null);
      setAddingService(false);
      setEditingTotalAmount(false);
      setOpenSelectId(null);
      setFormClosing(false);
      setCreating(true);
    });
  }, [clients, linkedClientId, loadingClients, timeZone]);

  useEffect(() => {
    if (
      !linkedServiceIds ||
      loadingServices ||
      linkedServicesHandledRef.current === linkedServiceIds
    ) {
      return;
    }
    linkedServicesHandledRef.current = linkedServiceIds;

    const ids = linkedServiceIds.split(",").filter(Boolean);
    if (ids.length === 0) return;

    const validIds = ids.filter((id) => services.some((s) => s.id === id));
    if (validIds.length === 0) return;

    void Promise.resolve().then(() => {
      const targetDate = wallClockInTimeZone(new Date(), timeZone);
      const targetKey = dateKey(targetDate);

      setCurrentMonth(startOfMonth(targetDate));
      setSelectedDate(targetDate);
      setFocusedAppointmentId(null);
      setDayDrawerOpen(true);
      setEditingAppointmentId(null);
      setForm((prev) => ({
        ...prev,
        date: targetKey,
        endDate: targetKey,
        isMultiDay: false,
        serviceIds: validIds,
      }));
      setError(null);
      setAddingService(false);
      setEditingTotalAmount(false);
      setOpenSelectId(null);
      setFormClosing(false);
      setCreating(true);
    });
  }, [services, linkedServiceIds, loadingServices, timeZone]);

  function openEditForm(appointment: Appointment) {
    setOpenStatusMenuId(null);
    const appointmentEndDate = getAppointmentEndDate(appointment);
    const useCustomTotal = isCustomAppointmentTotal(appointment, services);

    setForm({
      date: appointment.date,
      endDate: appointmentEndDate,
      isMultiDay: appointmentEndDate !== appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      clientId: appointment.clientId,
      vehicleId: appointment.vehicleId,
      serviceIds: appointment.serviceIds,
      totalAmount:
        useCustomTotal && appointment.totalAmount > 0
          ? String(appointment.totalAmount)
          : "",
      notes: appointment.notes,
      // Editar agendamento existente nunca cria pré-cadastro: o cliente já existe.
      preCadastro: false,
      preCadastroLabel: "",
    });
    setEditingAppointmentId(appointment.id);
    setError(null);
    setCreating(true);
    setAddingService(false);
    setEditingTotalAmount(false);
    setFormClosing(false);
    setOpenSelectId(null);
  }

  function openEditFromServiceList(appointment: Appointment) {
    setActiveAgendaTab("calendar");
    syncSelectedDate(appointment.date);
    setDayDrawerOpen(true);
    openEditForm(appointment);
  }

  function openContactModal(appointment: Appointment) {
    setContactAppointment(appointment);
  }

  function openServiceListActionsModal(appointment: Appointment) {
    setServiceListActionsAppointment(appointment);
  }

  function openWhatsApp(appointment: Appointment, templateKey: string) {
    const phone = clients
      .find((client) => client.id === appointment.clientId)
      ?.phone?.replace(/\D/g, "");

    if (!phone) {
      window.alert("Cliente sem telefone cadastrado");
      return;
    }

    const firstName = appointment.client.split(" ")[0];
    const date = formatShortDate(appointment.date);
    const time = appointment.startTime;

    const templates: Record<string, string> = {
      concluido: `Olá ${firstName}! 😊 Seu veículo (${appointment.vehicle}) está pronto para retirada. Qualquer dúvida estamos à disposição!`,
      confirmar: `Olá ${firstName}! Passando para confirmar seu agendamento no dia ${date} às ${time} para ${appointment.service}. Podemos confirmar?`,
      orcamento: `Olá ${firstName}! Temos uma atualização sobre o orçamento do seu veículo (${appointment.vehicle}). Pode falar agora?`,
      lembrete: `Olá ${firstName}! Lembrando que seu agendamento é amanhã, dia ${date} às ${time}. Qualquer dúvida é só chamar! 🙌`,
      personalizada: "",
    };

    const message = templates[templateKey];
    const url = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
    setContactAppointment(null);
  }

  function addServiceToForm(serviceId: string) {
    if (!serviceId) return;

    setForm((prev) =>
      prev.serviceIds.includes(serviceId)
        ? prev
        : { ...prev, serviceIds: [...prev.serviceIds, serviceId] }
    );
    setAddingService(false);
    setOpenSelectId(null);
  }

  function removeServiceFromForm(serviceId: string) {
    setForm((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.filter((id) => id !== serviceId),
    }));
  }

  async function handleCreateInlineService() {
    if (!workshopId) {
      setInlineServiceError("Oficina não encontrada.");
      return;
    }

    const name = inlineServiceForm.name.trim();
    if (!name) {
      setInlineServiceError("Informe o nome do serviço.");
      return;
    }

    const normalizedPrice = inlineServiceForm.price.replace(/\./g, "").replace(",", ".");
    const price = Number(normalizedPrice || "0");
    if (!Number.isFinite(price) || price < 0) {
      setInlineServiceError("Informe um preço válido.");
      return;
    }

    const duration = Number(inlineServiceForm.durationMinutes);
    if (!Number.isInteger(duration) || duration <= 0) {
      setInlineServiceError("Informe uma duração válida.");
      return;
    }

    setSavingInlineService(true);
    setInlineServiceError(null);

    try {
      const { data: inserted, error: insertError } = await supabase
        .from("services")
        .insert({ name, price, duration_minutes: duration, workshop_id: workshopId, active: true })
        .select("id, name, price, duration_minutes, active")
        .single();

      if (insertError) throw insertError;

      const newService = inserted as AgendaService;
      setServices((prev) => [...prev, newService]);
      setForm((prev) => ({ ...prev, serviceIds: [...prev.serviceIds, newService.id] }));
      setCreatingServiceInline(false);
      setInlineServiceForm({ name: "", price: "", durationMinutes: "60" });
      setInlineServiceError(null);
    } catch (err) {
      setInlineServiceError(
        err instanceof Error ? err.message : "Erro ao criar o serviço."
      );
    } finally {
      setSavingInlineService(false);
    }
  }

  function hasAppointmentConflict(
    startDate: string,
    endDate: string,
    startTime: string,
    endTime: string
  ) {
    return getDateRangeKeys(startDate, endDate).some((date) => {
      const [dayStart, dayEnd] = getDailyTimeWindow(
        date,
        startDate,
        endDate,
        startTime,
        endTime
      );

      const appointmentsForDate = appointments.filter((appointment) => {
        if (
          !appointmentOccursOnDate(appointment, date) ||
          appointment.id === editingAppointmentId
        ) {
          return false;
        }

        const [existingStart, existingEnd] = getDailyTimeWindow(
          date,
          appointment.date,
          getAppointmentEndDate(appointment),
          appointment.startTime,
          appointment.endTime
        );

        return rangesOverlap(dayStart, dayEnd, existingStart, existingEnd);
      });

      return timeSlots
        .filter((time) => isTimeInRange(time, dayStart, dayEnd))
        .some((time) => {
          const occupiedCount = appointmentsForDate.filter((appointment) => {
            const [existingStart, existingEnd] = getDailyTimeWindow(
              date,
              appointment.date,
              getAppointmentEndDate(appointment),
              appointment.startTime,
              appointment.endTime
            );

            return isTimeInRange(time, existingStart, existingEnd);
          }).length;

          return occupiedCount >= agendaCapacity;
        });
    });
  }

  function selectTimeSlot(time: string) {
    setError(null);

    const canPickEndTime =
      form.startTime &&
      !form.endTime &&
      (form.isMultiDay || timeToMinutes(time) > timeToMinutes(form.startTime));

    if (!canPickEndTime) {
      setForm((prev) => ({ ...prev, startTime: time, endTime: "" }));
      return;
    }

    const formEndDate = form.isMultiDay ? form.endDate : form.date;
    if (hasAppointmentConflict(form.date, formEndDate, form.startTime, time)) {
      setError("Capacidade máxima atingida para esse intervalo.");
      return;
    }

    setForm((prev) => ({ ...prev, endTime: time }));
  }

  function closeForm() {
    setOpenSelectId(null);
    setNotesPanelOpen(false);
    setNotesDraft("");
    setFormClosing(true);

    window.setTimeout(() => {
      resetForm();
      setEditingAppointmentId(null);
      setCreating(false);
      setFormClosing(false);
      setFormFromServiceList(false);
    }, 220);
  }

  function syncSelectedDate(date: string) {
    const nextDate = new Date(`${date}T00:00:00`);
    setFocusedAppointmentId(null);
    setSelectedDate(nextDate);
    setCurrentMonth(startOfMonth(nextDate));
  }

  function selectCalendarDate(day: Date) {
    const key = dateKey(day);
    setFocusedAppointmentId(null);
    setSelectedDate(day);
    setDayDrawerOpen(true);

    if (creating) {
      setForm((prev) => ({
        ...prev,
        date: key,
        endDate: prev.isMultiDay && prev.endDate >= key ? prev.endDate : key,
      }));
    }
  }

  function openNotesPanel() {
    setNotesDraft(form.notes);
    setNotesPanelOpen(true);
  }

  function saveNotesDraft() {
    setForm((prev) => ({ ...prev, notes: notesDraft.trim() }));
    setNotesPanelOpen(false);
  }

  function cancelNotesDraft() {
    setNotesDraft(form.notes);
    setNotesPanelOpen(false);
  }

  function removeNotesFromForm() {
    setForm((prev) => ({ ...prev, notes: "" }));
    setNotesDraft("");
    setNotesPanelOpen(false);
  }

  async function handleSaveAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workshopId) {
      setError("Oficina não encontrada.");
      return;
    }

    if (
      !form.date ||
      (form.isMultiDay && !form.endDate) ||
      !form.startTime ||
      !form.endTime ||
      !form.clientId ||
      !form.vehicleId ||
      form.serviceIds.length === 0
    ) {
      setError("Informe data, começo, final, cliente, veículo e serviço.");
      return;
    }

    const appointmentEndDate = form.isMultiDay ? form.endDate : form.date;
    if (appointmentEndDate < form.date || (form.isMultiDay && appointmentEndDate === form.date)) {
      setError("A data de término precisa ser depois da data de início.");
      return;
    }

    if (
      !form.isMultiDay &&
      timeToMinutes(form.endTime) <= timeToMinutes(form.startTime)
    ) {
      setError("O horário final precisa ser depois do começo.");
      return;
    }

    if (
      hasCustomTotalAmount &&
      (Number.isNaN(customTotalAmount) || customTotalAmount < 0)
    ) {
      setError("Informe um valor válido para o total.");
      return;
    }

    if (
      hasAppointmentConflict(
        form.date,
        appointmentEndDate,
        form.startTime,
        form.endTime
      )
    ) {
      setError("Capacidade máxima atingida para esse intervalo.");
      return;
    }

    let appointmentClient = clients.find(
      (client) => client.id === form.clientId
    );
    let appointmentVehicle = appointmentClient?.vehicles?.find(
      (vehicle) => vehicle.id === form.vehicleId
    );

    // Cliente não cadastrado: cria na hora um cliente incompleto (e um veículo de marcação),
    // para o horário poder ser salvo sem ter nome, telefone ou carro em mãos. O cadastro é
    // finalizado depois, pela tela de clientes.
    if (form.preCadastro && !editingAppointmentId) {
      if (selectedServices.length === 0) {
        setError("Selecione ao menos um serviço.");
        return;
      }
      if (!workshopId) {
        setError("Oficina não encontrada.");
        return;
      }

      try {
        const novoCliente = await createPreCadastroClient(
          supabase,
          workshopId,
          form.preCadastroLabel
        );
        setClients((prev) =>
          [...prev, novoCliente].sort((a, b) => a.name.localeCompare(b.name))
        );
        appointmentClient = novoCliente;
        appointmentVehicle = novoCliente.vehicles?.[0];
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Erro ao criar o pré-cadastro."
        );
        return;
      }
    }

    if (!appointmentClient || !appointmentVehicle || selectedServices.length === 0) {
      setError("Selecione cliente, veículo e serviço válidos.");
      return;
    }

    const vehicleLabel = appointmentVehicle.pre_cadastro
      ? "Veículo a definir"
      : `${appointmentVehicle.brand} ${appointmentVehicle.model} - ${appointmentVehicle.plate}`;
    const serviceLabel = selectedServices.map((service) => service.name).join(", ");

    let resolvedCustomTotal = customTotalAmount;
    if (hasCustomTotalAmount || editingTotalAmount) {
      try {
        resolvedCustomTotal = parseAppointmentAmount(form.totalAmount);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Informe um valor válido para o total."
        );
        return;
      }
    }

    const appointmentTotal = hasCustomTotalAmount || editingTotalAmount
      ? resolvedCustomTotal
      : servicesTotal;
    const currentStatus =
      appointments.find((appointment) => appointment.id === editingAppointmentId)
        ?.status ?? "Pendente";
    const payload = {
      client_id: appointmentClient.id,
      vehicle_id: appointmentVehicle.id,
      total_amount: appointmentTotal,
      notes: form.notes.trim() || null,
      scheduled_date: form.date,
      scheduled_end_date: appointmentEndDate,
      scheduled_start: form.startTime,
      scheduled_end: form.endTime,
      status: getServiceOrderStatus(currentStatus),
      completed_at:
        currentStatus === "Concluído" ? new Date().toISOString() : null,
    };
    const serviceItems = buildServiceOrderItems(selectedServices, appointmentTotal);

    setSavingAppointment(true);
    setError(null);

    try {
      let savedAppointmentId = editingAppointmentId;

      if (editingAppointmentId) {
        const { data: updatedRows, error: updateError } = await updateAppointmentOrder(
          supabase,
          editingAppointmentId,
          payload
        );

        assertMutationRows(updatedRows, updateError, "atualizar o agendamento");

        const { error: deleteItemsError } = await deleteAppointmentItems(
          supabase,
          editingAppointmentId
        );

        if (deleteItemsError) throw deleteItemsError;
      } else {
        const { data: insertedOrder, error: insertError } = await insertAppointmentOrder(
          supabase,
          workshopId,
          payload
        );

        if (insertError) throw insertError;
        savedAppointmentId = insertedOrder?.id ?? null;
      }

      if (!savedAppointmentId) {
        throw new Error("Erro ao salvar agendamento.");
      }

      const { data: insertedItems, error: insertItemsError } = await saveAppointmentItems(
        supabase,
        savedAppointmentId,
        serviceItems
      );

      assertMutationRows(
        insertedItems,
        insertItemsError,
        "salvar os serviços do agendamento"
      );

      const savedAppointment: Appointment = {
        id: savedAppointmentId,
        date: form.date,
        endDate: appointmentEndDate,
        startTime: form.startTime,
        endTime: form.endTime,
        clientId: appointmentClient.id,
        vehicleId: appointmentVehicle.id,
        serviceIds: selectedServices.map((service) => service.id),
        client: appointmentClient.name,
        service: serviceLabel,
        totalAmount: appointmentTotal,
        vehicle: vehicleLabel,
        status: currentStatus,
        notes: form.notes.trim(),
      };

      setAppointments((prev) =>
        editingAppointmentId
          ? prev.map((appointment) =>
              appointment.id === editingAppointmentId
                ? savedAppointment
                : appointment
            )
          : [...prev, savedAppointment]
      );
      if (savedAppointment.status === "Concluído") {
        const financeError = await syncFinanceRevenueForAppointment(savedAppointment);
        if (financeError) {
          setError(financeError);
        }
      }
      if (!formFromServiceList) {
        syncSelectedDate(form.date);
      }
      closeForm();
    } catch (err) {
      if (isMissingAgendaMigrationError(err)) {
        setError(
          "Supabase da Agenda não está pronto. Aplique as migrations antes de salvar novos agendamentos."
        );
        return;
      }

      setError(
        err instanceof Error ? err.message : "Erro ao salvar agendamento."
      );
    } finally {
      setSavingAppointment(false);
    }
  }

  function requestDeleteAppointment(appointment: Appointment) {
    setOpenStatusMenuId(null);
    setDeleteConfirm({ type: "appointment", appointment });
  }

  async function executeDeleteAppointment(appointment: Appointment) {
    setDeletingAppointments(true);
    setError(null);

    try {
      const { error: deleteItemsError } = await deleteAppointmentItems(
        supabase,
        appointment.id
      );
      if (deleteItemsError) throw new Error(deleteItemsError.message);

      const { data: deletedRows, error: deleteError } = await deleteAppointment(
        supabase,
        appointment.id
      );

      assertMutationRows(deletedRows, deleteError, "excluir o agendamento");

      setAppointments((prev) =>
        prev.filter((item) => item.id !== appointment.id)
      );

      if (editingAppointmentId === appointment.id) {
        closeForm();
      }

      setDeleteConfirm(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao excluir o agendamento."
      );
    } finally {
      setDeletingAppointments(false);
    }
  }

  function requestClearSelectedDay() {
    setOpenStatusMenuId(null);
    setDeleteConfirm({ type: "clearDay" });
  }

  async function executeClearSelectedDay() {
    setDeletingAppointments(true);
    setError(null);

    try {
      const appointmentIds = selectedAppointments.map((appointment) => appointment.id);

      if (appointmentIds.length > 0) {
        for (const id of appointmentIds) {
          const { error: deleteItemsError } = await deleteAppointmentItems(supabase, id);
          if (deleteItemsError) throw new Error(deleteItemsError.message);
        }

        const { data: deletedRows, error: deleteError } = await deleteAppointmentsForDay(
          supabase,
          appointmentIds
        );

        assertMutationRows(
          deletedRows,
          deleteError,
          "excluir os agendamentos do dia"
        );
      }

      setAppointments((prev) =>
        prev.filter((appointment) => appointment.date !== selectedKey)
      );
      closeForm();
      setDeleteConfirm(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao excluir os agendamentos do dia."
      );
    } finally {
      setDeletingAppointments(false);
    }
  }

  async function handleChangeStatus(
    appointmentId: string,
    status: AppointmentStatus
  ) {
    const currentAppointment = appointments.find(
      (appointment) => appointment.id === appointmentId
    );
    const shouldDiscountStock =
      status === "Concluído" && currentAppointment?.status !== "Concluído";
    const shouldRemoveFinanceRevenue =
      status !== "Concluído" && currentAppointment?.status === "Concluído";

    const { data: updatedRows, error: updateError } = await updateAppointmentStatus(
      supabase,
      appointmentId,
      status,
      status === "Concluído" ? new Date().toISOString() : null
    );

    try {
      assertMutationRows(updatedRows, updateError, "atualizar o status do agendamento");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao atualizar o status do agendamento."
      );
      return;
    }

    if (currentAppointment && status === "Concluído") {
      const financeError = await syncFinanceRevenueForAppointment(currentAppointment);
      if (financeError) {
        setError(financeError);
      }
    }

    if (shouldRemoveFinanceRevenue) {
      const financeError = await deleteFinanceRevenueForAppointment(appointmentId);
      if (financeError) {
        setError(financeError);
      }
    }

    setAppointments((prev) =>
      prev.map((appointment) =>
        appointment.id === appointmentId
          ? { ...appointment, status }
          : appointment
      )
    );
    if (currentAppointment && shouldDiscountStock) {
      void applySupabaseStockDiscountForAppointment(currentAppointment).catch((err) => {
        setError(
          err instanceof Error
            ? `Estoque não sincronizou no Supabase: ${err.message}`
            : "Estoque não sincronizou no Supabase."
        );
      });
    }
    closeStatusMenu(appointmentId);
  }

  function toggleStatusMenu(appointmentId: string) {
    if (openStatusMenuId === appointmentId) {
      closeStatusMenu(appointmentId);
      return;
    }

    setClosingStatusMenuId(null);
    setOpenStatusMenuId(appointmentId);
  }

  function closeStatusMenu(appointmentId: string) {
    setOpenStatusMenuId(null);
    setClosingStatusMenuId(appointmentId);

    window.setTimeout(() => {
      setClosingStatusMenuId((current) =>
        current === appointmentId ? null : current
      );
    }, 180);
  }

  const updateAppointmentNotes = useCallback(
    async (appointmentId: string, notes: string | null) => {
      const trimmedNotes = notes?.trim() ?? "";

      const { data: updatedRows, error: updateError } = await updateAppointmentNotesDb(
        supabase,
        appointmentId,
        trimmedNotes || null
      );

      assertMutationRows(updatedRows, updateError, "atualizar a observação");

      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.id === appointmentId
            ? { ...appointment, notes: trimmedNotes }
            : appointment
        )
      );
    },
    [supabase]
  );

  async function handleCreateClient(data: ClientFormData) {
    if (!workshopId) {
      throw new Error("Oficina não encontrada.");
    }

    const client = await createClientWithVehicles(supabase, workshopId, data);
    setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((prev) => ({
      ...prev,
      clientId: client.id,
      vehicleId: client.vehicles?.[0]?.id ?? "",
    }));
    setOpenSelectId(null);
  }

  return (
    <>
      <div className="mb-6 border-b border-border">
        <div className="flex items-center gap-6">
          {agendaPageTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveAgendaTab(tab.id);
                if (tab.id === "serviceList") {
                  setDayDrawerOpen(false);
                  closeForm();
                  setOpenStatusMenuId(null);
                }
              }}
              className={`border-b-2 px-0 pb-3 pt-1 text-sm transition-all duration-200 ease-out ${
                activeAgendaTab === tab.id
                  ? "border-primary font-bold text-primary"
                  : "border-transparent font-semibold text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeAgendaTab === "calendar" ? (
        <div key="agenda-calendar-panel" className="agenda-tab-panel-enter min-w-0">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="rounded-lg border border-border bg-card p-4 shadow-card sm:p-6">
          <div className="flex items-start justify-between gap-4 sm:gap-5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-muted">
                <CalendarBlank
                  size={18}
                  weight={AGENDA_ICON_WEIGHT}
                  className="shrink-0"
                  aria-hidden
                />
                {occupancyTitle}
              </p>
              <div
                className="timeline-track-loading relative mt-4 overflow-hidden rounded-lg bg-border shadow-inner"
                style={{
                  height: `${Math.max(1, selectedTimelineLaneCount) * 1.75}rem`,
                }}
              >
                {timelineBlocks.map(({ appointment, laneIndex, roundedClass, start, width }, index) => {
                  const style = getStatusStyle(appointment.status);
                  const laneHeight = 100 / selectedTimelineLaneCount;

                  return (
                    <button
                      type="button"
                      key={`${appointment.id}-${appointment.status}`}
                      onClick={() => setFocusedAppointmentId(appointment.id)}
                      title={`${appointment.startTime} - ${appointment.endTime} • ${appointment.client} • ${appointment.service}`}
                      aria-label={`Mostrar ${appointment.client} no próximo cliente`}
                      className={`timeline-block-loading timeline-service-hover absolute cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/80 ${roundedClass} ${style.timelineBlock}`}
                      style={{
                        left: `${start}%`,
                        width: `${width}%`,
                        top: `${laneIndex * laneHeight}%`,
                        height: `calc(${laneHeight}% - 2px)`,
                        animationDelay: `${index * 70}ms`,
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex justify-between text-[11px] font-medium text-muted">
                {timelineMarkers.map((marker) => (
                  <span key={marker}>{marker}</span>
                ))}
              </div>
              {selectedAppointments.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedStatusCounts
                    .filter(({ count }) => count > 0)
                    .map(({ status, count }) => {
                      const style = getStatusStyle(status);

                      return (
                        <span
                          key={status}
                          className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1 text-xs font-semibold text-muted"
                        >
                          {status !== "Concluído" && (
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${style.timelineBlock}`}
                            />
                          )}
                          <span className="inline-flex items-center gap-1">
                            <AppointmentStatusLabel status={status} iconSize={12} />
                            <span>: {count}</span>
                          </span>
                        </span>
                      );
                    })}
                </div>
              ) : null}
              <p className="mt-3 text-sm font-medium text-foreground">
                {formatAppointmentCount(selectedAppointments.length)}
              </p>
            </div>
          </div>
        </div>

        <div
          className={`rounded-lg border-l-4 bg-card p-4 shadow-card sm:p-6 ${
            nextAppointmentStyle?.sideAccent ?? "border-l-border"
          }`}
        >
          <div className="flex min-h-[10.5rem] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-muted">Próximo cliente</p>
              {nextAppointment ? (
                <>
                  <p className="mt-2 currency-display leading-tight text-foreground sm:text-3xl">
                    {nextAppointment.client}
                  </p>
                  <div className="mt-3 flex min-h-[1.75rem] flex-wrap gap-2">
                    {nextAppointmentServices.map((service) => (
                      <span
                        key={service}
                        className="rounded-full bg-background px-3 py-1 text-xs font-semibold text-muted"
                      >
                        {service}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                    <Car size={16} weight={AGENDA_ICON_WEIGHT} className="shrink-0" aria-hidden />
                    <span>{nextAppointment.vehicle}</span>
                  </p>
                  {nextAppointment.isMultiDay && (
                    <p className="mt-2 text-sm font-semibold text-primary">
                      {formatAppointmentDuration(nextAppointment)}
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-4 flex flex-col items-center justify-center py-3 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/10 text-muted/50">
                    <CalendarX
                      size={20}
                      weight={AGENDA_ICON_WEIGHT}
                      aria-hidden
                    />
                  </div>
                  <p className="mt-3 text-sm font-medium text-muted">
                    Nenhum agendamento pendente
                  </p>
                  <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-muted/70">
                    Aproveite para organizar sua agenda
                  </p>
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
              {nextAppointment && (
                <>
                  <span
                    className={`w-full whitespace-nowrap rounded-lg px-5 py-4 text-center text-xl font-bold leading-tight shadow-card sm:min-w-44 ${nextAppointmentStyle?.timeBadge}`}
                  >
                    {nextAppointment.startTime} - {nextAppointment.endTime}
                  </span>
                  <div className="flex w-full flex-col items-start gap-2 sm:items-end">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${nextAppointmentStyle?.statusBadge}`}
                    >
                      {nextAppointment.status !== "Concluído" && (
                        <span className="h-2 w-2 rounded-full bg-current" />
                      )}
                      <AppointmentStatusLabel status={nextAppointment.status} />
                    </span>

                    <div className="grid w-full grid-cols-2 gap-1.5 sm:w-auto">
                      {appointmentStatuses.map((status) => {
                        const optionStyle = getStatusStyle(status);
                        const isCurrentStatus = nextAppointment.status === status;

                        return (
                          <button
                            key={status}
                            type="button"
                            disabled={isCurrentStatus}
                            onClick={() =>
                              handleChangeStatus(nextAppointment.id, status)
                            }
                            className={`min-h-9 rounded-full border px-2 py-1 text-[10px] font-semibold transition-all sm:min-h-0 ${
                              isCurrentStatus
                                ? "cursor-default border-current opacity-60"
                                : "border-transparent hover:-translate-y-0.5 hover:shadow-card"
                            } ${optionStyle.statusBadge}`}
                          >
                            <AppointmentStatusLabel status={status} iconSize={12} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 md:mt-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="self-start rounded-lg border border-border bg-card shadow-card shadow-card">
          <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h2 className="text-lg font-semibold capitalize text-foreground">
                {formatMonthTitle(currentMonth)}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Clique em um dia para ver ou organizar os horários.
              </p>
            </div>

            <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))}
                className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-background p-2 text-muted transition-colors hover:text-foreground sm:min-h-0"
                aria-label="Mês anterior"
              >
                <CaretLeft size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentMonth(startOfMonth(now));
                  selectCalendarDate(now);
                }}
                className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base font-medium text-foreground transition-colors hover:border-accent sm:min-h-0 sm:text-sm"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
                className="flex min-h-11 items-center justify-center rounded-lg border border-border bg-background p-2 text-muted transition-colors hover:text-foreground sm:min-h-0"
                aria-label="Próximo mês"
              >
                <CaretRight size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-border bg-background/60 px-2 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-muted sm:px-4 sm:text-xs">
            {weekdays.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 p-2 sm:gap-2 sm:p-4">
            {calendarDays.map((day, index) => {
              const key = dateKey(day);
              const dayAppointments = (appointmentsByDate[key] ?? []).sort((a, b) =>
                a.startTime.localeCompare(b.startTime)
              );
              const visibleAppointments = dayAppointments.slice(0, 2);
              const hiddenAppointmentsCount = Math.max(
                dayAppointments.length - visibleAppointments.length,
                0
              );
              const isSelected = key === selectedKey;
              const isToday = key === dateKey(now);

              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => selectCalendarDate(day)}
                  style={index === 0 ? { gridColumnStart: day.getDay() + 1 } : undefined}
                  className={`flex min-h-14 flex-col items-start rounded-lg border p-1 text-left transition-colors sm:min-h-24 sm:p-2 ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-card"
                      : "border-transparent hover:border-border hover:bg-background"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold sm:h-6 sm:w-6 ${
                        isToday ? "bg-success text-white" : "text-foreground"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {dayAppointments.length > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-success/10 px-1.5 text-[10px] font-bold text-success sm:hidden">
                        {dayAppointments.length}
                      </span>
                    )}
                  </div>

                  {dayAppointments.length > 0 && (
                    <div className="mt-2 hidden w-full flex-col items-start gap-0.5 sm:flex">
                      {visibleAppointments.map((appointment) => {
                        const style = getStatusStyle(appointment.status);
                        const multiDayClass = appointment.isMultiDay
                          ? appointment.isFirstDay
                            ? "calendar-multiday-pill calendar-multiday-start"
                            : appointment.isLastDay
                              ? "calendar-multiday-pill calendar-multiday-end"
                              : "calendar-multiday-pill calendar-multiday-middle"
                          : "";

                        return (
                          <span
                            key={appointment.id}
                            className={`calendar-appointment-pill ${style.calendarPill} ${multiDayClass}`}
                            title={`${appointment.startTime} - ${appointment.endTime} • ${appointment.client}${appointment.isMultiDay ? ` • ${formatAppointmentDuration(appointment)}` : ""}`}
                          >
                            {appointment.isContinuation ? (
                              <>
                                <span className="calendar-pill-label">
                                  {appointment.startTime} (continuação)
                                </span>
                              </>
                            ) : (
                              <span className="calendar-pill-label">
                                {appointment.startTime}{" "}
                                {getShortClientName(appointment.client)}
                              </span>
                            )}
                          </span>
                        );
                      })}

                      {hiddenAppointmentsCount > 0 && (
                        <span className="calendar-appointment-pill calendar-more-pill">
                          +{hiddenAppointmentsCount} mais
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {dayDrawerOpen && (
          <button
            type="button"
            aria-label="Fechar detalhes do dia"
            className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
            onClick={() => setDayDrawerOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-3xl border border-border bg-card shadow-2xl transition-transform duration-300 md:static md:z-auto md:max-h-none md:translate-y-0 md:overflow-visible md:rounded-lg md:shadow-card ${
            dayDrawerOpen ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              Dia selecionado
            </p>
            <h2 className="mt-1 text-lg font-semibold capitalize text-foreground">
              {formatLongDate(selectedDate)}
            </h2>
            </div>
            <button
              type="button"
              onClick={() => setDayDrawerOpen(false)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-muted transition-colors hover:text-foreground md:hidden"
              aria-label="Fechar painel do dia"
            >
              <X size={20} weight={AGENDA_ICON_WEIGHT} aria-hidden />
            </button>
          </div>

          <div className="space-y-4 p-5 sm:p-6">
            <Button
              variant="success"
              className="w-full"
              onClick={openCreateForm}
            >
              <Plus size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
              Novo agendamento
            </Button>

            {selectedAppointments.length > 0 && (
              <button
                type="button"
                onClick={requestClearSelectedDay}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-base font-medium text-danger transition-colors hover:bg-danger hover:text-white sm:min-h-0 sm:py-2.5 sm:text-sm"
              >
                <Trash size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                Remover agendamentos do dia
              </button>
            )}

            {!formFromServiceList && creating && (
              <form
                onSubmit={handleSaveAppointment}
                className={`relative overflow-visible space-y-4 rounded-lg border border-border bg-background shadow-card p-4 ${
                  formClosing ? "agenda-form-exit" : "agenda-form-enter"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    {editingAppointmentId ? "Editar horário" : "Novo horário"}
                  </h3>
                  <button
                    type="button"
                    onClick={closeForm}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground sm:min-h-0 sm:min-w-0 sm:p-1"
                    aria-label="Fechar formulário"
                  >
                    <X size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                  </button>
                </div>
                <Input
                  label="Data"
                  type="date"
                  value={form.date}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      date: nextDate,
                      endDate:
                        prev.isMultiDay && prev.endDate >= nextDate
                          ? prev.endDate
                          : nextDate,
                    }));
                    if (nextDate) syncSelectedDate(nextDate);
                  }}
                />
                <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        isMultiDay: !prev.isMultiDay,
                        endDate: !prev.isMultiDay ? prev.endDate || prev.date : prev.date,
                      }))
                    }
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        Serviço de múltiplos dias
                      </span>
                      <span className="mt-1 block text-xs text-muted">
                        O horário de início vale para o primeiro dia e o horário final para o
                        último dia do período.
                      </span>
                    </span>
                    <span
                      className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors ${
                        form.isMultiDay ? "bg-success" : "bg-muted/20"
                      }`}
                    >
                      <span
                        className={`h-5 w-5 rounded-full bg-white shadow-card transition-transform ${
                          form.isMultiDay ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </span>
                  </button>
                  {form.isMultiDay && (
                    <div className="mt-3">
                      <Input
                        label="Data de término"
                        type="date"
                        min={form.date}
                        value={form.endDate}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            endDate: event.target.value,
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="agenda-client"
                      className="block text-sm font-semibold text-foreground"
                    >
                      Cliente
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenSelectId(null);
                        setClientModalOpen(true);
                      }}
                      className="min-h-11 text-sm font-semibold text-success transition-colors hover:text-success/80 sm:min-h-0 sm:text-xs"
                    >
                      Novo cliente
                    </button>
                  </div>
                  <label className="mb-2.5 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={form.preCadastro}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          preCadastro: e.target.checked,
                          clientId: "",
                          vehicleId: "",
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span>
                      Cliente não cadastrado
                      <span className="block text-xs text-muted">
                        Salva o horário agora. O cadastro fica pendente na tela de clientes.
                      </span>
                    </span>
                  </label>
                  {form.preCadastro && (
                    <div className="mb-2.5">
                      <Input
                        label="Como identificar (opcional)"
                        value={form.preCadastroLabel}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, preCadastroLabel: e.target.value }))
                        }
                        placeholder="ex: João do Civic prata"
                      />
                    </div>
                  )}
                  <AgendaDropdown
                    id="agenda-client"
                    value={form.clientId}
                    placeholder={
                      form.preCadastro
                        ? "Pré-cadastro: criado ao salvar"
                        : loadingClients
                          ? "Carregando clientes..."
                          : "Selecione um cliente"
                    }
                    emptyMessage="Nenhum cliente cadastrado."
                    options={clientOptions}
                    disabled={loadingClients || form.preCadastro}
                    open={openSelectId === "client"}
                    searchable
                    searchPlaceholder="Digite nome ou telefone"
                    noResultsMessage="Nenhum cliente encontrado."
                    onToggle={() =>
                      setOpenSelectId((current) =>
                        current === "client" ? null : "client"
                      )
                    }
                    onSelect={(value) => {
                      setForm((prev) => ({
                        ...prev,
                        clientId: value,
                        vehicleId: "",
                      }));
                      setOpenSelectId(null);
                    }}
                    clearLabel="Limpar cliente"
                    onClear={() => {
                      setForm((prev) => ({
                        ...prev,
                        clientId: "",
                        vehicleId: "",
                      }));
                      setOpenSelectId(null);
                    }}
                  />
                  {!loadingClients && clients.length === 0 && (
                    <p className="text-xs text-muted">
                      Nenhum cliente cadastrado. Use Novo cliente para criar.
                    </p>
                  )}
                </div>
                <div className="space-y-2.5">
                  <label
                    htmlFor="agenda-vehicle"
                    className="block text-sm font-semibold text-foreground"
                  >
                    Veículo
                  </label>
                  <AgendaDropdown
                    id="agenda-vehicle"
                    value={form.vehicleId}
                    placeholder={
                      !form.clientId
                        ? "Selecione um cliente primeiro"
                        : selectedClientVehicles.length === 0
                          ? "Cliente sem veículo cadastrado"
                          : "Selecione um veículo"
                    }
                    emptyMessage={
                      !form.clientId
                        ? "Selecione um cliente primeiro."
                        : "Cliente sem veículo cadastrado."
                    }
                    options={vehicleOptions}
                    disabled={
                      !form.clientId || selectedClientVehicles.length === 0
                    }
                    open={openSelectId === "vehicle"}
                    onToggle={() =>
                      setOpenSelectId((current) =>
                        current === "vehicle" ? null : "vehicle"
                      )
                    }
                    onSelect={(value) => {
                      setForm((prev) => ({
                        ...prev,
                        vehicleId: value,
                      }));
                      setOpenSelectId(null);
                    }}
                    clearLabel="Limpar veículo"
                    onClear={() => {
                      setForm((prev) => ({
                        ...prev,
                        vehicleId: "",
                      }));
                      setOpenSelectId(null);
                    }}
                  />
                  {form.clientId && selectedClientVehicles.length === 0 && (
                    <p className="text-xs text-muted">
                      Cadastre um veículo para este cliente antes de agendar.
                    </p>
                  )}
                </div>
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                    <label className="block text-sm font-semibold text-foreground">
                      Serviços
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingService(true);
                          setOpenSelectId("service");
                          setCreatingServiceInline(false);
                        }}
                        disabled={
                          loadingServices ||
                          services.length === 0 ||
                          availableServices.length === 0
                        }
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-success/10 px-3 py-2 text-sm font-semibold text-success transition-all duration-200 hover:bg-success hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1.5 sm:text-xs"
                      >
                        <Plus size={14} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                        Adicionar serviço
                      </button>
                    </div>
                  </div>

                  <div className="min-h-[2.75rem]">
                    {selectedServices.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedServices.map((service) => (
                          <span
                            key={service.id}
                            className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success shadow-card"
                          >
                            {service.name}
                            <button
                              type="button"
                              onClick={() => removeServiceFromForm(service.id)}
                              className="rounded-full p-1 transition-colors hover:bg-success/20"
                              aria-label={`Remover ${service.name}`}
                            >
                              <X size={12} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {addingService && (
                    <AgendaDropdown
                      id="agenda-service"
                      value=""
                      placeholder={
                        loadingServices
                          ? "Carregando serviços..."
                          : availableServices.length === 0
                            ? "Todos os serviços já adicionados"
                            : "Selecione um serviço"
                      }
                      emptyMessage="Todos os serviços já foram adicionados."
                      options={availableServiceOptions}
                      disabled={loadingServices || availableServices.length === 0}
                      open={openSelectId === "service"}
                      onToggle={() =>
                        setOpenSelectId((current) =>
                          current === "service" ? null : "service"
                        )
                      }
                      onSelect={addServiceToForm}
                    />
                  )}

                  {creatingServiceInline && (
                    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">
                          Novo serviço
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setCreatingServiceInline(false);
                            setInlineServiceError(null);
                          }}
                          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                          aria-label="Cancelar"
                        >
                          <X size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-1">
                          <Input
                            label="Nome do serviço"
                            value={inlineServiceForm.name}
                            autoComplete="off"
                            onChange={(e) =>
                              setInlineServiceForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            placeholder="Ex: Cristalização"
                          />
                        </div>
                        <Input
                          label="Preço (R$)"
                          value={inlineServiceForm.price}
                          autoComplete="off"
                          onChange={(e) =>
                            setInlineServiceForm((prev) => ({
                              ...prev,
                              price: e.target.value,
                            }))
                          }
                          placeholder="150,00"
                        />
                        <div>
                          <label className="mb-1.5 block text-sm font-semibold text-foreground">
                            Duração
                          </label>
                          <select
                            value={inlineServiceForm.durationMinutes}
                            onChange={(e) =>
                              setInlineServiceForm((prev) => ({
                                ...prev,
                                durationMinutes: e.target.value,
                              }))
                            }
                            className="h-11 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-premium/40"
                          >
                            {Array.from({ length: 16 }, (_, i) => {
                              const mins = 30 + i * 30;
                              const h = Math.floor(mins / 60);
                              const m = mins % 60;
                              const label =
                                h === 0 ? "30 min" : m === 0 ? `${h}h` : `${h}h30`;
                              return (
                                <option key={mins} value={String(mins)}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                      {inlineServiceError && (
                        <p className="mt-2 text-xs font-medium text-danger">
                          {inlineServiceError}
                        </p>
                      )}
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setCreatingServiceInline(false);
                            setInlineServiceError(null);
                          }}
                          className="text-xs"
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          variant="success"
                          loading={savingInlineService}
                          onClick={() => void handleCreateInlineService()}
                          className="text-xs"
                        >
                          Criar e adicionar
                        </Button>
                      </div>
                    </div>
                  )}

                  {!loadingServices && services.length === 0 && !creatingServiceInline && (
                    <p className="text-xs text-muted">
                      Cadastre serviços na aba Serviços para usar na agenda.
                    </p>
                  )}

                  <div className="rounded-lg border border-border bg-card shadow-card px-4 py-3 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-sm font-medium text-muted">
                        Total dos serviços
                      </span>
                      <div className="min-w-0 text-right">
                        {editingTotalAmount ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-base font-bold text-foreground">
                              R$
                            </span>
                            <input
                              aria-label="Valor do agendamento"
                              type="text"
                              inputMode="decimal"
                              autoFocus
                              value={form.totalAmount}
                              onChange={(event) =>
                                setForm((prev) => ({
                                  ...prev,
                                  totalAmount: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  saveTotalAmount();
                                }
                              }}
                              className="w-[7.5rem] bg-transparent text-right text-base font-bold text-foreground outline-none placeholder:text-muted/50 focus:underline focus:decoration-success focus:underline-offset-4"
                            />
                          </div>
                        ) : (
                          <span className="text-base font-bold text-foreground">
                            {formatCurrency(displayTotalAmount)}
                          </span>
                        )}

                        <div className="mt-1 flex items-center justify-end gap-2">
                          {editingTotalAmount ? (
                            <>
                              <button
                                type="button"
                                onClick={saveTotalAmount}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-card transition-all hover:bg-emerald-700"
                              >
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={resetTotalAmountToServicesSum}
                                className="text-xs font-semibold text-muted transition-colors hover:text-foreground"
                              >
                                Usar soma
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={startEditingTotalAmount}
                              className="text-xs font-semibold text-foreground transition-colors hover:text-success"
                            >
                              Editar
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        Observação
                      </span>
                      {!form.notes.trim() && !notesPanelOpen && (
                        <button
                          type="button"
                          onClick={openNotesPanel}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted transition-all hover:border-amber-400/60 hover:bg-amber-50/60 hover:text-amber-600"
                        >
                          <Note size={13} weight="light" aria-hidden />
                          Adicionar observação
                        </button>
                      )}
                    </div>

                    {form.notes.trim() && !notesPanelOpen ? (
                      <div className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-amber-300/60 bg-amber-50/40 px-3 py-2.5">
                        <div className="flex min-w-0 items-start gap-1.5">
                          <Note
                            size={13}
                            weight="light"
                            className="mt-0.5 shrink-0 text-amber-600"
                            aria-hidden
                          />
                          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                            {form.notes}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={openNotesPanel}
                            className="text-[11px] font-semibold text-foreground transition-colors hover:text-success"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={removeNotesFromForm}
                            className="text-[11px] font-semibold text-danger transition-colors hover:text-danger/80"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    ) : notesPanelOpen ? (
                      <div className="mt-2 space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3">
                        <div className="mb-1 flex items-center gap-1.5">
                          <Note
                            size={13}
                            weight="light"
                            className="text-amber-600"
                            aria-hidden
                          />
                          <span className="text-xs font-semibold text-amber-700">
                            Observação
                          </span>
                        </div>
                        <textarea
                          id="appointment-notes"
                          rows={3}
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                          placeholder="Escreva uma observação para este agendamento..."
                          className="w-full resize-none border-0 border-b border-border bg-transparent px-0 py-1 text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-primary/40"
                        />
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={cancelNotesDraft}
                            className="text-xs font-semibold text-muted transition-colors hover:text-foreground"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={saveNotesDraft}
                            className="text-xs font-semibold text-success transition-colors hover:text-success/80"
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-foreground">
                      Horário
                    </label>
                    {(form.startTime || form.endTime) && (
                      <span className="text-xs font-medium text-success">
                        {form.startTime || "--:--"} até {form.endTime || "--:--"}
                      </span>
                    )}
                  </div>
                  <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-border bg-card p-2.5 shadow-card sm:grid-cols-4">
                    {timeSlots.map((time) => {
                      const isSelectedEndpoint =
                        form.startTime === time || form.endTime === time;
                      const isInSelectedRange =
                        !form.isMultiDay &&
                        form.startTime &&
                        form.endTime &&
                        isTimeBetween(time, form.startTime, form.endTime);
                      const occupiedCount = slotOccupancyForFormDate.get(time) ?? 0;
                      const isFull = occupiedCount >= agendaCapacity;
                      const isConflictingEndTime =
                        !!form.startTime &&
                        !form.endTime &&
                        (form.isMultiDay || timeToMinutes(time) > timeToMinutes(form.startTime)) &&
                        hasAppointmentConflict(
                          form.date,
                          form.isMultiDay ? form.endDate : form.date,
                          form.startTime,
                          time
                        );
                      const isUnavailable = isFull || isConflictingEndTime;
                      const showOccupancy = occupiedCount > 0 || isFull;

                      return (
                        <button
                          type="button"
                          key={time}
                          disabled={isUnavailable}
                          onClick={() => selectTimeSlot(time)}
                          className={`flex min-h-11 flex-col items-center justify-center rounded-full px-2 py-2 text-sm font-semibold leading-tight transition-all duration-200 sm:min-h-0 ${
                            isSelectedEndpoint
                              ? "bg-success text-white shadow-card"
                              : isInSelectedRange
                                ? "bg-success/20 text-success"
                              : isUnavailable
                                ? "cursor-not-allowed bg-muted/10 text-muted/50 line-through"
                                : "bg-background text-foreground hover:-translate-y-0.5 hover:bg-success/10 hover:text-success hover:shadow-card"
                          }`}
                        >
                          <span className={isFull ? "line-through" : ""}>{time}</span>
                          {showOccupancy && (
                            <span className="mt-0.5 text-[10px] font-bold opacity-80">
                              {isFull
                                ? `${agendaCapacity}/${agendaCapacity} lotado`
                                : `${occupiedCount}/${agendaCapacity} vagas`}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted">
                    Clique no começo e depois no final. Expediente das{" "}
                    {BUSINESS_START_TIME} às {BUSINESS_END_TIME}.
                  </p>
                </div>
                {error && <p className="text-xs text-danger">{error}</p>}
                <Button
                  type="submit"
                  variant="success"
                  disabled={savingAppointment}
                  className="w-full bg-gradient-to-r from-success to-emerald-500 text-white shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:from-success hover:to-emerald-600 hover:shadow-card-hover"
                >
                  <Check size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                  {savingAppointment
                    ? "Salvando..."
                    : editingAppointmentId
                      ? "Salvar alterações"
                      : "Salvar na agenda"}
                </Button>
              </form>
            )}

            <div className="space-y-3">
              {loadingAppointments ? (
                <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Carregando horários...
                  </p>
                </div>
              ) : selectedAppointments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Nenhum horário neste dia
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Adicione um agendamento para organizar a rotina.
                  </p>
                </div>
              ) : (
                selectedAppointmentGroups.map((group) => {
                  const occupiedCount = group.appointments.length;
                  const isGroupFull = occupiedCount >= agendaCapacity;

                  return (
                    <div key={group.time} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2">
                        <p className="text-xs font-bold uppercase tracking-widest text-muted">
                          {group.time}
                        </p>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            isGroupFull
                              ? "bg-danger/10 text-danger"
                              : "bg-success/10 text-success"
                          }`}
                        >
                          {occupiedCount}/{agendaCapacity} vagas ocupadas
                        </span>
                      </div>
                      <div className="space-y-2">
                        {group.appointments.map((appointment) => {
                          const style = getStatusStyle(appointment.status);

                          return (
                            <div
                              key={appointment.id}
                              className={`rounded-lg border border-l-4 p-4 shadow-card transition-shadow hover:shadow-card-hover ${
                                appointment.isMultiDay ? "border-dashed" : ""
                              } ${style.sideCard} ${style.sideAccent}`}
                            >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {appointment.client}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {appointment.service} • {appointment.vehicle}
                          </p>
                          {appointment.isMultiDay && (
                            <p className="mt-2 text-xs font-semibold text-primary">
                              {formatAppointmentDuration(appointment)}
                              {appointment.isContinuation ? " • continuação" : ""}
                            </p>
                          )}
                          {appointment.totalAmount > 0 && (
                            <p className="mt-2 text-xs font-semibold text-foreground">
                              Total: {formatCurrency(appointment.totalAmount)}
                            </p>
                          )}
                        </div>
                        <span
                          className={`w-fit rounded-lg px-2 py-1 text-xs font-semibold ${style.timeBadge}`}
                        >
                          {appointment.startTime} - {appointment.endTime}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => toggleStatusMenu(appointment.id)}
                            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-shadow hover:shadow-card sm:min-h-0 sm:py-1 sm:text-xs ${style.statusBadge}`}
                            aria-haspopup="menu"
                            aria-expanded={openStatusMenuId === appointment.id}
                          >
                            <AppointmentStatusLabel
                              status={appointment.status}
                              iconSize={12}
                            />
                            <CaretDown
                              size={12}
                              weight={AGENDA_ICON_WEIGHT}
                              className={`transition-transform duration-200 ${
                                openStatusMenuId === appointment.id
                                  ? "rotate-180"
                                  : ""
                              }`}
                              aria-hidden
                            />
                          </button>

                          {(openStatusMenuId === appointment.id ||
                            closingStatusMenuId === appointment.id) && (
                            <div
                              className={`absolute bottom-full left-0 z-30 mb-2 w-40 rounded-lg border border-border bg-card shadow-card p-2 shadow-lg ${
                                closingStatusMenuId === appointment.id
                                  ? "status-menu-exit"
                                  : "status-menu-enter"
                              }`}
                            >
                              {appointmentStatuses.map((status) => {
                                const optionStyle = getStatusStyle(status);

                                return (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() =>
                                      handleChangeStatus(appointment.id, status)
                                    }
                                    className={`mb-1 flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors last:mb-0 hover:bg-background sm:min-h-0 sm:text-xs ${optionStyle.statusBadge}`}
                                  >
                                    <AppointmentStatusLabel status={status} iconSize={12} />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                          <button
                            type="button"
                            onClick={() => openEditForm(appointment)}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-success/10 p-2 text-success transition-colors hover:bg-success hover:text-white sm:min-h-0 sm:min-w-0"
                            title="Editar agendamento"
                            aria-label="Editar agendamento"
                          >
                            <PencilSimple size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteAppointment(appointment)}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-danger/10 p-2 text-danger transition-colors hover:bg-danger hover:text-white sm:min-h-0 sm:min-w-0"
                            title="Excluir agendamento"
                            aria-label="Excluir agendamento"
                          >
                            <Trash size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                          </button>
                        </div>
                      </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>
        </div>
      ) : (
        <div key="agenda-service-list-panel" className="agenda-tab-panel-enter min-w-0">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Lista de serviços
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Todos os agendamentos: pendentes, confirmados, concluídos e cancelados.
                  </p>
                </div>
                <Button
                  variant="success"
                  className="shrink-0"
                  onClick={() => {
                    setFormFromServiceList(true);
                    openCreateForm();
                  }}
                >
                  <Plus size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                  Novo agendamento
                </Button>
              </div>

              {loadingAppointments ? (
                <p className="py-16 text-center text-sm text-muted">
                  Carregando serviços...
                </p>
              ) : serviceListAppointments.length === 0 ? (
                <p className="py-16 text-center text-sm font-semibold text-muted">
                  Nenhum serviço cadastrado
                </p>
              ) : (
                <div className="border-t border-border">
                  <div className="space-y-2 md:hidden">
                    {serviceListAppointments.map((appointment) => {
                      const endDate = getAppointmentEndDate(appointment);
                      const statusStyle = getStatusStyle(appointment.status);
                      const isMultiDay = endDate !== appointment.date;
                      const dateLabel = isMultiDay
                        ? `${formatShortDate(appointment.date)} - ${formatShortDate(endDate)}`
                        : formatShortDate(appointment.date);
                      const timeLabel = appointment.endTime
                        ? `${appointment.startTime} - ${appointment.endTime}`
                        : appointment.startTime;
                      const hasNotes = Boolean(appointment.notes.trim());

                      return (
                        <article
                          key={appointment.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openServiceListActionsModal(appointment)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openServiceListActionsModal(appointment); }}
                          className="cursor-pointer rounded-md bg-card/50 px-3 py-4 transition-colors hover:bg-background/70"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {appointment.client}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-muted">
                              {appointment.service}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-muted">
                              {appointment.vehicle}
                            </p>
                            {hasNotes && (
                              <AppointmentNotesRow
                                appointmentId={appointment.id}
                                notes={appointment.notes}
                                onUpdateNotes={updateAppointmentNotes}
                              />
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                            <span>{dateLabel}</span>
                            <span>{timeLabel}</span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyle.statusBadge}`}
                            >
                              <AppointmentStatusLabel
                                status={appointment.status}
                                iconSize={12}
                              />
                            </span>
                            <span
                              className={`font-bold ${
                                appointment.status === "Cancelado"
                                  ? "text-muted line-through"
                                  : "text-success"
                              }`}
                            >
                              {formatCurrency(appointment.totalAmount)}
                            </span>
                          </div>
                          <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
                            <ServiceListActions
                              appointment={appointment}
                              onEdit={openServiceListActionsModal}
                              onDelete={requestDeleteAppointment}
                              onContact={openContactModal}
                            />
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="hidden w-full overflow-x-auto md:block">
                    <div className="min-w-[800px]">
                      <div className="sticky top-0 z-10 grid grid-cols-[minmax(220px,1fr)_110px_130px_130px_36px_100px_96px] gap-4 border-b border-border bg-background px-3 py-3 text-xs font-semibold text-muted">
                        <span>Cliente / Serviço</span>
                        <span>Data</span>
                        <span>Horário</span>
                        <span>Status</span>
                        <span className="text-center">Obs</span>
                        <span className="text-right">Valor</span>
                        <span className="text-right">Ações</span>
                      </div>
                      <div className="divide-y divide-border">
                        {serviceListAppointments.map((appointment) => {
                          const endDate = getAppointmentEndDate(appointment);
                          const statusStyle = getStatusStyle(appointment.status);
                          const isMultiDay = endDate !== appointment.date;
                          const dateLabel = isMultiDay
                            ? `${formatShortDate(appointment.date)} - ${formatShortDate(endDate)}`
                            : formatShortDate(appointment.date);
                          const timeLabel = appointment.endTime
                            ? `${appointment.startTime} - ${appointment.endTime}`
                            : appointment.startTime;

                          return (
                            <article
                              key={appointment.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => openServiceListActionsModal(appointment)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openServiceListActionsModal(appointment); }}
                              className="grid cursor-pointer grid-cols-[minmax(220px,1fr)_110px_130px_130px_36px_100px_96px] items-center gap-4 px-3 py-3 transition-colors hover:bg-background/70"
                            >
                              <div className="min-w-0 self-center">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {appointment.client}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted">
                                  {appointment.service}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted">
                                  {appointment.vehicle}
                                </p>
                              </div>
                              <div className="text-sm font-medium text-foreground">
                                {dateLabel}
                              </div>
                              <div className="text-sm font-medium text-foreground">
                                {timeLabel}
                              </div>
                              <div>
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle.statusBadge}`}
                                >
                                  <AppointmentStatusLabel
                                    status={appointment.status}
                                    iconSize={12}
                                  />
                                </span>
                              </div>
                              <div className="flex justify-center">
                                <ServiceListNotesIcon
                                  appointmentId={appointment.id}
                                  notes={appointment.notes}
                                  onUpdateNotes={updateAppointmentNotes}
                                />
                              </div>
                              <div
                                className={`text-right text-sm font-bold ${
                                  appointment.status === "Cancelado"
                                    ? "text-muted line-through"
                                    : "text-success"
                                }`}
                              >
                                {formatCurrency(appointment.totalAmount)}
                              </div>
                              <div className="flex justify-end">
                                <ServiceListActions
                                  appointment={appointment}
                                  onEdit={openServiceListActionsModal}
                                  onDelete={requestDeleteAppointment}
                                  onContact={openContactModal}
                                />
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
        </div>
      )}

      {formFromServiceList && creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/40 p-4"
          onClick={closeForm}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSaveAppointment}>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="text-sm font-semibold text-foreground">Novo horário</h3>
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground"
                  aria-label="Fechar formulário"
                >
                  <X size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                </button>
              </div>

              {/* Two-column body */}
              <div className="grid grid-cols-1 gap-0 sm:grid-cols-2">
                {/* Left column — fields */}
                <div className="space-y-4 border-b border-border p-5 sm:border-b-0 sm:border-r">
                  {/* Date */}
                  <Input
                    label="Data"
                    type="date"
                    value={form.date}
                    onChange={(event) => {
                      const nextDate = event.target.value;
                      setForm((prev) => ({
                        ...prev,
                        date: nextDate,
                        endDate: prev.isMultiDay && prev.endDate >= nextDate ? prev.endDate : nextDate,
                      }));
                      if (nextDate) syncSelectedDate(nextDate);
                    }}
                  />

                  {/* Multi-day toggle */}
                  <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, isMultiDay: !prev.isMultiDay, endDate: !prev.isMultiDay ? prev.endDate || prev.date : prev.date }))}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="text-sm font-semibold text-foreground">Múltiplos dias</span>
                      <span className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${form.isMultiDay ? "bg-success" : "bg-muted/20"}`}>
                        <span className={`h-5 w-5 rounded-full bg-white shadow-card transition-transform ${form.isMultiDay ? "translate-x-4" : "translate-x-0"}`} />
                      </span>
                    </button>
                    {form.isMultiDay && (
                      <div className="mt-2.5">
                        <Input label="Data de término" type="date" min={form.date} value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} />
                      </div>
                    )}
                  </div>

                  {/* Cliente não cadastrado: agenda agora, cadastra depois */}
                  <label className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={form.preCadastro}
                      onChange={(e) => setForm((prev) => ({ ...prev, preCadastro: e.target.checked, clientId: "", vehicleId: "" }))}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span>
                      Cliente não cadastrado
                      <span className="block text-xs text-muted">Salva o horário agora. O cadastro fica pendente na tela de clientes.</span>
                    </span>
                  </label>
                  {form.preCadastro && (
                    <Input
                      label="Como identificar (opcional)"
                      value={form.preCadastroLabel}
                      onChange={(e) => setForm((prev) => ({ ...prev, preCadastroLabel: e.target.value }))}
                      placeholder="ex: João do Civic prata"
                    />
                  )}

                  {/* Cliente */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="modal-client" className="text-sm font-semibold text-foreground">Cliente</label>
                      <button type="button" onClick={() => { setOpenSelectId(null); setClientModalOpen(true); }} className="text-xs font-semibold text-success transition-colors hover:text-success/80">
                        Novo cliente
                      </button>
                    </div>
                    <AgendaDropdown
                      id="modal-client"
                      value={form.clientId}
                      placeholder={form.preCadastro ? "Pré-cadastro: criado ao salvar" : loadingClients ? "Carregando..." : "Selecione um cliente"}
                      emptyMessage="Nenhum cliente cadastrado."
                      options={clientOptions}
                      disabled={loadingClients || form.preCadastro}
                      open={openSelectId === "client"}
                      searchable
                      searchPlaceholder="Digite nome ou telefone"
                      noResultsMessage="Nenhum cliente encontrado."
                      onToggle={() => setOpenSelectId((c) => c === "client" ? null : "client")}
                      onSelect={(value) => { setForm((prev) => ({ ...prev, clientId: value, vehicleId: "" })); setOpenSelectId(null); }}
                      clearLabel="Limpar cliente"
                      onClear={() => { setForm((prev) => ({ ...prev, clientId: "", vehicleId: "" })); setOpenSelectId(null); }}
                    />
                  </div>

                  {/* Veículo */}
                  <div className="space-y-2">
                    <label htmlFor="modal-vehicle" className="text-sm font-semibold text-foreground">Veículo</label>
                    <AgendaDropdown
                      id="modal-vehicle"
                      value={form.vehicleId}
                      placeholder={!form.clientId ? "Selecione um cliente primeiro" : selectedClientVehicles.length === 0 ? "Sem veículo cadastrado" : "Selecione um veículo"}
                      emptyMessage={!form.clientId ? "Selecione um cliente primeiro." : "Sem veículo cadastrado."}
                      options={vehicleOptions}
                      disabled={!form.clientId || selectedClientVehicles.length === 0}
                      open={openSelectId === "vehicle"}
                      onToggle={() => setOpenSelectId((c) => c === "vehicle" ? null : "vehicle")}
                      onSelect={(value) => { setForm((prev) => ({ ...prev, vehicleId: value })); setOpenSelectId(null); }}
                      clearLabel="Limpar veículo"
                      onClear={() => { setForm((prev) => ({ ...prev, vehicleId: "" })); setOpenSelectId(null); }}
                    />
                  </div>

                  {/* Serviços */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-sm font-semibold text-foreground">Serviços</label>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => { setAddingService(true); setOpenSelectId("service"); setCreatingServiceInline(false); }} disabled={loadingServices || services.length === 0 || availableServices.length === 0} className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-all hover:bg-success hover:text-white disabled:opacity-50">
                          <Plus size={12} weight={AGENDA_ICON_WEIGHT} aria-hidden /> Adicionar
                        </button>
                      </div>
                    </div>
                    {selectedServices.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedServices.map((service) => (
                          <span key={service.id} className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                            {service.name}
                            <button type="button" onClick={() => removeServiceFromForm(service.id)} className="rounded-full p-0.5 transition-colors hover:bg-success/20" aria-label={`Remover ${service.name}`}>
                              <X size={10} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {addingService && (
                      <AgendaDropdown id="modal-service" value="" placeholder={availableServices.length === 0 ? "Todos adicionados" : "Selecione um serviço"} emptyMessage="Todos adicionados." options={availableServiceOptions} disabled={loadingServices || availableServices.length === 0} open={openSelectId === "service"} onToggle={() => setOpenSelectId((c) => c === "service" ? null : "service")} onSelect={addServiceToForm} />
                    )}
                    {creatingServiceInline && (
                      <div className="rounded-lg border border-border bg-background p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold text-foreground">Novo serviço</p>
                          <button type="button" onClick={() => { setCreatingServiceInline(false); setInlineServiceError(null); }} className="rounded p-1 text-muted hover:text-foreground" aria-label="Cancelar">
                            <X size={14} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Input label="Nome" value={inlineServiceForm.name} autoComplete="off" onChange={(e) => setInlineServiceForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Cristalização" />
                          <Input label="Preço (R$)" value={inlineServiceForm.price} autoComplete="off" onChange={(e) => setInlineServiceForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="150,00" />
                          <div>
                            <label className="mb-1.5 block text-sm font-semibold text-foreground">Duração</label>
                            <select value={inlineServiceForm.durationMinutes} onChange={(e) => setInlineServiceForm((prev) => ({ ...prev, durationMinutes: e.target.value }))} className="h-11 w-full rounded-md border border-border bg-input px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-premium/40">
                              {Array.from({ length: 16 }, (_, i) => { const m = 30 + i * 30; const h = Math.floor(m / 60); const r = m % 60; const l = h === 0 ? "30min" : r === 0 ? `${h}h` : `${h}h30`; return <option key={m} value={String(m)}>{l}</option>; })}
                            </select>
                          </div>
                        </div>
                        {inlineServiceError && <p className="mt-1.5 text-xs text-danger">{inlineServiceError}</p>}
                        <div className="mt-2 flex justify-end gap-2">
                          <Button type="button" variant="secondary" onClick={() => { setCreatingServiceInline(false); setInlineServiceError(null); }} className="text-xs">Cancelar</Button>
                          <Button type="button" variant="success" loading={savingInlineService} onClick={() => void handleCreateInlineService()} className="text-xs">Criar e adicionar</Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Total */}
                  <div className="rounded-lg border border-border bg-background px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-muted">Total</span>
                      <div className="text-right">
                        {editingTotalAmount ? (
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-foreground">R$</span>
                            <input aria-label="Valor" type="text" inputMode="decimal" autoFocus value={form.totalAmount} onChange={(e) => setForm((prev) => ({ ...prev, totalAmount: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveTotalAmount(); } }} className="w-24 bg-transparent text-right text-sm font-bold text-foreground outline-none focus:underline focus:decoration-success focus:underline-offset-4" />
                          </div>
                        ) : (
                          <span className="text-sm font-bold text-foreground">{formatCurrency(displayTotalAmount)}</span>
                        )}
                        <div className="mt-0.5 flex justify-end gap-2">
                          {editingTotalAmount ? (
                            <>
                              <button type="button" onClick={saveTotalAmount} className="text-xs font-semibold text-success hover:text-success/80">Salvar</button>
                              <button type="button" onClick={resetTotalAmountToServicesSum} className="text-xs font-semibold text-muted hover:text-foreground">Usar soma</button>
                            </>
                          ) : (
                            <button type="button" onClick={startEditingTotalAmount} className="text-xs font-semibold text-muted hover:text-success">Editar</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Observação */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">Observação</span>
                      {!form.notes.trim() && !notesPanelOpen && (
                        <button type="button" onClick={openNotesPanel} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted transition-all hover:border-amber-400/60 hover:bg-amber-50/60 hover:text-amber-600">
                          <Note size={12} weight="light" aria-hidden /> Adicionar
                        </button>
                      )}
                    </div>
                    {form.notes.trim() && !notesPanelOpen ? (
                      <div className="mt-1.5 flex items-start justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50/40 px-3 py-2">
                        <div className="flex min-w-0 items-start gap-1.5">
                          <Note size={12} weight="light" className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
                          <p className="whitespace-pre-wrap break-words text-xs text-foreground">{form.notes}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" onClick={openNotesPanel} className="text-[11px] font-semibold text-foreground hover:text-success">Editar</button>
                          <button type="button" onClick={removeNotesFromForm} className="text-[11px] font-semibold text-danger hover:text-danger/80">Excluir</button>
                        </div>
                      </div>
                    ) : notesPanelOpen ? (
                      <div className="mt-1.5 space-y-2 rounded-lg border border-amber-300/60 bg-amber-50/40 p-3">
                        <div className="flex items-center gap-1.5">
                          <Note size={12} weight="light" className="text-amber-600" aria-hidden />
                          <span className="text-xs font-semibold text-amber-700">Observação</span>
                        </div>
                        <textarea id="modal-appointment-notes" rows={2} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Escreva uma observação..." className="w-full resize-none border-0 border-b border-border bg-transparent px-0 py-1 text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-primary/40" />
                        <div className="flex justify-end gap-3">
                          <button type="button" onClick={cancelNotesDraft} className="text-xs font-semibold text-muted hover:text-foreground">Cancelar</button>
                          <button type="button" onClick={saveNotesDraft} className="text-xs font-semibold text-success hover:text-success/80">Salvar</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Right column — horário + save */}
                <div className="flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-foreground">Horário</label>
                    {(form.startTime || form.endTime) && (
                      <span className="text-xs font-medium text-success">{form.startTime || "--:--"} – {form.endTime || "--:--"}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-border bg-background p-2">
                    {timeSlots.map((time) => {
                      const isSelectedEndpoint = form.startTime === time || form.endTime === time;
                      const isInSelectedRange = !form.isMultiDay && form.startTime && form.endTime && isTimeBetween(time, form.startTime, form.endTime);
                      const occupiedCount = slotOccupancyForFormDate.get(time) ?? 0;
                      const isFull = occupiedCount >= agendaCapacity;
                      const isConflictingEndTime = !!form.startTime && !form.endTime && (form.isMultiDay || timeToMinutes(time) > timeToMinutes(form.startTime)) && hasAppointmentConflict(form.date, form.isMultiDay ? form.endDate : form.date, form.startTime, time);
                      const isUnavailable = isFull || isConflictingEndTime;
                      return (
                        <button
                          type="button"
                          key={time}
                          disabled={isUnavailable}
                          onClick={() => selectTimeSlot(time)}
                          className={`flex flex-col items-center justify-center rounded-full py-1.5 text-xs font-semibold leading-tight transition-all duration-150 ${
                            isSelectedEndpoint ? "bg-success text-white shadow-card"
                              : isInSelectedRange ? "bg-success/20 text-success"
                              : isUnavailable ? "cursor-not-allowed bg-muted/10 text-muted/40 line-through"
                              : "bg-card text-foreground hover:bg-success/10 hover:text-success"
                          }`}
                        >
                          {time}
                          {(occupiedCount > 0 || isFull) && (
                            <span className="text-[9px] font-bold opacity-70">{isFull ? "lotado" : `${occupiedCount}/${agendaCapacity}`}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted">Clique no início e depois no fim. Expediente das {BUSINESS_START_TIME} às {BUSINESS_END_TIME}.</p>
                  <div className="mt-auto space-y-2 pt-2">
                    {error && <p className="text-xs text-danger">{error}</p>}
                    <Button
                      type="submit"
                      variant="success"
                      disabled={savingAppointment}
                      className="w-full bg-gradient-to-r from-success to-emerald-500 text-white shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:from-success hover:to-emerald-600 hover:shadow-card-hover"
                    >
                      <Check size={16} weight={AGENDA_ICON_WEIGHT} aria-hidden />
                      {savingAppointment ? "Salvando..." : "Salvar na agenda"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <ClientFormModal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        onSave={handleCreateClient}
      />
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .agenda-tab-panel-enter {
            animation: agenda-tab-panel-enter 180ms ease-out both;
          }

          .agenda-form-enter {
            animation: agenda-form-enter 220ms ease-out both;
          }

          .agenda-form-exit {
            animation: agenda-form-exit 180ms ease-in both;
          }

          .agenda-notes-panel-enter {
            animation: agenda-notes-panel-enter 220ms ease-out both;
          }

          .timeline-track-loading::after {
            animation: timeline-track-loading 900ms ease-out both;
          }

          .timeline-block-loading {
            animation: timeline-block-loading 620ms ease-out both;
            transform-origin: left center;
          }

          .status-menu-enter {
            animation: status-menu-enter 180ms ease-out both;
            transform-origin: bottom left;
          }

          .status-menu-exit {
            animation: status-menu-exit 160ms ease-in both;
            transform-origin: bottom left;
          }
        }

        .timeline-track-loading::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.45),
            transparent
          );
          transform: translateX(-100%);
        }

        .timeline-service-hover {
          transition:
            filter 180ms ease,
            box-shadow 180ms ease,
            transform 180ms ease;
          transform: perspective(700px) translateY(0) translateZ(0) rotateX(0);
          transform-origin: center bottom;
        }

        .timeline-service-hover:hover,
        .timeline-service-hover:focus-visible {
          z-index: 10;
          filter: brightness(1.12) saturate(1.18);
          transform: perspective(700px) translateY(-2px) translateZ(18px) rotateX(10deg);
          box-shadow:
            0 12px 24px rgba(15, 23, 42, 0.24),
            inset 0 1px 0 rgba(255, 255, 255, 0.28);
        }

        .calendar-appointment-pill {
          display: inline-block;
          max-width: 5.75rem;
          width: auto;
          border-radius: 4px;
          padding: 3px 7px;
          font-size: 9px;
          line-height: 12px;
          letter-spacing: 0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border: 1px solid transparent;
        }

        .calendar-pill-label {
          font-weight: 700;
        }

        .status-pill-confirmed {
          background: #dce8f5;
          color: #1a3a6b;
          border-color: #7aaee0;
        }

        .status-pill-pending {
          background: #fdf0d5;
          color: #8a5f0a;
          border-color: #f0c060;
        }

        .status-pill-cancelled {
          background: #fde8e8;
          color: #8a2020;
          border-color: #f0a0a0;
        }

        .status-pill-completed {
          background: #d1e8d1;
          color: #2d6a2d;
          border-color: #a8d5a8;
        }

        .calendar-multiday-pill {
          border-style: dashed;
          max-width: 100%;
          width: calc(100% + 0.5rem);
        }

        .calendar-multiday-start {
          border-top-right-radius: 0.25rem;
          border-bottom-right-radius: 0.25rem;
        }

        .calendar-multiday-middle {
          margin-left: -0.25rem;
          border-radius: 0.25rem;
        }

        .calendar-multiday-end {
          margin-left: -0.25rem;
          width: 100%;
          border-top-left-radius: 0.25rem;
          border-bottom-left-radius: 0.25rem;
        }

        .calendar-more-pill {
          max-width: 4.5rem;
          background: #e8e6e1;
          color: #5a5550;
          border-color: #c8c4be;
        }

        .status-confirmed-soft {
          background: rgba(37, 99, 235, 0.14);
          color: #2563eb;
        }

        .status-confirmed-solid {
          background: #2563eb;
        }

        .status-confirmed-card {
          border-color: rgba(37, 99, 235, 0.22);
          background: rgba(37, 99, 235, 0.07);
        }

        .status-confirmed-side-accent {
          border-left-color: #2563eb;
        }

        .status-completed-soft {
          background: rgba(5, 150, 105, 0.12);
          color: #047857;
        }

        .status-completed-solid {
          background: #059669;
        }

        .status-completed-card {
          border-color: rgba(5, 150, 105, 0.24);
          background: rgba(5, 150, 105, 0.08);
        }

        .status-completed-side-accent {
          border-left-color: #059669;
        }

        @keyframes agenda-tab-panel-enter {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes agenda-form-enter {
          from {
            opacity: 0;
            transform: translateY(-10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes agenda-form-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
          }
        }

        @keyframes agenda-notes-panel-enter {
          from {
            opacity: 0;
            transform: translateX(16px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes timeline-track-loading {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(100%);
          }
        }

        @keyframes timeline-block-loading {
          from {
            opacity: 0.2;
            transform: scaleX(0);
          }
          to {
            opacity: 1;
            transform: scaleX(1);
          }
        }

        @keyframes status-menu-enter {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes status-menu-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(8px) scale(0.96);
          }
        }
      `}</style>

      {serviceListActionsAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={() => setServiceListActionsAppointment(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1 pr-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Agendamento
                </p>
                <h3 className="mt-1 text-base font-bold text-foreground">
                  {serviceListActionsAppointment.client}
                </h3>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Serviço</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {serviceListActionsAppointment.service}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Veículo</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {serviceListActionsAppointment.vehicle}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Data</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {formatShortDate(serviceListActionsAppointment.date)}
                      {(() => {
                        const endDate = getAppointmentEndDate(serviceListActionsAppointment);
                        return endDate !== serviceListActionsAppointment.date
                          ? ` – ${formatShortDate(endDate)}`
                          : "";
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Horário</p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {serviceListActionsAppointment.endTime
                        ? `${serviceListActionsAppointment.startTime} – ${serviceListActionsAppointment.endTime}`
                        : serviceListActionsAppointment.startTime}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Valor</p>
                    <p className={`mt-0.5 text-sm font-bold ${
                      serviceListActionsAppointment.status === "Concluído"
                        ? "text-success"
                        : serviceListActionsAppointment.status === "Cancelado"
                          ? "text-muted line-through"
                          : "text-foreground"
                    }`}>
                      {formatCurrency(serviceListActionsAppointment.totalAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Status</p>
                    <div className="mt-0.5">
                      {(() => {
                        const style = getStatusStyle(serviceListActionsAppointment.status);
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.statusBadge}`}>
                            <AppointmentStatusLabel status={serviceListActionsAppointment.status} iconSize={11} />
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {serviceListActionsAppointment.notes.trim() && (
                  <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Observações</p>
                    <p className="mt-1 text-xs leading-relaxed text-foreground">
                      {serviceListActionsAppointment.notes}
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setServiceListActionsAppointment(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
              >
                <X size={16} weight="light" aria-hidden />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <p className="mb-2 text-xs font-semibold text-muted">Alterar status</p>
                <div className="grid grid-cols-2 gap-2">
                  {appointmentStatuses.map((status) => {
                    const optionStyle = getStatusStyle(status);
                    const isCurrent =
                      serviceListActionsAppointment.status === status;

                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          void handleChangeStatus(
                            serviceListActionsAppointment.id,
                            status
                          );
                          setServiceListActionsAppointment(null);
                        }}
                        className={`flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          isCurrent
                            ? `${optionStyle.statusBadge} border-transparent ring-2 ring-primary/20`
                            : `${optionStyle.statusBadge} border-transparent opacity-80 hover:opacity-100`
                        }`}
                      >
                        <AppointmentStatusLabel status={status} iconSize={12} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted">Ações</p>

                <button
                  type="button"
                  onClick={() => {
                    openEditFromServiceList(serviceListActionsAppointment);
                    setServiceListActionsAppointment(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-success/40 hover:bg-success/5"
                >
                  <PencilSimple
                    size={14}
                    weight="light"
                    className="shrink-0 text-success"
                    aria-hidden
                  />
                  <div>
                    <span className="text-sm font-semibold text-foreground">
                      Editar horário e serviços
                    </span>
                    <p className="mt-0.5 text-xs text-muted">
                      Abrir formulário completo na agenda
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    openContactModal(serviceListActionsAppointment);
                    setServiceListActionsAppointment(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-emerald-400/60 hover:bg-emerald-50/40"
                >
                  <WhatsappLogo
                    size={14}
                    weight="light"
                    className="shrink-0 text-emerald-600"
                    aria-hidden
                  />
                  <div>
                    <span className="text-sm font-semibold text-foreground">
                      Contato via WhatsApp
                    </span>
                    <p className="mt-0.5 text-xs text-muted">
                      Enviar mensagem com template pronto
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    requestDeleteAppointment(serviceListActionsAppointment);
                    setServiceListActionsAppointment(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-left transition-colors hover:border-danger/40 hover:bg-danger/10"
                >
                  <Trash
                    size={14}
                    weight="light"
                    className="shrink-0 text-danger"
                    aria-hidden
                  />
                  <div>
                    <span className="text-sm font-semibold text-danger">
                      Excluir agendamento
                    </span>
                    <p className="mt-0.5 text-xs text-muted">
                      Remover este horário permanentemente
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {contactAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                  WhatsApp
                </p>
                <h3 className="mt-0.5 text-sm font-bold text-foreground">
                  {contactAppointment.client}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setContactAppointment(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-foreground"
              >
                <X size={16} weight="light" aria-hidden />
              </button>
            </div>

            <div className="space-y-2 p-4">
              <p className="mb-3 text-xs font-semibold text-muted">
                Escolha a mensagem:
              </p>

              {[
                {
                  key: "concluido",
                  label: "✅ Serviço concluído",
                  description: "Avisar que o veículo está pronto para retirada",
                },
                {
                  key: "confirmar",
                  label: "📅 Confirmar agendamento",
                  description: "Pedir confirmação do horário marcado",
                },
                {
                  key: "lembrete",
                  label: "🔔 Lembrete de amanhã",
                  description: "Lembrar o cliente do agendamento do dia seguinte",
                },
                {
                  key: "orcamento",
                  label: "💬 Atualização de orçamento",
                  description: "Informar sobre orçamento ou detalhes do serviço",
                },
              ].map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => openWhatsApp(contactAppointment, template.key)}
                  className="flex w-full flex-col items-start rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-emerald-400/60 hover:bg-emerald-50/40"
                >
                  <span className="text-sm font-semibold text-foreground">
                    {template.label}
                  </span>
                  <span className="mt-0.5 text-xs text-muted">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm?.type === "appointment"}
        title="Excluir agendamento"
        description={
          deleteConfirm?.type === "appointment"
            ? `Deseja excluir o horário de ${deleteConfirm.appointment.client}?`
            : ""
        }
        confirmLabel="Excluir agendamento"
        loading={deletingAppointments}
        onCancel={() => {
          if (!deletingAppointments) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (deleteConfirm?.type === "appointment") {
            void executeDeleteAppointment(deleteConfirm.appointment);
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm?.type === "clearDay"}
        title="Excluir agendamentos do dia"
        description="Deseja excluir todos os horários deste dia?"
        confirmLabel="Excluir todos"
        loading={deletingAppointments}
        onCancel={() => {
          if (!deletingAppointments) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          void executeClearSelectedDay();
        }}
      />
    </>
  );
}
