"use client";

/* eslint-disable react-hooks/set-state-in-effect --
   Detecta iOS/standalone/localStorage no cliente (APIs só disponíveis após
   montagem) — sincronização legítima com o ambiente do navegador. */

import { Export, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const DISMISS_KEY = "jozepi-install-hint-dismissed";

export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !("MSStream" in window);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone === true);

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }

    setShow(isIOS && !standalone && !dismissed);
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  }

  return (
    <div className="glass-panel flex items-start gap-3 rounded-2xl border border-border/60 p-3 text-sm text-foreground shadow-card">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Export size={18} weight="light" aria-hidden />
      </span>
      <p className="flex-1 leading-snug">
        Instale o app: toque em <strong>Compartilhar</strong> e depois em{" "}
        <strong>Adicionar à Tela de Início</strong>.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar"
        className="tap-press -mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:text-foreground"
      >
        <X size={15} weight="bold" aria-hidden />
      </button>
    </div>
  );
}
