import { Header } from "@/components/layout/header";
import { AgendaCapacityCard } from "@/components/settings/agenda-capacity-card";
import { AccountCredentialsCard } from "@/components/settings/account-credentials-card";
import { CompanyInfoCard } from "@/components/settings/company-info-card";
import { TimezoneCard } from "@/components/settings/timezone-card";
import { InviteUsersCard } from "@/components/settings/invite-users-card";
import { WhatsappCard } from "@/components/settings/whatsapp-card";
import { WhatsappFlowsCard } from "@/components/settings/whatsapp-flows-card";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <Header
        title="Configurações"
        description="Gerencie os dados da empresa, da conta e a segurança"
      />

      <div className="mb-6">
        <AccountCredentialsCard email={user.email ?? ""} />
      </div>

      <div className="mb-6">
        <CompanyInfoCard />
      </div>

      <div className="mb-6">
        <TimezoneCard />
      </div>

      <div className="mb-6">
        <WhatsappCard />
      </div>

      <div className="mb-6">
        <WhatsappFlowsCard />
      </div>

      <div className="mb-6">
        <InviteUsersCard />
      </div>

      <div>
        <AgendaCapacityCard />
      </div>
    </>
  );
}
