"use client";

/* eslint-disable react-hooks/set-state-in-effect --
   Os efeitos abaixo sincronizam a animação de saída (timer) e o mount/unmount
   com a prop `open` vinda do pai — casos legítimos de sincronização externa. */

import { X } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
}: BottomSheetProps) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
      return;
    }
    if (render) {
      setClosing(true);
      const timeout = window.setTimeout(() => {
        setRender(false);
        setClosing(false);
      }, 280);
      return () => window.clearTimeout(timeout);
    }
  }, [open, render]);

  useEffect(() => {
    if (!render) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [render]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <div
        data-closing={closing}
        onClick={onClose}
        className="sheet-backdrop absolute inset-0 bg-slate-950/45"
        aria-hidden
      />
      <div
        data-closing={closing}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-panel glass-panel relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border-t border-white/50 shadow-2xl"
      >
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-11 rounded-full bg-muted/30" />
        </div>
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-2">
          <div className="min-w-0">
            <h2 className="font-brand text-lg font-medium uppercase tracking-wide text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="tap-press -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/70 text-muted hover:text-foreground"
          >
            <X size={18} weight="bold" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {children}
        </div>
      </div>
    </div>
  );
}
