import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sem conexão — Jozep's Garage",
};

export default function OfflinePage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-8 text-center"
      style={{ background: "var(--background)" }}
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sidebar text-2xl font-bold tracking-wide text-premium">
        JG
      </div>
      <div className="space-y-2">
        <h1 className="font-brand text-2xl font-light uppercase tracking-wide text-foreground">
          Sem conexão
        </h1>
        <p className="max-w-xs text-sm text-muted">
          Você está offline. Reconecte à internet para continuar cadastrando e
          consultando os dados da oficina.
        </p>
      </div>
    </main>
  );
}
