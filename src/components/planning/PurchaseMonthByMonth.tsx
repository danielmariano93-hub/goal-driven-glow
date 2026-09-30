import { formatBRL } from "@/lib/engine/facts";
import type { PurchasePlan } from "@/lib/nino/purchasePlan";

const MONTH_STYLE: Record<PurchasePlan["months"][number]["verdict"], { label: string; chip: string }> = {
  fits: { label: "Cabe", chip: "bg-success/10 text-success" },
  tight: { label: "Aperta", chip: "bg-warning/15 text-warning-foreground" },
  deficit: { label: "Não cabe", chip: "bg-brand-coral/15 text-brand-coral" },
  worsens_deficit: { label: "Não cabe", chip: "bg-destructive/10 text-destructive" },
};

/** Um bloco por mês afetado: entra, sai, a compra, a sobra antes → depois e a categoria. */
export function PurchaseMonthByMonth({ plan }: { plan: PurchasePlan }) {
  const many = plan.months.length > 1;
  return (
    <section className="rounded-[18px] border border-border bg-card p-4">
      <h2 className="font-display text-base font-bold text-foreground">{many ? "Mês a mês, até a última parcela" : `Efeito em ${plan.months[0].label.toLowerCase()}`}</h2>
      <div className="mt-2 space-y-3">
        {plan.months.map((m) => {
          const tone = MONTH_STYLE[m.verdict];
          return (
            <article key={m.month} className="rounded-xl bg-muted/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-foreground">{m.label}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>{tone.label}</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-muted-foreground">{m.income_basis === "realized" ? "Já entrou" : "Entrada típica"}</dt>
                <dd className="text-right tabular-nums">{formatBRL(m.income)}</dd>
                <dt className="text-muted-foreground">
                  {m.outflow_basis === "committed" ? "Saída já comprometida" : m.outflow_basis === "realized_plus_pace" ? "Saída prevista (feito + ritmo)" : "Saída típica"}
                </dt>
                <dd className="text-right tabular-nums">{formatBRL(m.outflow)}</dd>
                <dt className="text-muted-foreground">Esta compra</dt>
                <dd className="text-right tabular-nums">{formatBRL(m.purchase)}</dd>
                <dt className="font-semibold text-foreground">Sobra do mês</dt>
                <dd className={`text-right font-bold tabular-nums ${m.margin_after < 0 ? "text-destructive" : "text-foreground"}`}>
                  {formatBRL(m.margin_after)}
                  <span className="block text-[10.5px] font-normal text-muted-foreground">antes: {formatBRL(m.margin_before)}</span>
                </dd>
              </dl>
              {m.contracted_installments > 0 ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Parcelas já contratadas nesse mês: {formatBRL(m.contracted_installments)}.</p>
              ) : null}
              {m.category ? (
                <p className={`mt-1.5 text-[11.5px] leading-[16px] ${m.category.exceeds_limit ? "font-semibold text-destructive" : "text-foreground/80"}`}>{m.category.text}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
