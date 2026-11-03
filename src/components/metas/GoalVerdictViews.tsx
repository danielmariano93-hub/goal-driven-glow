import { useState } from "react";
import { ChevronDown, TrendingUp } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { GoalCandidate, GoalVerdict, GoalVerdictKind } from "@/lib/engine/goalVerdict";

// "Ter meta está fazendo sentido?" (`goal_verdict.v1`): resposta literal no topo, números que a sustentam
// e o que ela NÃO prova. Status nunca é só cor: sempre rótulo + ícone.

const KIND: Record<GoalVerdictKind, { tag: string; box: string; tagCls: string }> = {
  sim: { tag: "SIM", box: "border-emerald-500/30 bg-emerald-500/5", tagCls: "bg-emerald-600 text-white" },
  parcial: { tag: "EM PARTE", box: "border-amber-500/30 bg-amber-500/5", tagCls: "bg-amber-600 text-white" },
  nao: { tag: "AINDA NÃO", box: "border-red-500/30 bg-red-500/5", tagCls: "bg-red-600 text-white" },
  cedo: { tag: "CEDO DEMAIS", box: "border-border bg-card", tagCls: "bg-slate-600 text-white" },
};

const pct = (v: number) => `${v < 0 ? "−" : "+"}${Math.round(Math.abs(v) * 100)}%`;
const CONFIDENCE = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;

export function GoalVerdictCard({ verdict }: { verdict: GoalVerdict }) {
  const k = KIND[verdict.verdict];
  const big = verdict.net_monthly;
  return (
    <section aria-label="As metas de gasto estão funcionando?" className={`mb-4 rounded-[22px] border p-4 ${k.box}`} data-testid="goal-verdict">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">AS METAS DE GASTO ESTÃO FUNCIONANDO?</p>
      <div className="mt-2 flex items-start gap-2.5">
        <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${k.tagCls}`}>{verdict.badge}</span>
        <h2 className="font-display text-[19px] font-extrabold leading-tight">{verdict.headline}</h2>
      </div>

      {big != null ? (
        <div className="mt-3.5 flex flex-wrap items-baseline gap-x-2">
          <span className={`font-display text-[34px] font-extrabold tabular-nums tracking-tight ${big >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatBRL(Math.abs(big))}</span>
          <span className="text-sm text-foreground/80">{big >= 0 ? "a menos" : "a mais"} por mês ({pct(verdict.net_pct ?? 0).replace(/^[+−]/, "")}{big >= 0 ? " a menos" : " a mais"})</span>
        </div>
      ) : null}
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{verdict.summary}</p>

      {big != null ? (
        <div className="mt-3.5 grid grid-cols-2 gap-2.5 text-[12px]">
          <div className="rounded-xl bg-background/70 p-3">
            <p className="text-muted-foreground">{(verdict.total_avoided ?? 0) >= 0 ? "Evitado desde o início" : "A mais desde o início"}</p>
            <p className="mt-0.5 font-display text-[17px] font-extrabold tabular-nums">{formatBRL(Math.abs(verdict.total_avoided ?? 0))}</p>
          </div>
          <div className="rounded-xl bg-background/70 p-3">
            <p className="text-muted-foreground">Confiança</p>
            <p className="mt-0.5 font-display text-[17px] font-extrabold">{CONFIDENCE[verdict.confidence]}</p>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">{verdict.confidence_note}</p>

      {verdict.outside_line ? (
        <div className="mt-3 flex items-start gap-2.5 border-t border-border/70 pt-3">
          <span aria-hidden className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-amber-500/15 text-[13px] font-extrabold text-amber-700">!</span>
          <p className="text-[13px] leading-relaxed text-foreground/90">{verdict.outside_line}</p>
        </div>
      ) : null}

      {verdict.caveats.length ? (
        <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted-foreground" aria-label="O que isso não prova">
          {verdict.caveats.map((c) => <li key={c}>• {c}</li>)}
        </ul>
      ) : null}

      <details className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Como o Nino mede isso</summary>
        <ul className="mt-2 space-y-1">
          <li>• <strong>Antes</strong> é a média que você tinha antes do primeiro mês de meta de cada categoria.</li>
          <li>• <strong>Agora</strong> é o gasto médio dos meses fechados com meta. Meses importados só contam depois que você confirma.</li>
          <li>• <strong>Funcionou</strong>: o gasto caiu 10% ou mais frente ao antes. <strong>Sem efeito claro</strong>: variou menos que isso.</li>
          <li>• <strong>Evitado</strong> é antes menos agora, somando todas as metas, inclusive as que não mexeram. É o mesmo número em toda a tela.</li>
          <li>• Confiança pelo número de meses fechados: 1 é indício, 2 é razoável, 3 ou mais é firme.</li>
          <li>• Compara com a sua própria história: não prova causa.</li>
        </ul>
      </details>
    </section>
  );
}

/** Onde ainda não há meta: fechado por padrão, com uma linha de resumo; expande para as candidatas. */
export function GoalCandidatesCard({ candidates, onCreate }: { candidates: GoalCandidate[]; onCreate: (c: GoalCandidate) => void }) {
  const [open, setOpen] = useState(false);
  if (!candidates.length) return null;
  const summary = candidates
    .slice(0, 3)
    .map((c) => (c.trend_pct != null && c.trend_pct >= 0.2 ? `${c.category_name} +${Math.round(c.trend_pct * 100)}%` : `${c.category_name} ${formatBRL(c.avg_month)}/mês`))
    .join(", ");
  const rising = candidates.filter((c) => c.trend_pct != null && c.trend_pct >= 0.2).length;
  return (
    <section aria-label="Onde ainda não há meta" className="mb-4 rounded-[22px] border border-border bg-card p-4" data-testid="goal-candidates">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
        <span>
          <span className="block font-display text-[17px] font-extrabold">Onde ainda não há meta</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
            {rising > 0 ? `${rising} ${rising === 1 ? "categoria subindo" : "categorias subindo"}: ` : `${candidates.length} ${candidates.length === 1 ? "categoria pesa" : "categorias pesam"}: `}{summary}
          </span>
        </span>
        <ChevronDown size={20} aria-hidden className={`shrink-0 text-primary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <p className="mt-2 text-[11px] text-muted-foreground">Gasto livre sem meta, do que mais pesa para o que mais sobe.</p>
          <ul className="mt-2">
            {candidates.map((c) => (
              <li key={c.category_id} className="flex items-center justify-between gap-3 border-t border-border py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold">
                    {c.category_name}
                    {c.trend_pct != null && c.trend_pct >= 0.2 ? <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-700"><TrendingUp size={11} aria-hidden /> +{Math.round(c.trend_pct * 100)}%</span> : null}
                    {c.priority === "alta" ? <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">PRIORIDADE ALTA</span> : null}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                    {formatBRL(c.avg_month)}/mês · {Math.round(c.share_variable * 100)}% do gasto livre{c.top_merchant ? ` · ${c.top_merchant.label} pesa ${Math.round(c.top_merchant.share * 100)}%` : ""} · teto sugerido {formatBRL(c.recommended_limit)}
                  </p>
                  <details className="mt-1 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer font-semibold text-foreground/80">Por quê</summary>
                    <ul className="mt-1 space-y-0.5">{c.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
                  </details>
                </div>
                <button type="button" onClick={() => onCreate(c)} className="min-h-11 shrink-0 rounded-full border border-primary px-3.5 text-[13px] font-semibold text-primary">Criar meta</button>
              </li>
            ))}
          </ul>
          <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">Só entram categorias de gasto livre acima de R$ 150 por mês. Moradia, dívidas, dízimo, saúde e contas da casa ficam de fora.</p>
        </>
      ) : null}
    </section>
  );
}
