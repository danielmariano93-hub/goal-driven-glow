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
            Nos {impact.sensitiveDays} check-ins em que você estava menos tranquilo, você gastou em média {reais(impact.sensitiveAvg)} por perto. Nos momentos mais tranquilos, {reais(impact.calmAvg)}.
          </p>
          <p className="mt-2 rounded-xl bg-secondary/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
            Isso mostra uma <strong className="text-foreground">coincidência, não uma causa</strong>. A diferença pode vir do dia da semana, de uma compra necessária, de um gasto fora do comum ou de você fazer o check-in depois de gastar.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {impact.pairedDays === 1 ? "Tenho 1 check-in com gasto por perto" : `Tenho ${impact.pairedDays} check-ins com gasto por perto`}. Com {MONEY_IMPACT_MIN_DAYS}, consigo comparar os momentos mais e menos tranquilos. Isso mostra uma coincidência, nunca uma causa.
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
