export type AppointmentStatus = "Confirmado" | "Pendente" | "Cancelado" | "Concluído";

export interface Appointment {
  id: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  clientId: string;
  vehicleId: string;
  serviceIds: string[];
  client: string;
  service: string;
  totalAmount: number;
  vehicle: string;
  status: AppointmentStatus;
  notes: string;
}

export interface AppointmentForm {
  date: string;
  endDate: string;
  isMultiDay: boolean;
  startTime: string;
  endTime: string;
  clientId: string;
  vehicleId: string;
  serviceIds: string[];
  totalAmount: string;
  notes: string;
  /** Marca o horário sem ter o cliente cadastrado: cria um pré-cadastro no momento de salvar. */
  preCadastro: boolean;
  /** Como identificar esse cliente até alguém completar o cadastro. Opcional. */
  preCadastroLabel: string;
}

export interface AgendaService {
  id: string;
  name: string;
  price: number | string;
  duration_minutes: number | null;
  active: boolean;
}

export type ServiceOrderStatus =
  | "aberta"
  | "em_andamento"
  | "finalizada"
  | "cancelada";

export interface AppointmentOrderService {
  id: string;
  name: string;
  price: number | string;
  duration_minutes: number | null;
}

export interface AppointmentOrderItem {
  service_id: string;
  unit_price: number | string;
  services: AppointmentOrderService | AppointmentOrderService[] | null;
}

export interface AppointmentOrderRow {
  id: string;
  client_id: string;
  vehicle_id: string;
  status: ServiceOrderStatus | string;
  total_amount: number | string;
  notes: string | null;
  scheduled_date: string | null;
  scheduled_end_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  clients: { name: string } | { name: string }[] | null;
  vehicles:
    | { brand: string; model: string; plate: string }
    | { brand: string; model: string; plate: string }[]
    | null;
  service_order_items: AppointmentOrderItem[] | null;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface AppointmentOccurrence extends Appointment {
  occurrenceDate: string;
  isMultiDay: boolean;
  isContinuation: boolean;
  isFirstDay: boolean;
  isLastDay: boolean;
  durationDays: number;
}

export type AgendaSelectId = "client" | "vehicle" | "service";

export type AgendaPageTab = "calendar" | "serviceList";

export type AgendaDeleteConfirm =
  | { type: "appointment"; appointment: Appointment }
  | { type: "clearDay" }
  | null;
