"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check, MagnifyingGlass, Plus, Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils/cn";

export interface DropdownOption {
  value: string;
  label: string;
  custom?: boolean;
}

interface DropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  actionLabel?: string;
  onAction?: () => void;
  createPlaceholder?: string;
  onCreateOption?: (label: string) => string | void;
  onDeleteOption?: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
}

const DROPDOWN_EXIT_MS = 160;
const DROPDOWN_ICON_WEIGHT = "light" as const;

export function Dropdown({
  label,
  value,
  options,
  onChange,
  placeholder = "Selecione uma opção",
  id,
  disabled = false,
  className,
  actionLabel,
  onAction,
  createPlaceholder = "Digite o nome",
  onCreateOption,
  onDeleteOption,
  searchable = false,
  searchPlaceholder = "Buscar...",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const closeTimeoutRef = useRef<number | null>(null);
  const inputId = id ?? label.toLowerCase().replace(/\s/g, "-");
  const selectedOption = options.find((option) => option.value === value);

  const visibleOptions = useMemo(() => {
    if (!searchable || !searchQuery.trim()) return options;
    const query = searchQuery.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, searchable, searchQuery]);

  function clearCloseTimeout() {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function openDropdown() {
    clearCloseTimeout();
    setClosing(false);
    setOpen(true);
  }

  function closeDropdown() {
    if (!open) return;

    clearCloseTimeout();
    setClosing(true);
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setCreating(false);
      setCreateValue("");
      setCreateError(null);
      setSearchQuery("");
      closeTimeoutRef.current = null;
    }, DROPDOWN_EXIT_MS);
  }

  function toggleDropdown() {
    if (open && !closing) {
      closeDropdown();
      return;
    }

    openDropdown();
  }

  function selectOption(nextValue: string) {
    onChange(nextValue);
    closeDropdown();
  }

  function startCreating() {
    setCreating(true);
    setCreateError(null);
    setCreateValue("");
  }

  function cancelCreating() {
    setCreating(false);
    setCreateError(null);
    setCreateValue("");
  }

  function submitCreatedOption() {
    if (!onCreateOption) return;

    const label = createValue.trim();
    if (!label) {
      setCreateError("Digite o nome.");
      return;
    }

    const error = onCreateOption(label);
    if (error) {
      setCreateError(error);
      return;
    }

    cancelCreating();
  }

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={cn("relative space-y-1.5", className)}>
      <label htmlFor={inputId} className="label-caps">
        {label}
      </label>
      <button
        id={inputId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open && !closing}
        onClick={toggleDropdown}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-input px-4 py-3 text-left text-base text-foreground transition-colors duration-300 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-2.5 sm:text-sm"
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            selectedOption ? "font-medium" : "text-muted/70"
          )}
        >
          {selectedOption?.label ?? placeholder}
        </span>
        <CaretDown
          size={16}
          weight={DROPDOWN_ICON_WEIGHT}
          className={cn(
            "shrink-0 text-muted transition-transform duration-200"
          )}
          aria-hidden
        />
      </button>

      {open && !disabled && (
        <div
          className={cn(
            "absolute left-0 right-0 top-full z-40 mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-card-hover",
            closing ? "dropdown-menu-exit" : "dropdown-menu-enter"
          )}
        >
          {searchable && (
            <div className="relative mb-2">
              <MagnifyingGlass
                size={15}
                weight={DROPDOWN_ICON_WEIGHT}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
                className="w-full rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}
          <div role="listbox" aria-labelledby={inputId} className="space-y-1">
            {searchable && visibleOptions.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted">Nenhum resultado encontrado.</p>
            )}
            {visibleOptions.map((option) => {
              const selected = option.value === value;
              const canDelete = Boolean(option.custom && onDeleteOption);

              return (
                <div
                  key={option.value}
                  className={cn(
                    "group flex items-center rounded-md transition-colors duration-300",
                    selected ? "bg-premium/10" : "hover:bg-background"
                  )}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectOption(option.value)}
                    className={cn(
                      "min-h-11 min-w-0 flex-1 px-3 py-3 text-left text-base font-semibold transition-colors sm:min-h-0 sm:py-2.5 sm:text-sm",
                      selected ? "text-premium" : "text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteOption?.(option.value);
                      }}
                      className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-100 transition-all duration-200 hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label={`Excluir ${option.label}`}
                      title={`Excluir ${option.label}`}
                    >
                      <Trash size={14} weight={DROPDOWN_ICON_WEIGHT} aria-hidden />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {creating && onCreateOption ? (
            <div className="mt-1">
              <div className="flex items-center gap-1 rounded-md border border-border bg-input pr-1">
                <input
                  value={createValue}
                  onChange={(event) => {
                    setCreateValue(event.target.value);
                    setCreateError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      submitCreatedOption();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      cancelCreating();
                    }
                  }}
                  autoFocus
                  placeholder={createPlaceholder}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={submitCreatedOption}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-600/10"
                  aria-label="Salvar"
                  title="Salvar"
                >
                  <Check size={14} weight={DROPDOWN_ICON_WEIGHT} aria-hidden />
                </button>
              </div>
              {createError && (
                <p className="mt-1.5 px-1 text-xs font-medium text-danger">
                  {createError}
                </p>
              )}
            </div>
          ) : actionLabel && (onAction || onCreateOption) && (
            <button
              type="button"
              onClick={() => {
                if (onCreateOption) {
                  startCreating();
                  return;
                }

                onAction?.();
                closeDropdown();
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-muted transition-colors duration-200 hover:bg-background hover:text-foreground"
            >
              <Plus size={14} weight={DROPDOWN_ICON_WEIGHT} aria-hidden />
              {actionLabel}
            </button>
          )}
        </div>
      )}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .dropdown-menu-enter {
            animation: dropdown-menu-enter 180ms ease-out both;
            transform-origin: top center;
          }

          .dropdown-menu-exit {
            animation: dropdown-menu-exit ${DROPDOWN_EXIT_MS}ms ease-in both;
            pointer-events: none;
            transform-origin: top center;
          }
        }

        @keyframes dropdown-menu-enter {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes dropdown-menu-exit {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
          }
        }
      `}</style>
    </div>
  );
}
