import { useState } from "react";
import { ChevronDown, TrendingUp } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { GoalCandidate, GoalVerdict, GoalVerdictKind } from "@/lib/engine/goalVerdict";

// "Ter meta está fazendo sentido?" (`goal_verdict.v1`): resposta literal no topo, números que a sustentam
// e o que ela NÃO prova. Status nunca é só cor: sempre rótulo + ícone.

// Superfícies neutras; cor só onde significa algo (o número-chave e o selo de estado).
const FIGURE_TONE: Record<GoalVerdictKind, string> = {
  sim: "text-emerald-700",
  parcial: "text-emerald-700",
  nao: "text-red-700",
  cedo: "text-foreground",
};

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const sinceText = (ym: string | null) => (ym ? `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}` : "o início");
const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const CONFIDENCE = { alta: "alta", media: "média", baixa: "baixa" } as const;

export function GoalVerdictCard({ verdict }: { verdict: GoalVerdict }) {
  const big = verdict.net_monthly;
  const avoided = verdict.total_avoided ?? 0;
  return (
    <section aria-label="As metas de gasto estão funcionando?" className="mb-3 rounded-2xl border border-border bg-card p-4" data-testid="goal-verdict">
      <p className="text-[12px] leading-4 text-muted-foreground">As metas de gasto estão funcionando?</p>
      <h2 className="mt-1 text-[16px] font-semibold leading-5">{verdict.headline}</h2>

      {big != null ? (
        <>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className={`text-[28px] font-medium leading-8 tabular-nums ${big >= 0 ? FIGURE_TONE[verdict.verdict] : "text-red-700"}`}>{formatBRL(Math.abs(big))}</span>
            <span className="text-[14px] leading-5 text-muted-foreground">{big >= 0 ? "a menos" : "a mais"} por mês · {pct(verdict.net_pct ?? 0)} {big >= 0 ? "a menos" : "a mais"} vs antes</span>
          </p>
          <p className="mt-2 text-[12px] leading-4 tabular-nums text-muted-foreground">
            {verdict.badge} · {avoided >= 0 ? "evitado" : "a mais"} {formatBRL(Math.abs(avoided))} desde {sinceText(verdict.since_month)}
            {verdict.calendar_months > 0 ? ` (${verdict.calendar_months} ${verdict.calendar_months === 1 ? "mês" : "meses"})` : ""} · confiança {CONFIDENCE[verdict.confidence]}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[14px] leading-5 text-muted-foreground">{verdict.summary}</p>
      )}

      {verdict.outside_line ? (
        <p className="mt-3 border-t border-border pt-3 text-[13px] leading-5 text-muted-foreground">{verdict.outside_line}</p>
      ) : null}

      <details className="mt-3 text-[12px] leading-4 text-muted-foreground">
        <summary className="cursor-pointer text-foreground/80">Como o Nino mede isso</summary>
        <ul className="mt-2 space-y-1.5">
          <li>Antes é a média que você tinha antes do primeiro mês de meta de cada categoria.</li>
          <li>Agora é o gasto médio dos meses fechados com meta. Meses importados só contam depois que você confirma.</li>
          <li>Funcionou: o gasto caiu 10% ou mais frente ao antes. Sem efeito claro: variou menos que isso.</li>
          <li>Evitado é antes menos agora, somando todas as metas, inclusive as que não mexeram. É o mesmo número em toda a tela.</li>
          <li>Confiança pelo número de meses fechados: 1 é indício, 2 é razoável, 3 ou mais é firme.</li>
          <li>Compara com a sua própria história: não prova causa.</li>
          {verdict.caveats.map((c) => <li key={c}>{c}</li>)}
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
    <section aria-label="Onde ainda não há meta" className="mb-3 rounded-2xl border border-border bg-card px-4 py-3" data-testid="goal-candidates">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold leading-5">Onde ainda não há meta</span>
          <span className="block text-[12px] leading-4 text-muted-foreground">
            {rising > 0 ? `${rising} ${rising === 1 ? "categoria subindo" : "categorias subindo"}: ` : `${candidates.length} ${candidates.length === 1 ? "categoria pesa" : "categorias pesam"}: `}{summary}
          </span>
        </span>
        <ChevronDown size={16} aria-hidden className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <ul className="mt-1">
            {candidates.map((c) => (
              <li key={c.category_id} className="flex items-center justify-between gap-3 border-t border-border py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-medium leading-5">
                    {c.category_name}
                    {c.trend_pct != null && c.trend_pct >= 0.2 ? <span className="inline-flex items-center gap-0.5 text-[12px] font-normal tabular-nums text-red-700"><TrendingUp size={12} aria-hidden /> +{Math.round(c.trend_pct * 100)}%</span> : null}
                    {c.priority === "alta" ? <span className="text-[12px] font-normal text-muted-foreground">prioridade alta</span> : null}
                  </p>
                  <p className="text-[12px] leading-4 tabular-nums text-muted-foreground">
                    {formatBRL(c.avg_month)}/mês · {Math.round(c.share_variable * 100)}% do gasto livre{c.top_merchant ? ` · ${c.top_merchant.label} pesa ${Math.round(c.top_merchant.share * 100)}%` : ""} · teto sugerido {formatBRL(c.recommended_limit)}
                  </p>
                  <details className="text-[12px] leading-4 text-muted-foreground">
                    <summary className="cursor-pointer">Por quê</summary>
                    <ul className="mt-1 space-y-0.5">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  </details>
                </div>
                <button type="button" onClick={() => onCreate(c)} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-[13px] font-medium text-primary">Criar meta</button>
              </li>
            ))}
          </ul>
          <p className="border-t border-border pt-2 text-[12px] leading-4 text-muted-foreground">Só entram categorias de gasto livre acima de R$ 150 por mês. Moradia, dívidas, dízimo, saúde e contas da casa ficam de fora.</p>
        </>
      ) : null}
    </section>
  );
}
