import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchOwnWorkshop(supabase: SupabaseClient) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      userId: null as string | null,
      workshopId: null as string | null,
      error: { message: userError?.message ?? "Usuário não encontrado." },
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("workshop_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return {
      userId: user.id,
      workshopId: null as string | null,
      error: { message: error.message },
    };
  }

  if (!data?.workshop_id) {
    return {
      userId: user.id,
      workshopId: null as string | null,
      error: { message: "Oficina não encontrada." },
    };
  }

  return {
    userId: user.id,
    workshopId: data.workshop_id as string,
    error: null,
  };
}
