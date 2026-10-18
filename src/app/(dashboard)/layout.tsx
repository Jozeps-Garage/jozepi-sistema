import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchOwnWorkshop } from "@/lib/supabase/current-profile";
import { AppShell } from "@/components/layout/app-shell";
import { SIDEBAR_COOKIE } from "@/lib/utils/sidebar-cookie";
import { QuickActionsFab } from "@/components/mobile/quick-actions-fab";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  // A sidebar abre no clique e fica assim até o próximo clique; ler o cookie
  // aqui faz o primeiro HTML já sair no estado certo.
  const cookieStore = await cookies();
  const sidebarExpanded = cookieStore.get(SIDEBAR_COOKIE)?.value === "open";

  return (
    <AppShell
      defaultExpanded={sidebarExpanded}
      userEmail={user.email ?? ""}
      userName={profile?.full_name}
      avatarUrl={
        typeof user.user_metadata.avatar_url === "string"
          ? user.user_metadata.avatar_url
          : null
      }
      overlay={workshopId ? <QuickActionsFab workshopId={workshopId} /> : null}
    >
      {children}
    </AppShell>
  );
}
