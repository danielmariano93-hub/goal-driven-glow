import { useState } from "react";
import { formatBRL } from "@/lib/engine/facts";
import type { CycleStage } from "@/lib/engine/ticketAnalytics";
import { OWN_FILL, OWN_TEXT, TICKET_FILL, dm } from "./sourceStyle";

/** Quando seu bolso pesa mais: alimentação por etapa do ciclo, em média por dia (as etapas têm tamanhos diferentes),
 *  com a parte do Ticket e do bolso. Associação com o saldo é temporal, não motivo. */
export function CycleStageChart({ stages, finalOwnShare, depletion, onSelect }: {
  stages: CycleStage[];
  finalOwnShare: number | null;
  depletion: { reliable: boolean; low_days: number; own_low: number; own_total: number; share: number | null } | null;
  onSelect?: (label: string) => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  if (!stages.length) return null;
  const max = Math.max(1, ...stages.map((s) => s.total_per_day));
  const active = sel ?? stages.reduce((b, s, i) => (s.own_per_day > stages[b].own_per_day ? i : b), 0);
  const s = stages[active];
  return (
    <section className="surface-card flex flex-col gap-3 p-5" data-testid="ticket-cycle-stages">
      <div className="flex flex-col">
        <h2 className="font-bold">Quando seu bolso pesa mais</h2>
        <span className="text-xs text-muted-foreground">Média por dia em cada etapa do ciclo · Ticket e bolso</span>
      </div>
      <div role="group" aria-label="Alimentação por etapa do ciclo. Toque numa etapa para ver o detalhe." className="flex h-44 gap-2.5">
        {stages.map((st, i) => {
          const on = i === active;
          const tp = st.ticket_pct ?? 0;
          return (
            <button key={st.label} type="button" aria-pressed={on} onClick={() => { setSel(i); onSelect?.(st.label); }}
              aria-label={`${st.label}: média de ${formatBRL(st.total_per_day)} por dia, bolso ${formatBRL(st.own_per_day)} por dia`}
              className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="flex w-full flex-1 flex-col justify-end">
                <span className="mb-1 text-center text-[11px] font-bold tabular-nums text-muted-foreground">{Math.round(st.total_per_day)}</span>
                <span className={`flex w-full flex-col overflow-hidden rounded-xl transition-opacity ${on ? "opacity-100" : "opacity-55"}`} style={{ height: `${st.total > 0 ? Math.max(8, (st.total_per_day / max) * 100) : 8}%` }}>
                  {st.total === 0 ? <span className="flex-1 bg-muted" /> : (
                    <>
                      {st.own > 0 && <span className={`${OWN_FILL}`} style={{ flexGrow: 100 - tp }} />}
                      {st.ticket > 0 && <span className={`${TICKET_FILL}`} style={{ flexGrow: tp }} />}
                    </>
                  )}
                </span>
              </span>
              <span className={`text-center text-[11px] leading-tight ${on ? "font-bold text-primary" : "text-muted-foreground"}`}>{st.label.replace("Dia 22 ao fim", "22 ao fim").replace("Dias ", "")}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-muted/50 p-3 text-[13px] tabular-nums" data-testid="ticket-cycle-stage-detail">
        <div className="font-semibold">{s.label} · {dm(s.from)} a {dm(s.to)} ({s.days} {s.days === 1 ? "dia" : "dias"})</div>
        <div className="flex justify-between"><span>Ticket</span><span>{formatBRL(s.ticket)}</span></div>
        <div className="flex justify-between"><span className={OWN_TEXT}>Bolso</span><span>{formatBRL(s.own)} · {formatBRL(s.own_per_day)}/dia</span></div>
        <div className="flex justify-between"><span>Parte do Ticket</span><span>{s.ticket_pct === null ? "—" : `${Math.round(s.ticket_pct)}%`}</span></div>
      </div>
      <div className="text-[13px] leading-relaxed">
        {finalOwnShare !== null && <p><strong className="font-semibold">{finalOwnShare}% do bolso</strong> saiu do dia 22 em diante.</p>}
        {depletion && depletion.reliable && depletion.own_total > 0 && (
          <p className="text-muted-foreground">
            {depletion.low_days > 0
              ? `Em ${depletion.low_days} ${depletion.low_days === 1 ? "dia" : "dias"} o Ticket começou o dia com menos que um dia típico de consumo; nesses dias saíram ${formatBRL(depletion.own_low)} do bolso (${depletion.share}% do bolso no período).`
              : "O Ticket não ficou abaixo de um dia típico de consumo neste período."}
            {" "}Isso mostra coincidência no tempo, não o motivo da escolha.
          </p>
        )}
        {depletion && !depletion.reliable && <p className="text-xs text-muted-foreground">Sem saldo histórico confiável para todo o período: não dá para dizer se o bolso entrou depois de o Ticket acabar.</p>}
      </div>
    </section>
  );
}
