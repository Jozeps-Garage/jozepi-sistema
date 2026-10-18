"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { GearSix, SignOut } from "@phosphor-icons/react";
import { UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { sidebarLabelClass } from "@/components/layout/sidebar";

const NAV_ICON_SIZE = 22;
const NAV_ICON_WEIGHT = "light" as const;

interface UserMenuProps {
  expanded: boolean;
  email: string;
  fullName?: string;
  avatarUrl?: string | null;
}

export function UserMenu({ expanded, email, fullName, avatarUrl }: UserMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isSettingsActive = pathname.startsWith("/configuracoes");

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="p-3">
      <Link
        href="/perfil"
        className="mb-3 flex h-11 items-center rounded-lg px-0 text-white/70 transition-colors duration-300 hover:bg-sidebar-hover hover:text-white"
        title="Meu perfil"
      >
        <div className="flex h-11 w-14 shrink-0 items-center justify-center">
          <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-semibold text-white transition-colors duration-300">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt="Foto do perfil"
                fill
                sizes="36px"
                className="object-cover"
                unoptimized
              />
            ) : (
              (fullName ?? email ?? "U").slice(0, 1).toUpperCase() || (
                <UserRound className="h-4 w-4" />
              )
            )}
          </div>
        </div>
        <div className={`ml-3 w-44 overflow-hidden ${sidebarLabelClass(expanded)}`}>
          <p className="truncate text-sm font-medium text-white">
            {fullName ?? "Usuário"}
          </p>
          <p className="truncate text-xs text-white/50">{email}</p>
        </div>
      </Link>
      <Link
        href="/configuracoes"
        className="flex h-11 items-center rounded-lg px-0 text-white/70 transition-colors duration-300 hover:bg-sidebar-hover hover:text-white"
        title="Configurações"
      >
        <span className="flex h-11 w-14 shrink-0 items-center justify-center">
          <GearSix
            size={NAV_ICON_SIZE}
            weight={NAV_ICON_WEIGHT}
            className={
              isSettingsActive ? "text-white" : "text-white opacity-60"
            }
            aria-hidden
          />
        </span>
        <span className={`ml-3 whitespace-nowrap ${sidebarLabelClass(expanded)}`}>
          Configurações
        </span>
      </Link>
      <Button
        variant="ghost"
        onClick={handleLogout}
        className="h-11 w-full justify-start gap-0 px-0 text-white/70 transition-colors duration-300 hover:bg-sidebar-hover hover:text-white"
        title="Sair"
      >
        <span className="flex h-11 w-14 shrink-0 items-center justify-center">
          <SignOut
            size={NAV_ICON_SIZE}
            weight={NAV_ICON_WEIGHT}
            className="text-white opacity-60"
            aria-hidden
          />
        </span>
        <span className={`ml-3 whitespace-nowrap ${sidebarLabelClass(expanded)}`}>
          Sair
        </span>
      </Button>
    </div>
  );
}
