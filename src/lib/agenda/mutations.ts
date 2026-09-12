import type { SupabaseClient } from "@supabase/supabase-js";
import { assertMutationRows } from "@/lib/supabase/mutations";
import {
  loadSupabaseCatalog,
  saveSupabaseProduct,
} from "@/lib/products/supabase-catalog";
import { syncVehicles } from "@/lib/clients/sync-vehicles";
import { parsePositiveNumber } from "@/lib/products/catalog";
import { getProductRemainingStock } from "@/lib/products/catalog";
import { normalizePhone } from "@/lib/utils/format";
import type {
  Appointment,
  AppointmentStatus,
  AppointmentOrderRow,
} from "@/lib/agenda/types";
import {
  readLocalAppointments,
  clearLocalAppointments,
  getAppointmentEndDate,
  isUuid,
  getServiceOrderStatus,
  dateKey,
} from "@/lib/agenda/utils";
import type { ClientFormData } from "@/types/client";
import type { Client } from "@/types/client";

// ─── service_orders ──────────────────────────────────────────────────────────

export async function updateAppointmentOrder(
  supabase: SupabaseClient,
  editingId: string,
  payload: Record<string, unknown>
) {
  return supabase
    .from("service_orders")
    .update(payload)
    .eq("id", editingId)
    .select("id");
}

export async function insertAppointmentOrder(
  supabase: SupabaseClient,
  workshopId: string,
  payload: Record<string, unknown>
) {
  return supabase
    .from("service_orders")
    .insert({
      ...payload,
      workshop_id: workshopId,
      payment_status: "pendente",
    })
    .select("id")
    .single();
}

export async function saveAppointmentItems(
  supabase: SupabaseClient,
  appointmentId: string,
  items: { service_id: string; quantity: number; unit_price: number }[]
) {
  return supabase
    .from("service_order_items")
    .insert(
      items.map((item) => ({
        ...item,
        service_order_id: appointmentId,
      }))
    )
    .select("id");
}

export async function deleteAppointmentItems(
  supabase: SupabaseClient,
  appointmentId: string
) {
  return supabase
    .from("service_order_items")
    .delete()
    .eq("service_order_id", appointmentId);
}

export async function deleteAppointment(
  supabase: SupabaseClient,
  appointmentId: string
) {
  return supabase
    .from("service_orders")
    .delete()
    .eq("id", appointmentId)
    .select("id");
}

export async function deleteAppointmentsForDay(
  supabase: SupabaseClient,
  appointmentIds: string[]
) {
  return supabase
    .from("service_orders")
    .delete()
    .in("id", appointmentIds)
    .select("id");
}

export async function updateAppointmentStatus(
  supabase: SupabaseClient,
  appointmentId: string,
  status: AppointmentStatus,
  completedAt: string | null
) {
  return supabase
    .from("service_orders")
    .update({
      status: getServiceOrderStatus(status),
      completed_at: completedAt,
    })
    .eq("id", appointmentId)
    .select("id");
}

export async function updateAppointmentStatusBulk(
  supabase: SupabaseClient,
  appointmentIds: string[],
  completedAt: string
) {
  return supabase
    .from("service_orders")
    .update({
      status: "finalizada",
      completed_at: completedAt,
    })
    .in("id", appointmentIds);
}

export async function updateAppointmentNotes(
  supabase: SupabaseClient,
  appointmentId: string,
  notes: string | null
) {
  return supabase
    .from("service_orders")
    .update({ notes })
    .eq("id", appointmentId)
    .select("id");
}

// ─── workshops ───────────────────────────────────────────────────────────────

export async function updateWorkshopCapacity(
  supabase: SupabaseClient,
  workshopId: string,
  capacity: number
) {
  return supabase
    .from("workshops")
    .update({ agenda_capacity: capacity })
    .eq("id", workshopId);
}

// ─── financial_transactions ──────────────────────────────────────────────────

export async function syncFinanceRevenue(
  supabase: SupabaseClient,
  workshopId: string,
  appointment: Appointment
): Promise<string | null> {
  if (!workshopId || appointment.totalAmount <= 0) return null;

  const description = `${appointment.client} - ${
    appointment.service || "Serviço realizado"
  }`;
  const payload = {
    workshop_id: workshopId,
    type: "receita" as const,
    description,
    amount: appointment.totalAmount,
    category: "Serviço",
    service_order_id: appointment.id,
    transaction_date: appointment.date,
  };

  const { data: existingTransactions, error: findError } = await supabase
    .from("financial_transactions")
    .select("id")
    .eq("service_order_id", appointment.id)
    .eq("type", "receita")
    .limit(1);

  if (findError) return findError.message;

  const existingTransaction = existingTransactions?.[0];
  if (existingTransaction) {
    const { error: updateError } = await supabase
      .from("financial_transactions")
      .update(payload)
      .eq("id", existingTransaction.id);

    return updateError?.message ?? null;
  }

  const { error: insertError } = await supabase
    .from("financial_transactions")
    .insert(payload);

  return insertError?.message ?? null;
}

export async function deleteFinanceRevenue(
  supabase: SupabaseClient,
  appointmentId: string
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("financial_transactions")
    .delete()
    .eq("service_order_id", appointmentId)
    .eq("type", "receita");

  return deleteError?.message ?? null;
}

// ─── product_stock_discounts ──────────────────────────────────────────────────

export async function applyStockDiscount(
  supabase: SupabaseClient,
  workshopId: string,
  appointment: Appointment
): Promise<void> {
  if (!workshopId) return;

  const { data: existingDiscount, error: findDiscountError } = await supabase
    .from("product_stock_discounts")
    .select("service_order_id")
    .eq("workshop_id", workshopId)
    .eq("service_order_id", appointment.id)
    .maybeSingle();

  if (findDiscountError || existingDiscount) return;

  const catalog = await loadSupabaseCatalog(supabase, workshopId);
  const usageByProductId = new Map<string, number>();

  appointment.serviceIds.forEach((serviceId) => {
    (catalog.serviceProductUsages[serviceId] ?? []).forEach((usage) => {
      try {
        const amount = parsePositiveNumber(usage.amount);
        usageByProductId.set(
          usage.productId,
          (usageByProductId.get(usage.productId) ?? 0) + amount
        );
      } catch {
        // Ignore incomplete service usage rows.
      }
    });
  });

  if (usageByProductId.size === 0) return;

  for (const product of catalog.products) {
    const discountAmount = usageByProductId.get(product.id);
    if (!discountAmount) continue;

    await saveSupabaseProduct(supabase, workshopId, {
      ...product,
      stockRemaining: String(
        Math.max(0, getProductRemainingStock(product) - discountAmount)
      ),
    });
  }

  await supabase.from("product_stock_discounts").insert({
    workshop_id: workshopId,
    service_order_id: appointment.id,
  });
}

// ─── importLocalAppointments ─────────────────────────────────────────────────

export async function importLocalAppointments(
  supabase: SupabaseClient,
  workshopId: string,
  remoteAppointments: Appointment[]
): Promise<Appointment[]> {
  const localAppointments = readLocalAppointments();
  if (localAppointments.length === 0) return remoteAppointments;

  // Clear localStorage IMMEDIATELY after reading — before any async inserts.
  // This prevents race conditions when importLocalAppointments is called
  // concurrently (e.g. React StrictMode double-invoke): only the first caller
  // sees data; subsequent calls see an empty store and return early.
  clearLocalAppointments();

  const existingKeys = new Set(
    remoteAppointments.map(
      (appointment) =>
        `${appointment.date}|${getAppointmentEndDate(appointment)}|${appointment.startTime}|${appointment.endTime}|${appointment.clientId}|${appointment.vehicleId}`
    )
  );
  const importedAppointments: Appointment[] = [];

  for (const appointment of localAppointments) {
    const appointmentKey = `${appointment.date}|${getAppointmentEndDate(appointment)}|${appointment.startTime}|${appointment.endTime}|${appointment.clientId}|${appointment.vehicleId}`;
    if (existingKeys.has(appointmentKey)) continue;

    const payload = {
      ...(isUuid(appointment.id) ? { id: appointment.id } : {}),
      workshop_id: workshopId,
      client_id: appointment.clientId,
      vehicle_id: appointment.vehicleId,
      total_amount: appointment.totalAmount,
      scheduled_date: appointment.date,
      scheduled_end_date: getAppointmentEndDate(appointment),
      scheduled_start: appointment.startTime,
      scheduled_end: appointment.endTime,
      status: getServiceOrderStatus(appointment.status),
      payment_status: "pendente",
      completed_at:
        appointment.status === "Concluído" ? new Date().toISOString() : null,
      notes: (appointment.notes ?? "").trim() || null,
    };

    const { data: insertedOrder, error: insertError } = await supabase
      .from("service_orders")
      .insert(payload)
      .select("id")
      .single();

    if (insertError) throw insertError;

    const savedAppointmentId = insertedOrder.id as string;
    if (appointment.serviceIds.length > 0) {
      const { error: itemsError } = await supabase
        .from("service_order_items")
        .insert(
          appointment.serviceIds.map((serviceId) => ({
            service_order_id: savedAppointmentId,
            service_id: serviceId,
            quantity: 1,
            unit_price: 0,
          }))
        );

      if (itemsError) throw itemsError;
    }

    importedAppointments.push({ ...appointment, id: savedAppointmentId });
    existingKeys.add(appointmentKey);
  }

  return [...remoteAppointments, ...importedAppointments];
}

// ─── clients ─────────────────────────────────────────────────────────────────

/**
 * Cria um cliente incompleto direto da agenda: dá pra marcar o horário sem ter nome,
 * telefone ou veículo em mãos, e alguém finaliza o cadastro depois pela tela de clientes.
 *
 * Telefone nasce VAZIO (não nulo): o resto do sistema já trata string vazia como "não tem",
 * e assim nenhuma coluna precisou virar nullable.
 *
 * O veículo de marcação é inserido aqui e não pelo syncVehicles de propósito: aquele ignora
 * veículo sem marca/modelo/placa, que é exatamente o caso aqui.
 */
export async function createPreCadastroClient(
  supabase: SupabaseClient,
  workshopId: string,
  label: string
): Promise<Client> {
  const nome = label.trim() || "Cliente a identificar";

  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({
      name: nome,
      phone: "",
      notes: null,
      workshop_id: workshopId,
      pre_cadastro: true,
    })
    .select("id")
    .single();

  if (clientError) {
    throw new Error(clientError.message);
  }

  const { error: vehicleError } = await supabase.from("vehicles").insert({
    workshop_id: workshopId,
    client_id: newClient.id,
    brand: "",
    model: "",
    plate: "",
    pre_cadastro: true,
  });

  if (vehicleError) {
    throw new Error(vehicleError.message);
  }

  const { data: savedClient, error: savedClientError } = await supabase
    .from("clients")
    .select(
      "*, vehicles(id, client_id, brand, model, plate, year, photo_url_1, photo_url_2, pre_cadastro)"
    )
    .eq("id", newClient.id)
    .single();

  if (savedClientError) {
    throw new Error(savedClientError.message);
  }

  return savedClient as Client;
}

export async function createClientWithVehicles(
  supabase: SupabaseClient,
  workshopId: string,
  data: ClientFormData
): Promise<Client> {
  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({
      name: data.name.trim(),
      phone: normalizePhone(data.phone),
      notes: data.notes.trim() || null,
      workshop_id: workshopId,
    })
    .select("id")
    .single();

  if (clientError) {
    throw new Error(clientError.message);
  }

  await syncVehicles(supabase, workshopId, newClient.id, data.vehicles);

  const { data: savedClient, error: savedClientError } = await supabase
    .from("clients")
    .select(
      "*, vehicles(id, client_id, brand, model, plate, year, photo_url_1, photo_url_2)"
    )
    .eq("id", newClient.id)
    .single();

  if (savedClientError) {
    throw new Error(savedClientError.message);
  }

  return savedClient as Client;
}
