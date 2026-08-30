import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { MobileHub } from "@/components/mobile/mobile-hub";

export default async function AtalhosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const { workshopId } = await fetchOwnWorkshop(supabase);

  if (!workshopId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sidebar text-xl font-bold text-premium">
          JG
        </div>
        <p className="max-w-xs text-sm text-muted">
          Não encontramos a oficina vinculada à sua conta. Abra o sistema
          completo para concluir a configuração.
        </p>
        <Link
          href="/"
          className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white"
        >
          Abrir sistema
        </Link>
      </main>
    );
  }

  return (
    <MobileHub
      userName={profile?.full_name ?? user.email ?? "Bem-vindo"}
      workshopId={workshopId}
    />
  );
}
