import type { SourceFilter } from "@/lib/engine/ticketAnalytics";
import { SOURCE_LABEL } from "./sourceStyle";

/** Alternância Ticket / Bolso / Total (ordem pedida no handoff). */
export function SourceFilterChips({ value, onChange, label, options = ["ticket", "own", "total"] }: { value: SourceFilter; onChange: (v: SourceFilter) => void; label: string; options?: SourceFilter[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-muted p-1">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}
          className={`min-h-9 rounded-full px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${value === o ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
          {o === "own" ? "Bolso" : SOURCE_LABEL[o]}
        </button>
      ))}
    </div>
  );
}
