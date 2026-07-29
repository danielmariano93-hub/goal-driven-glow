import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Progressive disclosure: código técnico, nomes de RPC, SQLSTATE, tokens,
 * p50/p95 e identificadores internos ficam aqui — nunca no primeiro nível.
 */
export function TechnicalDetails({
  label = "Detalhes técnicos",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-border/70 bg-secondary/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span>{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-border/70 px-4 py-3 text-xs">{children}</div>}
    </div>
  );
}
