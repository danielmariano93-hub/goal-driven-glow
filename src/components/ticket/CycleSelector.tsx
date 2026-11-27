import { ChevronLeft, ChevronRight } from "lucide-react";
import { benefitAddDays, type TicketCycle } from "@/lib/engine/benefitWallet";
import { dm } from "./sourceStyle";

/** Seletor de ciclo com datas explícitas e estado (aberto, encerrado, incompleto). */
export function CycleSelector({ cycles, index, onChange, today }: { cycles: TicketCycle[]; index: number; onChange: (i: number) => void; today: string }) {
  const c = cycles[index];
  if (!c) return null;
  const status = c.incomplete ? "incompleto" : c.open ? "aberto" : "encerrado";
  const end = c.open ? today : c.end;
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card px-2 py-1.5" data-testid="ticket-cycle-selector">
      <button type="button" aria-label="Ciclo anterior" disabled={index <= 0} onClick={() => onChange(index - 1)}
        className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-30"><ChevronLeft size={20} /></button>
      <div className="text-center" aria-live="polite">
        <div className="text-sm font-semibold tabular-nums">Ciclo de {dm(c.start)} a {dm(end)}</div>
        <div className={`text-xs ${c.incomplete ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
          {status}{c.open ? ` · próxima recarga prevista em ${dm(benefitAddDays(c.end, 1))}` : ""}
        </div>
      </div>
      <button type="button" aria-label="Próximo ciclo" disabled={index >= cycles.length - 1} onClick={() => onChange(index + 1)}
        className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-30"><ChevronRight size={20} /></button>
    </div>
  );
}
