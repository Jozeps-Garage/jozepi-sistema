import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientFormData } from "@/types/client";
import {
  deleteVehiclePhotoByUrl,
  uploadVehiclePhoto,
} from "@/lib/supabase/vehicle-photos";

function isVehicleFilled(v: ClientFormData["vehicles"][0]) {
  return v.brand.trim() || v.model.trim() || (v.plate ?? "").trim();
}

/**
 * Só o campo "Veículo" é obrigatório. Placa fica de fora porque dá para
 * cadastrar o cliente antes de ver o carro — entra como pré-cadastro e é
 * cobrada depois. Marca e ano não têm mais campo no formulário: continuam no
 * payload só para não apagar o que os veículos antigos já tinham.
 */
function isVehicleComplete(v: ClientFormData["vehicles"][0]) {
  return Boolean(v.model.trim());
}

function parseYear(year: string): number | null {
  const trimmed = year.trim();
  if (!trimmed) return null;
  const y = parseInt(trimmed, 10);
  if (isNaN(y) || y < 1900 || y > new Date().getFullYear() + 1) {
    throw new Error("Ano do veículo inválido.");
  }
  return y;
}

async function resolvePhotoUrls(
  supabase: SupabaseClient,
  workshopId: string,
  vehicleId: string,
  vehicle: ClientFormData["vehicles"][0]
): Promise<{ photo_url_1: string | null; photo_url_2: string | null }> {
  let photo_url_1 = vehicle.removePhoto1 ? null : vehicle.photoUrl1;
  let photo_url_2 = vehicle.removePhoto2 ? null : vehicle.photoUrl2;

  if (vehicle.removePhoto1 && vehicle.photoUrl1) {
    await deleteVehiclePhotoByUrl(supabase, vehicle.photoUrl1);
  }
  if (vehicle.removePhoto2 && vehicle.photoUrl2) {
    await deleteVehiclePhotoByUrl(supabase, vehicle.photoUrl2);
  }

  if (vehicle.photoFile1) {
    if (photo_url_1) await deleteVehiclePhotoByUrl(supabase, photo_url_1);
    photo_url_1 = await uploadVehiclePhoto(
      supabase,
      workshopId,
      vehicleId,
      vehicle.photoFile1,
      1
    );
  }

  if (vehicle.photoFile2) {
    if (photo_url_2) await deleteVehiclePhotoByUrl(supabase, photo_url_2);
    photo_url_2 = await uploadVehiclePhoto(
      supabase,
      workshopId,
      vehicleId,
      vehicle.photoFile2,
      2
    );
  }

  return { photo_url_1, photo_url_2 };
}

export async function syncVehicles(
  supabase: SupabaseClient,
  workshopId: string,
  clientId: string,
  vehicles: ClientFormData["vehicles"],
  existingVehicleIds: string[] = []
) {
  const filled = vehicles.filter(isVehicleFilled);
  const incomplete = filled.filter((v) => !isVehicleComplete(v));

  if (incomplete.length > 0) {
    throw new Error("Preencha o veículo de todos os carros adicionados.");
  }

  const complete = filled.filter(isVehicleComplete);
  const keptIds = complete.filter((v) => v.id).map((v) => v.id!);
  const toDelete = existingVehicleIds.filter((id) => !keptIds.includes(id));

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("vehicles")
      .delete()
      .in("id", toDelete);
    if (error) throw new Error(error.message);
  }

  for (const v of complete) {
    const year = parseYear(v.year);
    const plate = (v.plate ?? "").trim().toUpperCase();
    const basePayload = {
      brand: v.brand.trim(),
      model: v.model.trim(),
      // NULL e não "": placa ausente precisa ser um só valor para as consultas
      // que contam pendência não terem que checar os dois.
      plate: plate || null,
      year,
      pre_cadastro: !plate,
    };

    let vehicleId = v.id;

    if (vehicleId) {
      const { error } = await supabase
        .from("vehicles")
        .update(basePayload)
        .eq("id", vehicleId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase
        .from("vehicles")
        .insert({
          ...basePayload,
          client_id: clientId,
          workshop_id: workshopId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      vehicleId = data.id;
    }

    if (!vehicleId) throw new Error("Erro ao salvar veículo.");

    const photos = await resolvePhotoUrls(
      supabase,
      workshopId,
      vehicleId,
      v
    );

    const { error: photoError } = await supabase
      .from("vehicles")
      .update(photos)
      .eq("id", vehicleId);

    if (photoError) throw new Error(photoError.message);
  }
}
