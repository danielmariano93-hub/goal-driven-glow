import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Estado vazio padrão do MeuNino — pt-BR, tom encorajador.
 * Use em listas, filtros zerados, cards de módulo sem dados.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-border bg-card p-8 sm:p-10 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {icon ? (
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-primary/8 text-primary">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
