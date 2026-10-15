import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatBRL } from "@/lib/split/math";
import type { RecurringOverview } from "@/lib/engine/recurringOverview";

/** Resposta direta: quanto se repete por mês e quanto disso dá para cortar sem sofrer. */
export function RecurringOverviewCard({ overview, monthlyIncome }: { overview: RecurringOverview; monthlyIncome: number | null }) {
  const [open, setOpen] = useState(false);
  if (overview.total <= 0) return null;
  const incomePct = monthlyIncome && monthlyIncome > 0 ? Math.round((overview.total / monthlyIncome) * 100) : null;
  return (
    <section className="surface-card space-y-3 p-4" data-testid="recurring-overview">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Fixo todo mês</p>
        <p className="font-display text-3xl font-bold tabular-nums" data-testid="overview-total">{formatBRL(overview.total)}</p>
        {incomePct != null && <p className="text-[11px] text-muted-foreground">{incomePct}% da sua renda mensal aproximada</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-secondary/60 p-3">
          <p className="text-[11px] text-muted-foreground">Não dá para parar</p>
          <p className="font-semibold tabular-nums" data-testid="overview-essential">{formatBRL(overview.essential)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900">
          <p className="text-[11px] opacity-80">Oportunidade</p>
          <p className="font-semibold tabular-nums" data-testid="overview-opportunity">{formatBRL(overview.opportunity)}</p>
        </div>
      </div>
      {overview.opportunity > 0 ? (
        <p className="text-xs text-muted-foreground">
          Se precisar apertar o mês, dá para liberar até <strong className="text-foreground">{formatBRL(overview.opportunity)}</strong> cortando só assinaturas e serviços,
          sem mexer em nada que você não possa deixar de pagar. Em um ano são {formatBRL(overview.opportunity * 12)}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Não vi assinaturas ou serviços cortáveis entre as suas contas fixas.</p>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-10 w-full items-center justify-between text-xs font-medium text-primary" aria-expanded={open}>
        Ver como separei
        <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div className="space-y-3 text-xs">
          {([["Oportunidade", overview.opportunities], ["Não dá para parar", overview.essentials]] as const).map(([title, items]) => items.length > 0 && (
            <div key={title}>
              <p className="mb-1 font-semibold">{title}</p>
              <ul className="divide-y divide-border">
                {items.map((i) => (
                  <li key={i.key} className="flex justify-between gap-3 py-1.5">
                    <span className="truncate">{i.name}{i.source === "divida" ? " (parcela)" : i.source === "detectada" ? " (ainda sem regra)" : ""}</span>
                    <span className="tabular-nums">{formatBRL(i.monthly)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
