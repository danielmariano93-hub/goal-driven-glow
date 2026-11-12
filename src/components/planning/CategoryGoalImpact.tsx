import { formatBRL } from "@/lib/engine/facts";
import { goalImpactView, goalMonths, percentText, type GoalImpactInput } from "@/lib/nino/categoryGoalImpact";
import type { PurchasePlan } from "@/lib/nino/purchasePlan";

/** O "zoom" na meta da categoria: o veredito do mês é de caixa; este bloco diz o que a compra faz na meta de gasto. */
export function CategoryGoalImpact({ impact, installments, plan }: { impact: GoalImpactInput; installments: number; plan: PurchasePlan | null }) {
  const v = goalImpactView(impact);
  const months = installments > 1 ? goalMonths(plan) : [];
  const single = installments <= 1;
  const over = v.status === "exceeds" || v.status === "was_over";
  const title = single
    ? v.status === "outside" ? "Não muda nada na meta"
      : v.status === "fits" ? "Cabe na meta"
      : v.status === "exceeds" ? "Estoura a meta"
      : "A meta já estava estourada"
    : "Parcelas e a meta";
  const text = (() => {
    if (!single) return months.length > 0 ? "Cada parcela pesa na meta do mês em que cair." : "Não encontrei meta para os meses das parcelas.";
    if (v.status === "outside") return `Esta compra cai fora do período da meta de ${impact.categoryName}, então ela não conta nela.`;
    if (v.status === "fits") return `Sobram ${formatBRL(impact.remainingAfter)} na meta. A compra usa ${percentText(v.usedOfRemaining ?? 0)} do que ainda cabia (${formatBRL(impact.remainingBefore)}).`;
    if (v.status === "exceeds") return `A compra passa ${formatBRL(Math.abs(impact.remainingAfter))} do limite. Antes dela ainda cabiam ${formatBRL(impact.remainingBefore)}.`;
    return `A meta já estava ${formatBRL(Math.abs(impact.remainingBefore))} acima do limite; com a compra, fica ${formatBRL(Math.abs(impact.remainingAfter))} acima.`;
  })();
  const total = Math.max(1, v.spentFrac + v.purchaseFrac);
  return (
    <section className="rounded-[18px] border border-border bg-card p-4" aria-label={`Impacto na meta de ${impact.categoryName}`}>
      <p className="text-[11px] text-muted-foreground">Impacto na meta de {impact.categoryName}</p>
      <h2 className={`mt-0.5 font-display text-base font-bold ${over ? "text-destructive" : "text-foreground"}`}>{title}</h2>
      <p className="mt-1 text-[12px] leading-[18px] text-foreground/80">{text}</p>
      {single ? (
        <>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Meta de ${formatBRL(impact.limit)}: já gasto ${formatBRL(impact.spent)}${v.applied > 0 ? `, mais ${formatBRL(v.applied)} desta compra` : ""}`}>
            <i className="block h-full bg-primary/60" style={{ width: `${(Math.min(v.spentFrac, total) / total) * 100}%` }} />
            {v.applied > 0 ? <i className={`block h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${(v.purchaseFrac / total) * 100}%` }} /> : null}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <div><dt className="text-muted-foreground">Meta</dt><dd className="font-semibold tabular-nums">{formatBRL(impact.limit)}</dd></div>
            <div><dt className="text-muted-foreground">Já gasto</dt><dd className="font-semibold tabular-nums">{formatBRL(impact.spent)}</dd></div>
            <div><dt className="text-muted-foreground">{v.applied > 0 ? "Com a compra" : "Sobra"}</dt><dd className={`font-semibold tabular-nums ${over ? "text-destructive" : ""}`}>{formatBRL(v.applied > 0 ? impact.spent + v.applied : impact.remainingBefore)}</dd></div>
          </dl>
        </>
      ) : months.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {months.map((m) => (
            <li key={m.label} className="flex min-h-10 items-center justify-between gap-3 py-2 text-[12px]">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="tabular-nums">{formatBRL(m.after)} <span className="text-muted-foreground">de {formatBRL(m.limit)}</span> <b className={m.exceeds ? "text-destructive" : "text-foreground"}>{m.exceeds ? "estoura" : "dentro"}</b></span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
