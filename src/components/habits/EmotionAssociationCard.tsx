import { useState } from "react";
import type { MoneyImpact } from "@/lib/engine/behaviorEvolution";
import { MONEY_IMPACT_MIN_DAYS } from "@/lib/engine/behaviorEvolution";

const reais = (n: number) => `R$ ${Math.round(Math.abs(n)).toLocaleString("pt-BR")}`;
const DISMISS_KEY = "habits-v2:emotion-association:dismissed";

function readDismissed(): boolean {
  try { return window.localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

/**
 * Associação entre momentos de menor tranquilidade e gasto — para investigar, não para diagnosticar.
 * Sem causa ("por ansiedade"), sem total "perdido" e sem percentual de excesso: só o que foi observado,
 * as outras explicações possíveis e uma pergunta de contexto opcional.
 */
export function EmotionAssociationCard({ impact, onAskContext }: { impact: MoneyImpact; onAskContext: () => void }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  return (
    <section aria-label="Associação entre check-ins e gastos" className="rounded-[22px] border border-border bg-card p-4">
      <h3 className="font-display text-base font-bold tracking-tight">Check-ins e gastos: existe relação?</h3>
      {impact.sufficient ? (
        <>
          <p className="mt-2 text-[13px] leading-relaxed">
            Em {impact.sensitiveDays} check-ins de menor tranquilidade, o gasto registrado por perto foi de {reais(impact.sensitiveAvg)} em média; nos momentos mais tranquilos, {reais(impact.calmAvg)}.
          </p>
          <p className="mt-2 rounded-xl bg-secondary/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
            É uma <strong className="text-foreground">associação, não uma causa</strong>. A diferença pode vir do dia da semana, de compras necessárias, de valores atípicos ou de você registrar o check-in depois de gastar. Com {impact.pairedDays} check-ins, ainda não dá para afirmar nada além de que vale observar.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Há {impact.pairedDays} check-in{impact.pairedDays === 1 ? "" : "s"} com gasto por perto. Com {MONEY_IMPACT_MIN_DAYS}, o Nino consegue comparar momentos mais e menos tranquilos — sempre como associação, nunca como causa.
        </p>
      )}
      <p className="mt-2 text-[13px] leading-relaxed">Você percebe algum contexto em comum nesses momentos?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onAskContext} className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold">Contar contexto</button>
        <button type="button" onClick={() => { try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* sem armazenamento */ } setDismissed(true); }} className="min-h-11 px-3 text-sm text-muted-foreground">Não vejo relação</button>
      </div>
    </section>
  );
}
