import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { BenefitEntryRow } from "@/lib/db/benefitWallet";
import { isEditableBenefitEntry } from "@/components/ticket/EntrySheet";
import { ENTRY_PAGE, newestFirst } from "@/lib/ticket/entryOrder";

const KIND_LABEL = { credit: "Crédito", spend: "Gasto", balance_reading: "Saldo informado", adjustment: "Ajuste" } as const;

/**
 * Lançamentos do Ticket. Mostra os mais recentes e deixa abrir os mais antigos, em vez de cortar a lista
 * (antes só os 12 últimos apareciam e os de datas anteriores sumiam).
 */
export function EntryList({ entries, onEdit, onRemove, removing, money, day }: {
  entries: BenefitEntryRow[];
  onEdit: (e: BenefitEntryRow) => void;
  onRemove: (id: string) => void;
  removing: boolean;
  money: (v: number) => string;
  day: (iso: string) => string;
}) {
  const [shown, setShown] = useState(ENTRY_PAGE);
  const sorted = newestFirst(entries);
  if (sorted.length === 0) return null;
  const visible = sorted.slice(0, shown);
  const rest = sorted.length - visible.length;
  return (
    <section className="surface-card flex flex-col gap-1 p-5" data-testid="ticket-entries">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="font-bold">Lançamentos</h2>
        <span className="text-xs text-muted-foreground" data-testid="ticket-entries-count">
          {rest > 0 ? `${visible.length} de ${sorted.length}` : `${sorted.length} ${sorted.length === 1 ? "lançamento" : "lançamentos"}`}
        </span>
      </div>
      {visible.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
          <div className="min-w-0">
            <div className="truncate font-medium">{KIND_LABEL[e.kind]}{e.merchant ? ` · ${e.merchant}` : ""}</div>
            <div className="text-xs text-muted-foreground">{day(e.occurred_on)}</div>
          </div>
          <div className="flex items-center gap-1">
            <strong className={`font-semibold ${e.kind === "credit" ? "text-success" : ""}`}>{e.kind === "spend" ? "− " : e.kind === "credit" ? "+ " : ""}{money(e.amount)}</strong>
            {isEditableBenefitEntry(e) && (
              <button aria-label="Editar lançamento" onClick={() => onEdit(e)}
                className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Pencil size={16} /></button>
            )}
            <button aria-label="Excluir lançamento" disabled={removing} onClick={() => onRemove(e.id)}
              className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Trash2 size={16} /></button>
          </div>
        </div>
      ))}
      {rest > 0 && (
        <button type="button" onClick={() => setShown((n) => n + ENTRY_PAGE)}
          className="mt-2 min-h-11 rounded-xl border border-border text-sm font-semibold">
          Ver mais {Math.min(ENTRY_PAGE, rest)} {rest === 1 ? "antigo" : "antigos"}{rest > ENTRY_PAGE ? ` (faltam ${rest})` : ""}
        </button>
      )}
    </section>
  );
}
