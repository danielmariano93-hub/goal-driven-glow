import { AlertTriangle, Check, CircleDashed, Minus, TrendingUp } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { GoalCandidate, GoalCategoryEffect, GoalVerdict, GoalVerdictKind } from "@/lib/engine/goalVerdict";

// "Ter meta está fazendo sentido?" (`goal_verdict.v1`): resposta literal no topo, números que a sustentam
// e o que ela NÃO prova. Status nunca é só cor: sempre rótulo + ícone.

const KIND: Record<GoalVerdictKind, { tag: string; box: string; tagCls: string }> = {
  sim: { tag: "SIM", box: "border-emerald-500/30 bg-emerald-500/5", tagCls: "bg-emerald-600 text-white" },
  parcial: { tag: "EM PARTE", box: "border-amber-500/30 bg-amber-500/5", tagCls: "bg-amber-600 text-white" },
  nao: { tag: "AINDA NÃO", box: "border-red-500/30 bg-red-500/5", tagCls: "bg-red-600 text-white" },
  cedo: { tag: "CEDO DEMAIS", box: "border-border bg-card", tagCls: "bg-slate-600 text-white" },
};

const EFFECT: Record<GoalCategoryEffect["status"], { label: string; cls: string; Icon: typeof Check }> = {
  ajudou: { label: "Ajudou", cls: "text-emerald-700", Icon: Check },
  nao_ajudou: { label: "Não ajudou", cls: "text-red-700", Icon: AlertTriangle },
  sem_efeito: { label: "Sem efeito claro", cls: "text-muted-foreground", Icon: Minus },
  cedo: { label: "Aguardando 1º mês fechado", cls: "text-muted-foreground", Icon: CircleDashed },
};

const pct = (v: number) => `${v < 0 ? "−" : "+"}${Math.round(Math.abs(v) * 100)}%`;
const CONFIDENCE = { alta: "Confiança alta", media: "Confiança média", baixa: "Confiança baixa" } as const;

export function GoalVerdictCard({ verdict }: { verdict: GoalVerdict }) {
  const k = KIND[verdict.verdict];
  return (
    <section aria-label="Ter meta está fazendo sentido?" className={`mb-4 rounded-2xl border p-4 ${k.box}`} data-testid="goal-verdict">
      <p className="text-[11px] font-semibold text-muted-foreground">Ter metas está fazendo sentido?</p>
      <div className="mt-1.5 flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${k.tagCls}`}>{k.tag}</span>
        <h2 className="font-display text-lg font-bold leading-snug">{verdict.headline}</h2>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed">{verdict.summary}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{CONFIDENCE[verdict.confidence]} · {verdict.confidence_note}</p>

      {verdict.net_monthly != null ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-xl bg-background/70 p-2.5">
            <p className="text-muted-foreground">{verdict.net_monthly >= 0 ? "Evitado por mês" : "A mais por mês"}</p>
            <p className="font-semibold tabular-nums">{formatBRL(Math.abs(verdict.net_monthly))}</p>
            <p className="text-[10px] text-muted-foreground">líquido, contando as categorias que subiram</p>
          </div>
          <div className="rounded-xl bg-background/70 p-2.5">
            <p className="text-muted-foreground">{(verdict.total_avoided ?? 0) >= 0 ? "Evitado desde o início" : "A mais desde o início"}</p>
            <p className="font-semibold tabular-nums">{formatBRL(Math.abs(verdict.total_avoided ?? 0))}</p>
            <p className="text-[10px] text-muted-foreground">em {verdict.closed_goal_months} {verdict.closed_goal_months === 1 ? "mês" : "meses"} com meta</p>
          </div>
        </div>
      ) : null}

      {verdict.by_category.length ? (
        <ul className="mt-3 space-y-2" aria-label="Efeito por categoria">
          {verdict.by_category.map((c) => {
            const e = EFFECT[c.status];
            return (
              <li key={c.category_id} className="rounded-xl bg-background/70 p-2.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.category_name}</span>
                  <span className={`inline-flex items-center gap-1 font-semibold ${e.cls}`}><e.Icon size={12} /> {e.label}</span>
                </div>
                {c.baseline != null && c.after_avg != null && c.change_pct != null ? (
                  <p className="mt-0.5 text-muted-foreground">
                    Antes {formatBRL(c.baseline)}/mês → agora {formatBRL(c.after_avg)}/mês ({pct(c.change_pct)}) · {c.closed_months} {c.closed_months === 1 ? "mês" : "meses"}{c.confidence === "baixa" ? " · só indício" : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {verdict.caveats.length ? (
        <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted-foreground" aria-label="O que isso não prova">
          {verdict.caveats.map((c) => <li key={c}>• {c}</li>)}
        </ul>
      ) : null}

      <details className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Como o Nino mede isso</summary>
        <ul className="mt-2 space-y-1">
          <li>• <strong>Antes</strong> é a média que você tinha quando criou a meta, guardada e nunca recalculada.</li>
          <li>• <strong>Evitado</strong> é o antes menos o que você gastou, mês a mês, somando todas as categorias com meta, inclusive as que subiram.</li>
          <li>• Caiu 10% ou mais = ajudou; subiu 10% ou mais = não ajudou; no meio = sem efeito claro.</li>
          <li>• Confiança depende do número de meses fechados: 1 é indício, 2 é razoável, 3 ou mais é firme.</li>
          <li>• Evitar numa categoria só vira dinheiro guardado se o seu gasto variável total também cair.</li>
          <li>• É uma comparação com a sua própria história, não uma prova de causa.</li>
        </ul>
      </details>
    </section>
  );
}

/** Categorias sem meta que merecem uma: o que pesa, o que está subindo, e o teto sugerido. */
export function GoalCandidatesCard({ candidates, onCreate }: { candidates: GoalCandidate[]; onCreate: (c: GoalCandidate) => void }) {
  if (!candidates.length) return null;
  return (
    <section aria-label="Categorias que merecem uma meta" className="mb-4 rounded-2xl border border-border bg-card p-4" data-testid="goal-candidates">
      <p className="text-sm font-semibold">Categorias que merecem uma meta</p>
      <p className="text-[11px] text-muted-foreground">Gasto variável sem meta, do que mais pesa para o que está subindo.</p>
      <ul className="mt-3 space-y-3">
        {candidates.map((c) => (
          <li key={c.category_id} className="rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                  {c.category_name}
                  {c.priority === "alta" ? <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">PRIORIDADE ALTA</span> : null}
                  {c.trend_pct != null && c.trend_pct >= 0.2 ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-700"><TrendingUp size={11} /> subindo</span> : null}
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {c.reasons.map((r) => <li key={r}>• {r}</li>)}
                </ul>
                <p className="mt-1 text-[11px]">Teto sugerido <strong>{formatBRL(c.recommended_limit)}</strong>{c.potential_month > 0 ? <> · economia possível <strong>{formatBRL(c.potential_month)}/mês</strong></> : null}</p>
              </div>
              <button type="button" onClick={() => onCreate(c)} className="shrink-0 rounded-full border border-primary px-3 py-1.5 text-[11px] font-semibold text-primary">
                Criar meta
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
