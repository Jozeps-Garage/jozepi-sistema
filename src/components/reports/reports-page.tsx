"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  CaretUp,
  CaretUpDown,
  CurrencyDollar,
  FilePdf,
  FileXls,
  IdentificationCard,
  Receipt,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { formatCurrency } from "@/lib/utils/format";
import { DEFAULT_TIME_ZONE, wallClockInTimeZone } from "@/lib/timezone";
import {
  dateKey,
  formatShortDate,
  getReportRange,
  isDateInRange,
  startOfMonth,
  type ReportPeriod,
} from "@/lib/reports/date-range";
import { buildTransactionRows, fetchReportsSourceData, sumReportAmount } from "@/lib/reports/data";
import type {
  ReportClient,
  ReportExpenseEntry,
  ReportRevenueEntry,
  ReportTransactionType,
  WorkshopInfo,
} from "@/lib/reports/types";
import { buildListExportPayload, buildReceiptPayload } from "@/lib/reports/export-data";
import { exportReceiptToPdf } from "@/lib/reports/export-pdf";
import { exportReportsToExcel } from "@/lib/reports/export-excel";
import { formatSequentialNumber } from "@/lib/reports/sequential-number";

const REPORT_ICON_WEIGHT = "light" as const;
const CLIENT_FILTER_ALL = "all";

type ReportSortColumn = "number" | "date" | "client" | "value";
type ReportSortDirection = "asc" | "desc";

const REPORTS_TABLE_GRID_TEMPLATE =
  "40px 72px 100px minmax(140px, 1fr) minmax(170px, 1.5fr) 130px 120px";

const periodOptions: { value: ReportPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "lastMonth", label: "Mês passado" },
  { value: "allTime", label: "Período total" },
  { value: "custom", label: "Personalizado" },
];

const typeFilterOptions: {
  value: ReportTransactionType;
  label: string;
  dotClass: string;
}[] = [
  { value: "receita", label: "Receita", dotClass: "bg-success" },
  { value: "despesa", label: "Despesa", dotClass: "bg-danger" },
];

const typeBadgeClasses: Record<ReportTransactionType, string> = {
  receita: "bg-success/10 text-success",
  despesa: "bg-danger/10 text-danger",
};

const typeBadgeLabels: Record<ReportTransactionType, string> = {
  receita: "Receita",
  despesa: "Despesa",
};

function getPeriodLabel(period: ReportPeriod, start: string, end: string): string {
  if (period === "today") return `Hoje (${formatShortDate(start)})`;
  if (period === "week") return `Esta semana (${formatShortDate(start)} a ${formatShortDate(end)})`;
  if (period === "month") return `Este mês (${formatShortDate(start)} a ${formatShortDate(end)})`;
  if (period === "lastMonth")
    return `Mês passado (${formatShortDate(start)} a ${formatShortDate(end)})`;
  if (period === "allTime") return `Período total (até ${formatShortDate(end)})`;
  return `${formatShortDate(start)} a ${formatShortDate(end)}`;
}

function MiniStat({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "default" | "success" | "danger";
}) {
  const valueClass =
    tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "";

  return (
    <div className="card-surface">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <p className="label-caps">{label}</p>
      </div>
      <p className={`currency-display ${valueClass}`}>{value}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: ReportTransactionType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeBadgeClasses[type]}`}
    >
      {typeBadgeLabels[type]}
    </span>
  );
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
  column: ReportSortColumn;
  activeColumn: ReportSortColumn;
  direction: ReportSortDirection;
  onSort: (column: ReportSortColumn) => void;
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
          <CaretUp size={12} weight={REPORT_ICON_WEIGHT} aria-hidden />
        ) : (
          <CaretDown size={12} weight={REPORT_ICON_WEIGHT} aria-hidden />
        )
      ) : (
        <CaretUpDown size={12} weight={REPORT_ICON_WEIGHT} className="opacity-40" aria-hidden />
      )}
    </button>
  );
}

const EMPTY_WORKSHOP: WorkshopInfo = {
  name: "Jozep's Garage",
  document: null,
  phone: null,
  address: null,
  logoUrl: null,
  timezone: DEFAULT_TIME_ZONE,
};

export function ReportsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workshop, setWorkshop] = useState<WorkshopInfo>(EMPTY_WORKSHOP);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [clients, setClients] = useState<ReportClient[]>([]);
  const [revenueEntries, setRevenueEntries] = useState<ReportRevenueEntry[]>([]);
  const [expenseEntries, setExpenseEntries] = useState<ReportExpenseEntry[]>([]);

  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [customStart, setCustomStart] = useState(dateKey(startOfMonth(new Date())));
  const [customEnd, setCustomEnd] = useState(dateKey(new Date()));
  const [clientFilter, setClientFilter] = useState(CLIENT_FILTER_ALL);
  const [typeFilter, setTypeFilter] = useState<Set<ReportTransactionType>>(
    () => new Set(["receita", "despesa"])
  );

  const [sortColumn, setSortColumn] = useState<ReportSortColumn>("date");
  const [sortDirection, setSortDirection] = useState<ReportSortDirection>("desc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { workshopId, error: profileError } = await fetchOwnWorkshop(supabase);

    if (profileError || !workshopId) {
      setError(profileError?.message ?? "Oficina não encontrada.");
      setLoading(false);
      return;
    }

    try {
      const source = await fetchReportsSourceData(workshopId);
      setWorkshop(source.workshop);
      setClients(source.clients);
      setRevenueEntries(source.revenueEntries);
      setExpenseEntries(source.expenseEntries);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar os relatórios."
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  const range = useMemo(
    () =>
      getReportRange(
        period,
        customStart,
        customEnd,
        wallClockInTimeZone(new Date(), workshop.timezone)
      ),
    [period, customStart, customEnd, workshop.timezone]
  );

  const periodLabel = useMemo(
    () => getPeriodLabel(period, dateKey(range.start), dateKey(range.end)),
    [period, range]
  );

  const selectedClient = clients.find((client) => client.id === clientFilter) ?? null;
  const clientLabel = selectedClient?.name ?? "Todos os clientes";

  const clientFilterOptions = useMemo(
    () => [
      { value: CLIENT_FILTER_ALL, label: "Todos os clientes" },
      ...clients.map((client) => ({ value: client.id, label: client.name })),
    ],
    [clients]
  );

  const allRows = useMemo(
    () => buildTransactionRows({ revenueEntries, expenseEntries }),
    [revenueEntries, expenseEntries]
  );

  const filteredRows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          isDateInRange(row.date, range) &&
          typeFilter.has(row.type) &&
          (clientFilter === CLIENT_FILTER_ALL || row.clientId === clientFilter)
      ),
    [allRows, range, typeFilter, clientFilter]
  );

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      let comparison = 0;
      if (sortColumn === "number")
        comparison = (a.sequentialNumber ?? 0) - (b.sequentialNumber ?? 0);
      else if (sortColumn === "date") comparison = a.date.localeCompare(b.date);
      else if (sortColumn === "client") comparison = a.clientName.localeCompare(b.clientName);
      else comparison = a.amount - b.amount;

      return sortDirection === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [filteredRows, sortColumn, sortDirection]);

  const total = useMemo(() => sumReportAmount(filteredRows), [filteredRows]);

  const selectedRows = useMemo(
    () => sortedRows.filter((row) => selectedIds.has(row.id)),
    [sortedRows, selectedIds]
  );

  const selectedTotal = useMemo(() => sumReportAmount(selectedRows), [selectedRows]);

  const allVisibleSelected = sortedRows.length > 0 && selectedRows.length === sortedRows.length;

  function handleSort(column: ReportSortColumn) {
    if (column === sortColumn) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection(column === "date" || column === "number" ? "desc" : "asc");
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(() => {
      if (allVisibleSelected) return new Set();
      return new Set(sortedRows.map((row) => row.id));
    });
  }

  function toggleType(type: ReportTransactionType) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setSelectedIds(new Set());
  }

  function handlePeriodChange(nextPeriod: ReportPeriod) {
    setPeriod(nextPeriod);
    setSelectedIds(new Set());
  }

  function handleCustomStartChange(value: string) {
    setCustomStart(value);
    setSelectedIds(new Set());
  }

  function handleCustomEndChange(value: string) {
    setCustomEnd(value);
    setSelectedIds(new Set());
  }

  function handleClientFilterChange(value: string) {
    setClientFilter(value);
    setSelectedIds(new Set());
  }

  async function exportReceiptPdf(
    rows: typeof filteredRows,
    nextClientLabel: string
  ) {
    setExportingPdf(true);
    setExportError(null);

    try {
      const payload = buildReceiptPayload({
        rows,
        clients,
        workshop,
        periodLabel,
        clientLabel: nextClientLabel,
      });
      await exportReceiptToPdf(payload);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Não foi possível gerar o comprovante."
      );
    } finally {
      setExportingPdf(false);
    }
  }

  function handleExportExcel() {
    const payload = buildListExportPayload({
      rows: filteredRows,
      workshop,
      periodLabel,
      clientLabel,
    });
    exportReportsToExcel(payload);
  }

  async function handleExportPdf() {
    await exportReceiptPdf(filteredRows, clientLabel);
  }

  async function handleExportSelectedPdf() {
    if (selectedRows.length === 0) return;
    await exportReceiptPdf(selectedRows, "Itens selecionados");
  }

  async function handleExportClientPdf() {
    if (!selectedClient) return;
    await exportReceiptPdf(filteredRows, selectedClient.name);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-16 text-center text-sm text-muted shadow-card">
        Carregando relatórios...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-6 text-sm text-danger shadow-card">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="card-surface space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="label-caps">Período</p>
            <div className="flex flex-wrap gap-2">
              {periodOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handlePeriodChange(option.value)}
                  className={`min-h-9 shrink-0 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold transition-all ${
                    period === option.value
                      ? "border-primary bg-primary text-white shadow-card"
                      : "border-border bg-card text-muted hover:bg-background hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="flex flex-wrap gap-3 pt-1">
                <Input
                  label="Início"
                  type="date"
                  value={customStart}
                  onChange={(event) => handleCustomStartChange(event.target.value)}
                  className="w-40"
                />
                <Input
                  label="Fim"
                  type="date"
                  value={customEnd}
                  onChange={(event) => handleCustomEndChange(event.target.value)}
                  className="w-40"
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              loading={exportingPdf}
              className="gap-2"
            >
              <FilePdf size={18} weight={REPORT_ICON_WEIGHT} aria-hidden />
              Exportar PDF
            </Button>
            <Button type="button" variant="secondary" onClick={handleExportExcel} className="gap-2">
              <FileXls size={18} weight={REPORT_ICON_WEIGHT} aria-hidden />
              Exportar Excel
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <Dropdown
              label="Cliente"
              value={clientFilter}
              options={clientFilterOptions}
              onChange={handleClientFilterChange}
              searchable
              searchPlaceholder="Buscar cliente..."
              className="min-w-[14rem] flex-1"
            />

            <div className="space-y-1.5">
              <p className="label-caps">Tipo de lançamento</p>
              <div className="flex flex-wrap gap-3 pt-0.5">
                {typeFilterOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <input
                      type="checkbox"
                      checked={typeFilter.has(option.value)}
                      onChange={() => toggleType(option.value)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className={`h-2 w-2 rounded-full ${option.dotClass}`} aria-hidden />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {selectedClient && (
            <button
              type="button"
              onClick={handleExportClientPdf}
              disabled={exportingPdf}
              className="flex min-h-11 items-center gap-2.5 rounded-lg border border-premium/30 bg-premium/10 px-4 py-2.5 text-sm font-semibold text-premium transition-colors hover:bg-premium/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IdentificationCard size={18} weight={REPORT_ICON_WEIGHT} aria-hidden />
              Exportar comprovante completo de {selectedClient.name}
            </button>
          )}
        </div>
      </div>

      {exportError && (
        <p className="rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {exportError}
        </p>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MiniStat
          label={
            filteredRows.some((row) => row.type === "receita") &&
            filteredRows.some((row) => row.type === "despesa")
              ? "Resultado no período"
              : "Total no período"
          }
          value={formatCurrency(total)}
          icon={
            <CurrencyDollar
              size={16}
              weight={REPORT_ICON_WEIGHT}
              className={total < 0 ? "text-danger" : "text-success"}
            />
          }
          tone={total < 0 ? "danger" : "success"}
        />
        <MiniStat
          label="Lançamentos no período"
          value={String(filteredRows.length)}
          icon={<Receipt size={16} weight={REPORT_ICON_WEIGHT} className="text-muted" />}
        />
      </div>

      {/* Barra de ações da seleção */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary px-4 py-3 text-white shadow-card">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold">
              {selectedIds.size} {selectedIds.size === 1 ? "selecionado" : "selecionados"}
            </span>
            <span className="text-white/80">
              Total selecionado:{" "}
              <span className="font-bold text-white">{formatCurrency(selectedTotal)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              Limpar seleção
            </button>
            <Button
              type="button"
              variant="success"
              onClick={handleExportSelectedPdf}
              disabled={exportingPdf}
              loading={exportingPdf}
              className="gap-2"
            >
              <FilePdf size={18} weight={REPORT_ICON_WEIGHT} aria-hidden />
              Exportar selecionados (PDF)
            </Button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="card-surface overflow-x-auto">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Lançamentos</h2>

        {sortedRows.length === 0 ? (
          <p className="text-sm text-muted">Nenhum lançamento no período/filtro selecionado.</p>
        ) : (
          <div className="min-w-[840px]">
            <div
              className="grid items-center gap-3 border-b border-border pb-2"
              style={{ gridTemplateColumns: REPORTS_TABLE_GRID_TEMPLATE }}
            >
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 accent-primary"
                aria-label="Selecionar todos"
              />
              <SortableColumnHeader
                label="Nº"
                column="number"
                activeColumn={sortColumn}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortableColumnHeader
                label="Data"
                column="date"
                activeColumn={sortColumn}
                direction={sortDirection}
                onSort={handleSort}
              />
              <SortableColumnHeader
                label="Cliente"
                column="client"
                activeColumn={sortColumn}
                direction={sortDirection}
                onSort={handleSort}
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Serviço
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Categoria
              </span>
              <SortableColumnHeader
                label="Valor"
                column="value"
                activeColumn={sortColumn}
                direction={sortDirection}
                onSort={handleSort}
                align="right"
              />
            </div>

            <div className="divide-y divide-border">
              {sortedRows.map((row) => (
                <div
                  key={row.id}
                  className={`grid items-center gap-3 py-2.5 transition-colors hover:bg-background ${
                    selectedIds.has(row.id) ? "bg-premium/5" : ""
                  }`}
                  style={{ gridTemplateColumns: REPORTS_TABLE_GRID_TEMPLATE }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    className="h-4 w-4 accent-primary"
                    aria-label={`Selecionar lançamento de ${row.clientName}`}
                  />
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatSequentialNumber(row.type, row.sequentialNumber)}
                  </span>
                  <span className="text-sm text-muted">{formatShortDate(row.date)}</span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {row.clientName}
                  </span>
                  <span className="flex items-center gap-2 truncate text-sm text-foreground">
                    <TypeBadge type={row.type} />
                    <span className="truncate">{row.description}</span>
                  </span>
                  <span className="truncate text-sm text-muted">{row.category}</span>
                  <span
                    className={`text-right text-sm font-semibold ${
                      row.type === "despesa" ? "text-danger" : "text-success"
                    }`}
                  >
                    {formatCurrency(row.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
