import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lightbulb, Repeat2, TrendingDown } from "lucide-react";
import { formatBRL } from "@/lib/split/math";
import { FAMILY_LABEL, subscriptionInsights, type Subscription } from "@/lib/engine/subscriptions";

type Props = { active: Subscription[]; possiblyEnded: Subscription[]; monthlyIncome: number | null; lastCardDate?: string | null; today?: string };

/** O que o Nino conclui das assinaturas: quantas são, quanto custam e o que mudaria no caixa se você cortasse. */
export function SubscriptionsSummary({ active, possiblyEnded, monthlyIncome, lastCardDate = null, today }: Props) {
  const [cut, setCut] = useState<Set<string>>(new Set());
  const ins = useMemo(() => subscriptionInsights(active, monthlyIncome), [active, monthlyIncome]);
  const saved = useMemo(() => active.filter((s) => cut.has(s.key)).reduce((a, s) => a + s.monthly, 0), [active, cut]);
  if (active.length === 0) return null;
  const toggle = (k: string) => setCut((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  return (
    <section aria-label="Suas assinaturas" className="surface-card space-y-3 p-4">
      <div className="flex items-start gap-2">
        <Repeat2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Suas assinaturas</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed">
            Você tem <strong>{ins.count} assinatura{ins.count === 1 ? "" : "s"}</strong> e gasta cerca de <strong>{formatBRL(ins.monthly_total)} por mês</strong> ({formatBRL(ins.annual_total)} por ano), somando cartão e conta.
          </p>
        </div>
      </div>

      {ins.lines.length > 0 && (
        <ul className="space-y-1.5 rounded-xl bg-secondary/40 p-3 text-[12px] leading-relaxed">
          {ins.lines.map((l) => <li key={l} className="flex gap-1.5"><Lightbulb size={12} className="mt-0.5 shrink-0 text-primary" aria-hidden /><span>{l}</span></li>)}
        </ul>
      )}

      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Marque as que você cancelaria para ver o efeito no caixa</p>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {active.map((s) => (
            <li key={s.key}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={cut.has(s.key)} onChange={() => toggle(s.key)} className="h-4 w-4 shrink-0" aria-label={`Cancelaria ${s.name}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-medium ${cut.has(s.key) ? "line-through text-muted-foreground" : ""}`}>{s.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{FAMILY_LABEL[s.family]} · no {s.channel}{s.amount_varies ? " · valor varia" : ""}</span>
                </span>
                <strong className="shrink-0 text-sm tabular-nums">{s.amount_varies ? "~" : ""}{formatBRL(s.monthly)}</strong>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {saved > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-900" data-testid="subscription-saving">
          <TrendingDown size={15} className="mt-0.5 shrink-0" aria-hidden />
          <p>Cancelando {cut.size === 1 ? "essa" : `essas ${cut.size}`}, você libera <strong>{formatBRL(saved)} por mês</strong> no caixa — <strong>{formatBRL(saved * 12)} por ano</strong>{monthlyIncome ? ` (${(saved / monthlyIncome * 100).toFixed(1).replace(".", ",")}% da sua renda)` : ""}.</p>
        </div>
      )}
      {ins.max_savings_month > 0 && saved === 0 && (
        <p className="text-[12px] text-muted-foreground">Só pelos serviços repetidos, o potencial é de até <strong className="text-foreground">{formatBRL(ins.max_savings_month)}/mês</strong>.</p>
      )}

      {possiblyEnded.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Sem cobrança há mais de 50 dias (não contei): {possiblyEnded.map((s) => s.name).join(", ")}. Se ainda paga, o lançamento pode estar faltando.
        </p>
      )}
      {lastCardDate && today && (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastCardDate}T12:00:00Z`)) / 86_400_000 > 20 && (
        <p className="rounded-xl bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900" data-testid="card-coverage-note">
          Seus lançamentos de cartão vão até {lastCardDate.slice(8, 10)}/{lastCardDate.slice(5, 7)}. Assinaturas cobradas no cartão depois disso (ou em faturas que ainda não entraram) não aparecem aqui. <Link to="/app/importar" className="font-semibold underline">Importar a fatura</Link>
        </p>
      )}
      <p className="text-[10px] text-muted-foreground/80">Calculado dos seus lançamentos. Eu não vejo se você usa cada serviço — essa decisão é sua.</p>
    </section>
  );
}
