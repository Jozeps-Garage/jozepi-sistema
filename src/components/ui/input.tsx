"use client";

import { cn } from "@/lib/utils/cn";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  prefix?: string;
  suffix?: ReactNode;
  compact?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, prefix, suffix, compact = false, ...props }, ref) => {
    const inputId = id ?? label.toLowerCase().replace(/\s/g, "-");

    return (
      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        <label htmlFor={inputId} className="label-caps">
          {label}
        </label>
        <div className="relative">
          {prefix && (
            <span
              className={cn(
                "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-muted",
                compact ? "text-sm" : "text-base sm:text-sm"
              )}
            >
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full rounded-md border border-border bg-input text-foreground",
              compact
                ? "min-h-10 px-3 py-2 text-sm"
                : "px-4 py-3 text-base sm:py-2.5 sm:text-sm",
              prefix && "pl-11",
              suffix && "pr-11",
              "placeholder:text-muted/60 transition-colors duration-300",
              "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-danger focus:border-danger focus:ring-danger/20",
              className
            )}
            {...props}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted">
              {suffix}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
