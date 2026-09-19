"use client";

import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBodyScrollLock } from "@/lib/utils/body-scroll-lock";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  extraLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onExtra?: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  extraLabel,
  loading = false,
  onConfirm,
  onCancel,
  onExtra,
}: ConfirmDialogProps) {
  useBodyScrollLock(open);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-card-hover sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id="confirm-dialog-title"
              className="text-lg font-semibold tracking-wide text-foreground"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {cancelLabel}
          </Button>
          {extraLabel && onExtra && (
            <Button
              type="button"
              variant="secondary"
              onClick={onExtra}
              disabled={loading}
              className="w-full border-danger/30 text-danger hover:bg-danger/10 sm:w-auto"
            >
              {extraLabel}
            </Button>
          )}
          <Button
            type="button"
            onClick={onConfirm}
            loading={loading}
            className="w-full bg-danger text-white hover:bg-danger/90 focus:ring-danger/30 sm:w-auto"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
