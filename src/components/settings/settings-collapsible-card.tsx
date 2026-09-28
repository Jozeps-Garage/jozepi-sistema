"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface SettingsCollapsibleCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

export function SettingsCollapsibleCard({
  icon,
  title,
  description,
  children,
  className,
}: SettingsCollapsibleCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("card-surface", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-4 text-left"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-premium/10 text-premium">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="section-title">{title}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <ChevronDown
          className={`mt-3 h-5 w-5 shrink-0 text-muted transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
