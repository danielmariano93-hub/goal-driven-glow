import type { ReactNode } from "react";
import { X } from "lucide-react";

export type ActiveFilter = { key: string; label: string; onClear: () => void };

export function FilterBar({
  children,
  active = [],
  onClearAll,
}: {
  children: ReactNode;
  active?: ActiveFilter[];
  onClearAll?: () => void;
}) {
  const hasActive = active.length > 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {hasActive && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={f.onClear}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 pl-3 pr-2 py-1 text-[11px] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={`Remover filtro ${f.label}`}
            >
              <span className="text-muted-foreground">{f.label}</span>
              <X size={11} />
            </button>
          ))}
          {onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Limpar tudo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
