export type QuoteStatus = "pendente" | "aprovado" | "expirado" | "convertido";
export type QuoteItemKind = "coating" | "stage" | "servico";

export interface QuoteItem {
  id: string;
  quote_id: string;
  service_id: string | null;
  name: string;
  kind: QuoteItemKind;
  unit_price: number;
  quantity: number;
}

export interface Quote {
  id: string;
  workshop_id: string;
  client_id: string | null;
  guest_name?: string | null;
  guest_contact?: string | null;
  status: QuoteStatus;
  valid_until: string | null;
  notes: string | null;
  total_amount: number;
  adjustment_amount?: number;
  service_order_id: string | null;
  created_at: string;
  updated_at: string;
  clients?:
    | {
        id: string;
        name: string;
        phone?: string | null;
        email?: string | null;
      }
    | {
        id: string;
        name: string;
        phone?: string | null;
        email?: string | null;
      }[]
    | null;
  quote_items?: QuoteItem[];
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  expirado: "Expirado",
  convertido: "Convertido",
};

export const QUOTE_KIND_LABEL: Record<QuoteItemKind, string> = {
  coating: "Coating",
  stage: "Stage",
  servico: "Serviço",
};

export function quoteKindBadgeClasses(kind: QuoteItemKind) {
  if (kind === "coating") return "bg-premium/15 text-premium";
  if (kind === "stage") return "bg-primary/10 text-primary";
  return "bg-background text-muted";
}

export const MANUAL_QUOTE_STATUSES: QuoteStatus[] = [
  "pendente",
  "aprovado",
  "expirado",
];

export function isQuoteStatus(value: string): value is QuoteStatus {
  return (
    value === "pendente" ||
    value === "aprovado" ||
    value === "expirado" ||
    value === "convertido"
  );
}

export function quoteStatusClasses(status: QuoteStatus) {
  if (status === "aprovado") return "bg-success/10 text-success";
  if (status === "convertido") return "bg-premium/15 text-premium";
  if (status === "expirado") return "bg-danger/10 text-danger";
  return "bg-warning/10 text-warning";
}

export function quoteClientLabel(quote: Quote) {
  const client = Array.isArray(quote.clients) ? quote.clients[0] : quote.clients;
  return client?.name?.trim() || quote.guest_name?.trim() || "Cliente";
}
