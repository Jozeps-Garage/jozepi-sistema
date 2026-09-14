"use client";

import { Car, MagnifyingGlass, PencilSimple, UserCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { Client, Vehicle } from "@/types/client";
import { formatPhone } from "@/lib/utils/format";

interface ClientPickerProps {
  clients: Client[];
  clientId: string;
  onSelectClient: (client: Client) => void;
  onClear: () => void;
  /** Se definido, mostra a escolha de veículo do cliente selecionado. */
  vehicleId?: string;
  onSelectVehicle?: (vehicle: Vehicle) => void;
}

export function ClientPicker({
  clients,
  clientId,
  onSelectClient,
  onClear,
  vehicleId,
  onSelectVehicle,
}: ClientPickerProps) {
  const [query, setQuery] = useState("");
  const selected = clients.find((client) => client.id === clientId) ?? null;

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return clients;
    const digits = term.replace(/\D/g, "");
    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        (digits.length > 0 &&
          (client.phone ?? "").replace(/\D/g, "").includes(digits))
    );
  }, [clients, query]);

  if (selected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-input px-3 py-2.5">
          <UserCircle size={30} weight="light" className="shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {selected.name}
            </p>
            {selected.phone && (
              <p className="truncate text-xs text-muted">{formatPhone(selected.phone)}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onClear();
            }}
            className="tap-press flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary"
          >
            <PencilSimple size={14} weight="bold" aria-hidden />
            Trocar
          </button>
        </div>

        {onSelectVehicle && (
          <div className="space-y-1.5">
            <span className="label-caps">Veículo</span>
            {selected.vehicles && selected.vehicles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selected.vehicles.map((vehicle) => {
                  const active = vehicle.id === vehicleId;
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => onSelectVehicle(vehicle)}
                      className={`tap-press flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-card text-foreground"
                      }`}
                    >
                      <Car size={14} weight="light" aria-hidden />
                      {vehicle.brand} {vehicle.model} · {vehicle.plate}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Este cliente ainda não tem veículo cadastrado.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="relative border-b border-border">
        <MagnifyingGlass
          size={16}
          weight="light"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar cliente por nome ou telefone"
          className="w-full bg-input py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted">
            {clients.length === 0
              ? "Nenhum cliente cadastrado ainda."
              : "Nenhum cliente encontrado."}
          </p>
        ) : (
          results.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => onSelectClient(client)}
              className="tap-press flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-background"
            >
              <UserCircle size={24} weight="light" className="shrink-0 text-muted" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {client.name}
                </p>
                {client.phone && (
                  <p className="truncate text-xs text-muted">{formatPhone(client.phone)}</p>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
