import { cn } from "@/lib/utils/cn";

/**
 * O fantasma mostra a forma do conteúdo que vai aparecer ali, em vez de uma
 * caixa vazia dizendo que não há nada. Ele é decorativo — o leitor de tela
 * recebe só a mensagem.
 */
function GhostRows() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-muted/10" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div
              className="h-2.5 rounded-full bg-muted/10"
              style={{ width: `${58 - row * 8}%` }}
            />
            <div className="h-2 w-1/4 rounded-full bg-muted/[0.07]" />
          </div>
          <div className="h-2.5 w-16 shrink-0 rounded-full bg-muted/10" />
        </div>
      ))}
    </div>
  );
}

function GhostBars() {
  const heights = [38, 62, 45, 78, 52, 88, 44, 68, 35, 72];
  return (
    <div className="flex h-full items-end justify-between gap-2" aria-hidden>
      {heights.map((height, index) => (
        <div
          key={index}
          className="flex-1 rounded-t-md bg-muted/10"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  ghost = "rows",
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  ghost?: "rows" | "bars";
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden px-4 py-8", className)}>
      <div className="pointer-events-none absolute inset-0 px-4 py-6 opacity-70">
        {ghost === "bars" ? <GhostBars /> : <GhostRows />}
      </div>

      <div className="relative mx-auto flex max-w-sm flex-col items-center rounded-xl border border-border/70 bg-card/95 px-5 py-6 text-center shadow-card backdrop-blur-sm">
        <span className="icon-chip h-11 w-11">{icon}</span>
        <p className="mt-3 text-sm font-bold text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
