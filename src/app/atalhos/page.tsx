import { redirect } from "next/navigation";

// Rota preservada para não quebrar ícones já instalados na tela de início
// apontando para /atalhos (o antigo start_url do PWA). A navegação e as
// ações rápidas agora vivem no próprio dashboard.
export default function AtalhosRedirect() {
  redirect("/");
}
