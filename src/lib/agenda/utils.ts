import type {
  Appointment,
  AppointmentOrderRow,
  AppointmentOrderService,
  AgendaService,
  AppointmentStatus,
  ServiceOrderStatus,
} from "./types";
import {
  DEFAULT_AGENDA_CAPACITY,
  AGENDA_STORAGE_KEY,
  AGENDA_CAPACITY_STORAGE_KEY,
  BUSINESS_START_TIME,
  BUSINESS_END_TIME,
} from "./constants";

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isTimeBetween(time: string, startTime: string, endTime: string) {
  const current = timeToMinutes(time);
  return current > timeToMinutes(startTime) && current < timeToMinutes(endTime);
}

export function isTimeInRange(time: string, startTime: string, endTime: string) {
  const current = timeToMinutes(time);
  return current >= timeToMinutes(startTime) && current < timeToMinutes(endTime);
}

export function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
) {
  return timeToMinutes(startA) < timeToMinutes(endB) &&
    timeToMinutes(endA) > timeToMinutes(startB);
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function parseLocalDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

export function addDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function getDateRangeKeys(startDate: string, endDate: string) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  if (end < start) return [startDate];

  const keys: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    keys.push(dateKey(day));
  }

  return keys;
}

export function getAppointmentEndDate(appointment: Pick<Appointment, "date" | "endDate">) {
  return appointment.endDate || appointment.date;
}

export function getAppointmentDurationDays(
  appointment: Pick<Appointment, "date" | "endDate">
) {
  return getDateRangeKeys(appointment.date, getAppointmentEndDate(appointment)).length;
}

export function appointmentOccursOnDate(
  appointment: Pick<Appointment, "date" | "endDate">,
  date: string
) {
  return appointment.date <= date && date <= getAppointmentEndDate(appointment);
}

/**
 * Resolves the effective start/end time-of-day for a specific `date` inside a
 * (possibly multi-day) period. Multi-day appointments are a single continuous
 * span: the start time only applies to the first day, the end time only
 * applies to the last day, and every day in between is fully occupied.
 */
export function getDailyTimeWindow(
  date: string,
  rangeStartDate: string,
  rangeEndDate: string,
  startTime: string,
  endTime: string
): [string, string] {
  if (rangeStartDate === rangeEndDate) return [startTime, endTime];
  if (date === rangeStartDate) return [startTime, BUSINESS_END_TIME];
  if (date === rangeEndDate) return [BUSINESS_START_TIME, endTime];

  return [BUSINESS_START_TIME, BUSINESS_END_TIME];
}

export function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(parseLocalDate(date));
}

export function formatAppointmentDuration(appointment: Pick<Appointment, "date" | "endDate">) {
  const durationDays = getAppointmentDurationDays(appointment);
  const endDate = getAppointmentEndDate(appointment);

  if (durationDays <= 1) return "1 dia";

  return `${durationDays} dias • ${formatShortDate(appointment.date)} a ${formatShortDate(endDate)}`;
}

export function isAppointmentPast(appointment: Appointment, now: Date) {
  return new Date(`${getAppointmentEndDate(appointment)}T${appointment.endTime}:00`) <= now;
}

export function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getShortClientName(name: string) {
  const [firstName, secondName] = name.trim().split(/\s+/);
  return [firstName, secondName].filter(Boolean).join(" ");
}

export function getServicePrice(service: AgendaService) {
  return Number(service.price) || 0;
}

export function parseAppointmentAmount(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);

  if (!value.trim() || !Number.isFinite(amount) || amount < 0) {
    throw new Error("Informe um valor válido para o total.");
  }

  return amount;
}

export function calculateServicesTotal(
  serviceIds: string[],
  catalogServices: AgendaService[],
  priceOverrides?: Record<string, number>
) {
  return serviceIds.reduce((total, serviceId) => {
    const override = priceOverrides?.[serviceId];
    if (override != null) return total + override;
    const service = catalogServices.find((item) => item.id === serviceId);
    return total + (service ? getServicePrice(service) : 0);
  }, 0);
}

export function servicePricesFromOrderItems(
  items: Array<{ service_id: string; unit_price: number | string | null }>
) {
  const prices: Record<string, number> = {};
  for (const item of items) {
    const unit = Number(item.unit_price);
    if (Number.isFinite(unit) && unit > 0) {
      prices[item.service_id] = unit;
    }
  }
  return prices;
}

export function isCustomAppointmentTotal(
  appointment: Appointment,
  catalogServices: AgendaService[]
) {
  if (appointment.totalAmount <= 0) return false;

  const servicesTotal = calculateServicesTotal(
    appointment.serviceIds,
    catalogServices,
    appointment.servicePrices
  );

  return Math.abs(appointment.totalAmount - servicesTotal) > 0.009;
}

export function buildServiceOrderItems(
  selectedServices: AgendaService[],
  appointmentTotal: number,
  priceOverrides?: Record<string, number>
) {
  const hasOverrides = Boolean(
    priceOverrides && Object.keys(priceOverrides).length > 0
  );
  const linePrices = selectedServices.map((service) => ({
    service,
    price: priceOverrides?.[service.id] ?? getServicePrice(service),
  }));
  const linesTotal = linePrices.reduce((total, item) => total + item.price, 0);

  if (hasOverrides) {
    return linePrices.map((item) => ({
      service_id: item.service.id,
      quantity: 1,
      unit_price: item.price,
    }));
  }

  if (
    selectedServices.length === 0 ||
    linesTotal <= 0 ||
    Math.abs(appointmentTotal - linesTotal) <= 0.009
  ) {
    return selectedServices.map((service) => ({
      service_id: service.id,
      quantity: 1,
      unit_price: getServicePrice(service),
    }));
  }

  let assignedTotal = 0;

  return selectedServices.map((service, index) => {
    if (index === selectedServices.length - 1) {
      return {
        service_id: service.id,
        quantity: 1,
        unit_price: Math.round((appointmentTotal - assignedTotal) * 100) / 100,
      };
    }

    const share =
      Math.round(
        (getServicePrice(service) / linesTotal) * appointmentTotal * 100
      ) / 100;
    assignedTotal += share;

    return {
      service_id: service.id,
      quantity: 1,
      unit_price: share,
    };
  });
}

export function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeDbTime(value: string | null) {
  return value?.slice(0, 5) ?? "";
}

export function getAppointmentStatus(status: ServiceOrderStatus | string): AppointmentStatus {
  if (status === "em_andamento") return "Confirmado";
  if (status === "finalizada") return "Concluído";
  if (status === "cancelada") return "Cancelado";

  return "Pendente";
}

export function getServiceOrderStatus(status: AppointmentStatus): ServiceOrderStatus {
  if (status === "Confirmado") return "em_andamento";
  if (status === "Concluído") return "finalizada";
  if (status === "Cancelado") return "cancelada";

  return "aberta";
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function isMissingAgendaMigrationError(err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message?: unknown }).message)
        : String(err);

  return (
    message.includes("scheduled_date") ||
    message.includes("scheduled_end_date") ||
    message.includes("scheduled_start") ||
    message.includes("scheduled_end") ||
    message.includes("schema cache")
  );
}

export function isMissingAgendaCapacityError(err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message?: unknown }).message)
        : String(err);

  return (
    message.includes("agenda_capacity") ||
    message.includes("schema cache") ||
    message.includes("Could not find")
  );
}

export function normalizeAgendaCapacity(value: number | string | null | undefined) {
  const capacity =
    typeof value === "number" ? value : Number(String(value ?? "").trim());

  return Number.isFinite(capacity) && capacity > 0
    ? Math.floor(capacity)
    : DEFAULT_AGENDA_CAPACITY;
}

export function getLocalAgendaCapacityKey(workshopId: string) {
  return `${AGENDA_CAPACITY_STORAGE_KEY}-${workshopId}`;
}

export function readLocalAgendaCapacityForImport(workshopId: string) {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(getLocalAgendaCapacityKey(workshopId));
    return stored ? normalizeAgendaCapacity(stored) : null;
  } catch {
    return null;
  }
}

export function clearLocalAgendaCapacity(workshopId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getLocalAgendaCapacityKey(workshopId));
}

export function readLocalAppointments() {
  if (typeof window === "undefined") return [];

  const storedAppointments = window.localStorage.getItem(AGENDA_STORAGE_KEY);
  if (!storedAppointments) return [];

  try {
    return (JSON.parse(storedAppointments) as Appointment[]).map((appointment) => ({
      ...appointment,
      endDate: appointment.endDate || appointment.date,
    }));
  } catch {
    window.localStorage.removeItem(AGENDA_STORAGE_KEY);
    return [];
  }
}

export function clearLocalAppointments() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AGENDA_STORAGE_KEY);
}

export function mapOrderToAppointment(order: AppointmentOrderRow): Appointment {
  const client = firstRelation(order.clients);
  const vehicle = firstRelation(order.vehicles);
  const serviceItems = order.service_order_items ?? [];
  const services = serviceItems
    .map((item) => firstRelation(item.services))
    .filter((service): service is AppointmentOrderService => Boolean(service));

  return {
    id: order.id,
    date: order.scheduled_date ?? dateKey(new Date()),
    endDate: order.scheduled_end_date ?? order.scheduled_date ?? dateKey(new Date()),
    startTime: normalizeDbTime(order.scheduled_start),
    endTime: normalizeDbTime(order.scheduled_end),
    clientId: order.client_id,
    vehicleId: order.vehicle_id,
    serviceIds: serviceItems.map((item) => item.service_id),
    servicePrices: servicePricesFromOrderItems(serviceItems),
    client: client?.name ?? "Cliente não encontrado",
    service: services.map((service) => service.name).join(", "),
    totalAmount: Number(order.total_amount) || 0,
    vehicle: vehicle
      ? `${vehicle.brand} ${vehicle.model} - ${vehicle.plate}`
      : "Veículo não encontrado",
    status: getAppointmentStatus(order.status),
    notes: order.notes?.trim() ?? "",
  };
}

export function formatServiceDuration(minutes: number | null) {
  if (!minutes) return null;

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h${String(remainingMinutes).padStart(2, "0")}`
    : `${hours}h`;
}

export function buildCalendarDays(currentMonth: Date) {
  const firstDay = startOfMonth(currentMonth);
  const lastDay = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0
  );

  return Array.from({ length: lastDay.getDate() }, (_, index) => {
    const day = new Date(firstDay);
    day.setDate(index + 1);
    return day;
  });
}

export function formatAppointmentCount(count: number) {
  return count === 1 ? "1 agendamento" : `${count} agendamentos`;
}
