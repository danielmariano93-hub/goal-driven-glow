import { ArrowRight, Brain, CircleAlert, Sparkles, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import type { BehavioralEvolutionSnapshot } from "@/lib/behavioral/client";

const toneStyle = {
  positive: { wrap: "border-success/20 bg-success/5", icon: "bg-success/10 text-success", Icon: TrendingUp },
  attention: { wrap: "border-brand-coral/20 bg-brand-coral/5", icon: "bg-brand-coral/10 text-brand-coral", Icon: CircleAlert },
  neutral: { wrap: "border-primary/20 bg-primary/5", icon: "bg-primary/10 text-primary", Icon: Brain },
} as const;

export function CoachHighlights({ snapshot }: { snapshot: BehavioralEvolutionSnapshot }) {
  const items = snapshot.highlights.slice(0, 4);
  const pattern = snapshot.emotionSpend;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Nino percebeu</p>
        <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Highlights que viram ação</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          O Nino separa observação, hipótese e fato. Correlação emocional nunca é apresentada como diagnóstico ou causa.
        </p>
      </div>

      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => {
            const style = toneStyle[item.tone];
            const Icon = style.Icon;
            return (
              <article key={item.id} className={`rounded-[22px] border p-4 ${style.wrap}`}>
                <div className="flex items-start gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${style.icon}`}><Icon size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                  </div>
                </div>
                {item.tone === "attention" ? (
                  <div className="mt-3 flex flex-wrap gap-2 pl-12">
                    <a href="#experimentos" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">Testar uma mudança <ArrowRight size={13} /></a>
                    <Link to="/app/planejamento" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">Antes de comprar</Link>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[22px] border border-dashed border-border bg-card p-6 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold">Ainda não há um padrão forte o bastante</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Continue registrando seu momento. O Nino prefere esperar evidência suficiente a inventar uma história sobre você.</p>
        </div>
      )}

      <div className="rounded-[22px] border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">Emoção × gastos</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Dias pareados com check-in e lançamentos reais</p>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold">{pattern.pairedDays} dias</span>
        </div>
        {pattern.sufficient ? (
          <div className="mt-3 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-secondary/20">
            <div className="p-3">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Contexto sensível</p>
              <p className="mt-1 text-sm font-bold">R$ {Number(pattern.vulnerableAverage ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="p-3">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Mais tranquilo</p>
              <p className="mt-1 text-sm font-bold">R$ {Number(pattern.comparisonAverage ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="p-3">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Diferença</p>
              <p className={`mt-1 text-sm font-bold ${(pattern.upliftPct ?? 0) > 0 ? "text-brand-coral" : "text-success"}`}>{(pattern.upliftPct ?? 0) > 0 ? "+" : ""}{Number(pattern.upliftPct ?? 0).toFixed(0)}%</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-2xl bg-secondary/40 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
            Precisamos de pelo menos 8 dias pareados, com amostra nos dois contextos, para comparar sem forçar uma conclusão.
          </p>
        )}
      </div>
    </section>
  );
}
