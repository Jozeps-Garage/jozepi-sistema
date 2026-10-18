"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { InstallHint } from "@/components/mobile/install-hint";
import {
  SIDEBAR_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
} from "@/lib/utils/sidebar-cookie";

interface AppShellProps {
  defaultExpanded: boolean;
  userEmail: string;
  userName?: string;
  avatarUrl?: string | null;
  /** Fica fora do `main` por ser flutuante (FAB, diálogos presos na tela). */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({
  defaultExpanded,
  userEmail,
  userName,
  avatarUrl,
  overlay,
  children,
}: AppShellProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  function toggleSidebar() {
    const next = !expanded;
    setExpanded(next);
    // Cookie, e não localStorage: o layout é server component e lê esse valor
    // para mandar a sidebar já no estado certo no primeiro HTML, sem piscar.
    document.cookie = `${SIDEBAR_COOKIE}=${
      next ? "open" : "closed"
    }; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        expanded={expanded}
        onToggle={toggleSidebar}
        userEmail={userEmail}
        userName={userName}
        avatarUrl={avatarUrl}
      />
      <main
        className={`pb-24 transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:pb-0 ${
          expanded ? "md:pl-64" : "md:pl-20"
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 md:px-8 md:py-8">
          <div className="mb-4 md:hidden">
            <InstallHint />
          </div>
          {children}
        </div>
      </main>
      {overlay}
    </div>
  );
}
