"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useEffect } from "react";

export interface ToastState {
  id: number;
  message: string;
  tone: "success" | "error";
}

export function Toast({
  toast,
  onDone,
}: {
  toast: ToastState | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(onDone, 2800);
    return () => window.clearTimeout(timeout);
  }, [toast, onDone]);

  if (!toast) return null;

  const isSuccess = toast.tone === "success";
  const Icon = isSuccess ? CheckCircle : WarningCircle;

  return (
    <div
      key={toast.id}
      className="rise-in pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[120] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-card-hover ${
          isSuccess ? "bg-success" : "bg-danger"
        }`}
      >
        <Icon size={18} weight="fill" aria-hidden />
        <span>{toast.message}</span>
      </div>
    </div>
  );
}
