import { CalendarClock } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { ReportDashboard } from "@/lib/engine/reportDashboard";
import { cn } from "@/lib/utils";

/**
 * Relatórios em três atos, na ordem em que a pessoa pensa:
 * como foi → o que mudou → para onde vai. Um ato por vez, escolhido pela URL (`?ato=`).
 */
export const REPORT_ACTS = [
  { id: "foi", label: "Como foi", hint: "O resultado do período" },
  { id: "mudou", label: "O que mudou", hint: "O que pesou e o que aprendemos" },
  { id: "vai", label: "Para onde vai", hint: "Fechamento do mês e o que fazer" },
] as const;

export type ReportActId = (typeof REPORT_ACTS)[number]["id"];

export function parseAct(value: string | null | undefined): ReportActId {
  return REPORT_ACTS.some((a) => a.id === value) ? (value as ReportActId) : "foi";
}

/** Navegação fixa no topo da rolagem. Estado atual nunca é só cor: `aria-selected` + peso da fonte. */
export function ActNav({ active, onChange, counts }: { active: ReportActId; onChange: (id: ReportActId) => void; counts?: Partial<Record<ReportActId, number>> }) {
  return (
    <nav
      aria-label="Atos do relatório"
      className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur print:hidden"
    >
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-full bg-secondary p-1">
        {REPORT_ACTS.map((act) => {
          const selected = act.id === active;
          const count = counts?.[act.id] ?? 0;
          return (
            <button
              key={act.id}
              type="button"
              role="tab"
              id={`ato-${act.id}`}
              aria-selected={selected}
              aria-controls={`painel-${act.id}`}
              onClick={() => onChange(act.id)}
              className={cn(
                "min-h-[40px] rounded-full px-2 text-[12.5px] transition active:scale-[0.97]",
                selected ? "bg-background font-bold text-foreground shadow-sm" : "font-medium text-muted-foreground",
              )}
            >
              {act.label}
              {count > 0 ? <span className="ml-1 tabular-nums text-[11px] opacity-70">{count}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Subtítulo curto do ato: diz para que ele serve em uma linha. */
export function ActIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>;
}

type Projection = NonNullable<ReportDashboard["projection"]>;

/**
 * Fechamento previsto do mês. Só aparece quando o painel tem projeção real
 * (período do mês corrente, sem filtro). Número, ritmo e de onde ele vem:
 * já gasto + ritmo previsto + compromissos e fatura.
 */
export function ProjectionCard({ d }: { d: ReportDashboard }) {
  const p: Projection | null = d.filtered ? null : d.projection;
  if (!p) return null;

  const progress = Math.min(1, Math.max(0, p.daysElapsed / Math.max(1, p.daysInMonth)));
  const base = p.previousMonthExpense;
  const diff = base != null ? p.expense - base : null;
  const c = p.composition;
  const parts = c
    ? [
        { key: "realized", label: "Já gasto", value: c.realized, cls: "bg-primary" },
        { key: "variable", label: "Ritmo previsto", value: c.variable, cls: "bg-primary/55" },
        { key: "fixed", label: "Compromissos e fatura", value: c.commitments + c.cardDue, cls: "bg-primary/25" },
      ].filter((x) => x.value > 0.5)
    : [];
  const total = parts.reduce((s, x) => s + x.value, 0);

  return (
    <section data-testid="projection-card" aria-label="Fechamento previsto do mês" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarClock size={12} aria-hidden /> Fechamento previsto
      </p>
      <p className="mt-1.5 font-display text-[26px] font-bold leading-none tabular-nums">{formatBRL(p.expense)}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        de gasto até o fim do mês
        {diff != null && Math.abs(diff) >= 1 ? (
          <>
            {" · "}
            <strong className={diff > 0 ? "text-red-700" : "text-emerald-700"}>
              {formatBRL(Math.abs(diff))} {diff > 0 ? "acima" : "abaixo"}
            </strong>{" "}
            do mês passado inteiro
          </>
        ) : null}
        .
      </p>

      <div className="mt-3" role="img" aria-label={`${p.daysElapsed} de ${p.daysInMonth} dias do mês passados`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-foreground/60" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Dia {p.daysElapsed} de {p.daysInMonth}</p>
      </div>

      {parts.length > 0 && total > 0 ? (
        <div className="mt-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
            {parts.map((x) => <span key={x.key} className={cn("h-full", x.cls)} style={{ width: `${(x.value / total) * 100}%` }} />)}
          </div>
          <ul className="mt-2 space-y-1">
            {parts.map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", x.cls)} aria-hidden />
                  {x.label}
                </span>
                <span className="font-semibold tabular-nums">{formatBRL(x.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.early && !c ? (
        <p className="mt-3 text-[11px] text-muted-foreground">Base pequena: só {p.daysElapsed} dias do mês, então a previsão usa o seu histórico.</p>
      ) : null}
    </section>
  );
}
