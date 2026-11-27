import { useEffect, useMemo, useRef, useState } from "react";
import { formatBRL } from "@/lib/engine/facts";
import { restDaysText, restDaysToFit } from "@/lib/engine/restDays";
import {
  balanceSeries, benefitAddDays, computeBalance, computeBenefitState, foodSourceByCycle, merchantBreakdown, suggestions, ticketCycles, weekdayPattern, whatIf,
  type BenefitStatus, type BenefitWalletConfig,
} from "@/lib/engine/benefitWallet";
import {
  backtestForecast, cycleStages, dailyKpis, knownWindow, merchantRanking, ownAfterDepletion, performance, sourceSwap, ticketFoodRows, weekdayAverages, weekdayCapOpportunity, weekdayForecast, weekdayPeak,
  WEEKDAY_FULL, WEEKDAY_PLURAL, type FoodRow, type SourceFilter, type StatementRow,
} from "@/lib/engine/ticketAnalytics";
import type { BenefitEntryRow, OwnFoodRow } from "@/lib/db/benefitWallet";
import { todayLine } from "@/lib/ticket/todayLine";
import { trackTicket } from "@/lib/analytics/ticketEvents";
import { CycleStageChart } from "./CycleStageChart";
import { BurnDownChart } from "./BurnDownChart";
import { CycleSelector } from "./CycleSelector";
import { isEditableBenefitEntry, type Mode as EntryMode } from "./EntrySheet";
import { MerchantRanking } from "./MerchantRanking";
import { PerformanceGrid } from "./PerformanceGrid";
import { SourceFilterChips } from "./SourceFilterChips";
import { TicketStatement, EMPTY_STATEMENT_FILTERS, type StatementFilterState } from "./TicketStatement";
import { TicketVsOwnChart } from "./TicketVsOwnChart";
import { WeekdayAvgChart } from "./WeekdayAvgChart";
import { dm } from "./sourceStyle";

const brl2 = (n: number) => formatBRL(n);
const num1 = (n: number) => n.toFixed(1).replace(".", ",");

const PILL: Record<BenefitStatus, { text: string; cls: string; dot: string }> = {
  ok: { text: "Fecha o ciclo", cls: "bg-success/15 text-success", dot: "bg-success" },
  tight: { text: "Margem curta", cls: "bg-warning/20 text-foreground", dot: "bg-warning" },
  short: { text: "Vai faltar", cls: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
  unknown: { text: "Sem ritmo ainda", cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

export type TicketTab = "resumo" | "analises" | "extrato";

export interface TicketViewProps {
  wallet: BenefitWalletConfig;
  entries: BenefitEntryRow[];
  own: OwnFoodRow[];
  /** false enquanto os gastos do bolso carregam: as análises de fonte esperam, o saldo não. */
  ownReady: boolean;
  today: string;
  onAdd: (mode: EntryMode) => void;
  onEdit: (entry: BenefitEntryRow) => void;
  onRemove: (id: string) => void;
  removing: boolean;
  initialTab?: TicketTab;
  /** Ciclo escolhido em Análises/Extrato (início do ciclo), vindo do endereço da página. */
  initialCycleStart?: string | null;
  /** Avisa a página para guardar aba e ciclo no endereço (voltar e recarregar mantêm o estado). */
  onStateChange?: (s: { tab: TicketTab; cycleStart: string | null }) => void;
}

const FILTERS_KEY = "nino.ticket.filters.v1";
const DISMISSED_KEY = "nino.ticket.dismissed.v1";
type SavedFilters = { weekSource: SourceFilter; rankSort: SourceFilter; stmt: StatementFilterState };
function readSaved(): Partial<SavedFilters> {
  try { return JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? "{}") as Partial<SavedFilters>; } catch { return {}; }
}
function readDismissed(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

/** Ticket Alimentação em três abas: Resumo (saldo, ritmo, projeção, desempenho, uma ação), Análises (quando, de que
 *  fonte, onde e oportunidades, por ciclo) e Extrato (lista única com filtros). Só leitura: o que grava continua nos
 *  fluxos existentes de registrar, editar e excluir. */
export function TicketView({ wallet, entries, own, ownReady, today, onAdd, onEdit, onRemove, removing, initialTab = "resumo", initialCycleStart = null, onStateChange }: TicketViewProps) {
  const [tab, setTabState] = useState<TicketTab>(initialTab);
  const saved = useRef(readSaved()).current;
  const scrollMemo = useRef<Record<TicketTab, number>>({ resumo: 0, analises: 0, extrato: 0 });
  const setTab = (t: TicketTab) => {
    scrollMemo.current[tab] = typeof window !== "undefined" ? window.scrollY : 0;
    setTabState(t);
    trackTicket("ticket_tab_view", { tab: t });
  };
  useEffect(() => { if (typeof window !== "undefined") window.scrollTo({ top: scrollMemo.current[tab] ?? 0 }); }, [tab]);

  const [rate, setRate] = useState<number | null>(null);
  const [weekSource, setWeekSource] = useState<SourceFilter>(saved.weekSource ?? "ticket");
  const [weekSel, setWeekSel] = useState<number | null>(null);
  const [rankSort, setRankSort] = useState<SourceFilter>(saved.rankSort ?? "total");
  const [stmtFilters, setStmtFilters] = useState<StatementFilterState>({ ...EMPTY_STATEMENT_FILTERS, ...(saved.stmt ?? {}) });
  const [cycleIdx, setCycleIdx] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  useEffect(() => {
    try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ weekSource, rankSort, stmt: stmtFilters })); } catch { /* sem armazenamento: só não lembra */ }
  }, [weekSource, rankSort, stmtFilters]);

  const m = useMemo(() => {
    const state = computeBenefitState(wallet, entries, today);
    const pattern = weekdayPattern(entries, today);
    const tips = suggestions(state, pattern, merchantBreakdown(entries, state.cycle.start, today));
    const cycles = ticketCycles(wallet, entries, today);
    const rows: FoodRow[] = [...ticketFoodRows(entries), ...own.map((o) => ({ id: o.id, date: o.occurred_at, amount: Math.abs(o.amount), source: "own" as const, merchant: o.merchant }))];
    const spentToday = rows.some((r) => r.source === "ticket" && r.date === today);
    let def = cycles.length - 1;
    const curWin = def >= 0 ? knownWindow(cycles[def], today, spentToday) : null;
    if (def > 0 && (!curWin || curWin.days < 7)) def -= 1;
    const bySource = foodSourceByCycle(wallet, entries, own.map((o) => ({ occurred_at: o.occurred_at, amount: o.amount })), today);
    const statement: StatementRow[] = [
      ...entries.map((e) => ({
        id: e.id, date: e.occurred_on, source: "ticket" as const,
        kind: e.kind === "spend" ? "purchase" as const : e.kind === "credit" ? "credit" as const : e.kind === "balance_reading" ? "reading" as const : "adjustment" as const,
        merchant: e.merchant ?? null, amount: e.amount, note: e.note ?? null, editable: isEditableBenefitEntry(e),
      })),
      ...own.map((o) => ({ id: o.id, date: o.occurred_at, source: "own" as const, kind: "purchase" as const, merchant: o.merchant, amount: Math.abs(o.amount), editable: false })),
    ];
    const initial = initialCycleStart ? cycles.findIndex((c) => c.start === initialCycleStart) : -1;
    const backtest = backtestForecast(cycles, rows);
    return { state, tips, cycles, rows, spentToday, defaultIdx: def, initialIdx: initial >= 0 ? initial : null, bySource, statement, backtest, series: balanceSeries(wallet, entries, today) };
    // initialCycleStart só vale na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, entries, own, today]);

  const { state, tips, cycles, rows, spentToday, defaultIdx, initialIdx, bySource, statement, series, backtest } = m;
  const idx = Math.min(cycleIdx ?? initialIdx ?? defaultIdx, cycles.length - 1);
  const cyc = cycles[idx];
  const prevCyc = idx > 0 ? cycles[idx - 1] : null;
  const win = cyc ? knownWindow(cyc, today, spentToday) : null;
  const prevWin = prevCyc && !prevCyc.incomplete && cyc && !cyc.incomplete ? knownWindow(prevCyc, today, spentToday) : null;
  const perfSel = cycles.length ? performance(cycles, idx, rows, today, spentToday) : null;
  const perfResumo = cycles.length ? performance(cycles, defaultIdx, rows, today, spentToday) : null;
  const weekData = win ? weekdayAverages(rows, weekSource, win.from, win.to) : null;
  const weekPrev = prevWin ? weekdayAverages(rows, weekSource, prevWin.from, prevWin.to) : null;
  const peak = weekData ? weekdayPeak(weekData) : null;
  const ranking = win ? merchantRanking(rows, win, perfSel?.previous ? { from: perfSel.previous.from, to: perfSel.previous.to } : null, rankSort) : [];
  const stages = cyc && win ? cycleStages(rows, cyc.start, win) : null;
  const depletion = cyc && win ? ownAfterDepletion(rows, win, Math.max(1, (perfSel?.current.ticket_per_day ?? 0)), (d) => {
    if (d < (cyc.data_from ?? cyc.start)) return null;
    return computeBalance(wallet, entries, d).balance;
  }) : null;
  useEffect(() => { onStateChange?.({ tab, cycleStart: cycleIdx !== null || initialIdx !== null ? cyc?.start ?? null : null }); }, [tab, cyc?.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const cycleRange = cyc ? { from: cyc.start, to: cyc.end, label: `Ciclo ${dm(cyc.start)} a ${dm(cyc.open ? today : cyc.end)}` } : null;

  const openStatement = (patch: Partial<StatementFilterState>, target: string) => { trackTicket("drilldown_open", { target }); setStmtFilters({ ...EMPTY_STATEMENT_FILTERS, ...patch }); setTab("extrato"); };
  const chooseCycle = (i: number) => { setCycleIdx(i); trackTicket("chart_select", { chart: "cycle" }); };

  // ---- Resumo
  const proj = state.projection;
  const pill = PILL[proj?.status ?? "unknown"];
  const opening = wallet.monthly_credit + (state.carry_in ?? 0);
  const usedPct = opening > 0 ? Math.min(100, Math.round((state.spent_in_cycle / opening) * 100)) : 0;
  const k = dailyKpis(state);
  const simActive = rate !== null && Math.abs(rate - state.rate.per_day) > 0.005;
  const sim = rate !== null ? whatIf(state, rate) : null;
  const rest = state.balance !== null && state.rate.per_day > 0 ? restDaysToFit(state.balance, state.cycle.days_left, state.rate.per_day) : null;
  const tl = todayLine(state, brl2, dm);
  const curCycle = cycles[cycles.length - 1];
  const capCycle = cycles[defaultIdx];
  const capWin = capCycle ? knownWindow(capCycle, today, spentToday) : null;
  const capOpp = capWin ? weekdayCapOpportunity(weekdayAverages(rows, "ticket", capWin.from, capWin.to)) : null;
  const wkNow = curCycle && state.balance !== null && state.cycle.days_left > 0 ? weekdayForecast(rows, today, benefitAddDays(state.cycle.next, -1)) : null;
  const swap = ownReady && perfResumo?.cycle.open ? sourceSwap(merchantRanking(rows, perfResumo.window, null), proj?.leftover ?? null) : null;
  const opps = [
    ...(capOpp && capWin ? [{
      id: "weekday_cap", title: `Teto de ${brl2(capOpp.cap)} às ${WEEKDAY_PLURAL[capOpp.weekday]}`,
      body: `No ciclo de ${dm(capWin.from)} a ${dm(capWin.to)}, ${WEEKDAY_FULL[capOpp.weekday].toLowerCase()} custou em média ${brl2(capOpp.avg)} por dia no Ticket, ${num1(capOpp.ratio)} vezes a média dos outros dias (${brl2(capOpp.others_avg)}). Com esse teto, você segura cerca de ${brl2(capOpp.monthly)} por ciclo.`,
      badge: `~ ${brl2(capOpp.monthly)}/ciclo`, cta: null as null | { label: string; run: () => void },
    }] : []),
    ...tips.filter((t) => t.id !== "weekday_cap").map((t) => ({ id: t.id as string, title: t.title, body: t.body, badge: t.monthly_saving !== null ? `~ ${brl2(t.monthly_saving)}/mês` : null, cta: null as null | { label: string; run: () => void } })),
    ...(swap ? [{
      id: "source_swap", title: "Pagar com Ticket onde ele já é aceito",
      body: `Neste período saíram ${brl2(swap.amount)}${swap.capped ? " (limitado ao que deve sobrar no Ticket)" : ""} do bolso em lugares onde você já usou o Ticket: ${swap.merchants.join(", ")}. Não é economia: o gasto é o mesmo, só muda a fonte.`,
      badge: null, cta: { label: "Ver por gasto do bolso", run: () => { setRankSort("own"); setTab("analises"); } },
    }] : []),
  ].filter((o) => !dismissed.includes(`${o.id}:${state.cycle.start}`));
  const dismiss = (id: string) => {
    const next = [...dismissed, `${id}:${state.cycle.start}`];
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50))); } catch { /* sem armazenamento */ }
    trackTicket("opportunity_action", { opportunity: id, action: "dismiss" });
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Seções do Ticket" className="flex gap-1.5 rounded-2xl bg-muted p-1">
        {([["resumo", "Resumo"], ["analises", "Análises"], ["extrato", "Extrato"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`min-h-11 flex-1 rounded-xl text-sm font-semibold ${tab === id ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab !== "resumo" && cycles.length > 0 && <CycleSelector cycles={cycles} index={idx} onChange={chooseCycle} today={today} />}

      {tab === "resumo" && (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <div className="flex flex-col gap-4">
            <section className="surface-card flex flex-col gap-3 p-5" data-testid="ticket-hero">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Saldo disponível</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.cls}`}><span className={`h-2 w-2 rounded-full ${pill.dot}`} />{pill.text}</span>
              </div>
              {state.balance === null ? (
                <button onClick={() => onAdd("reading")} className="btn-brand min-h-12">Informar o saldo de hoje</button>
              ) : (
                <>
                  <div>
                    <div className="text-4xl font-bold tracking-tight tabular-nums">{brl2(state.balance)}</div>
                    <div className="text-xs text-muted-foreground">
                      {state.estimated ? `Estimado para hoje · última leitura há ${state.reading_age_days} ${state.reading_age_days === 1 ? "dia" : "dias"}` : "Saldo informado hoje"}
                    </div>
                  </div>
                  <div className="text-sm">Próxima recarga prevista em <strong className="font-semibold">{dm(state.cycle.next)}</strong> · {state.cycle.days_left} {state.cycle.days_left === 1 ? "dia" : "dias"} de consumo até lá</div>
                  <div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} /></div>
                    <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>{brl2(state.spent_in_cycle)} gastos de {brl2(opening)}</span>
                      <span>{state.cycle.elapsed_days} de {state.cycle.total_days} dias</span>
                    </div>
                  </div>
                  {state.inconsistent && <p className="rounded-xl bg-warning/15 p-3 text-sm">O saldo calculado ficou negativo: falta lançar algum gasto ou atualizar o saldo.</p>}
                  {(state.reading_age_days ?? 0) > 7 && <p className="rounded-xl bg-muted/50 p-3 text-sm">Saldo informado há mais de uma semana. <button type="button" onClick={() => onAdd("reading")} className="font-semibold text-primary">Atualizar saldo</button></p>}
                  <details className="rounded-xl bg-muted/50 px-3 py-2 text-sm">
                    <summary className="min-h-9 cursor-pointer py-1.5 font-semibold">Como chegamos a esse saldo</summary>
                    <dl className="pb-1">
                      {state.carry_in !== null && state.carry_in > 0 && <div className="flex justify-between border-b border-border py-2"><dt>Sobra do ciclo anterior</dt><dd className="font-semibold text-success">+ {brl2(state.carry_in)}</dd></div>}
                      <div className="flex justify-between border-b border-border py-2"><dt>Crédito de {dm(state.cycle.start)}</dt><dd className="font-semibold text-success">+ {brl2(wallet.monthly_credit)}</dd></div>
                      <div className="flex justify-between border-b border-border py-2"><dt>Gastos lançados</dt><dd className="font-semibold">− {brl2(state.spent_in_cycle)}</dd></div>
                      <div className="flex justify-between pt-2"><dt className="font-semibold">Saldo agora</dt><dd className="font-bold">{brl2(state.balance)}</dd></div>
                    </dl>
                  </details>
                </>
              )}
            </section>

            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Registrar no Ticket">
              <button type="button" onClick={() => onAdd("spend")} className="btn-brand min-h-12 px-2 text-sm">Registrar gasto</button>
              <button type="button" onClick={() => onAdd("reading")} className="min-h-12 rounded-xl border border-border bg-card px-2 text-sm font-semibold">Saldo agora</button>
              <button type="button" onClick={() => onAdd("credit")} className="min-h-12 rounded-xl border border-border bg-card px-2 text-sm font-semibold">Entrou crédito</button>
            </div>

            {state.balance !== null && (
              <>
                <div className="grid grid-cols-2 gap-2.5" data-testid="ticket-daily-kpis">
                  {[
                    ["Ritmo", k.rate !== null ? `${brl2(k.rate)}/dia` : "—", k.rate !== null ? `média dos últimos ${state.rate.days_observed} dias fechados` : "sem histórico suficiente"],
                    ["Limite diário", k.limit !== null ? `${brl2(k.limit)}/dia` : "—", "saldo ÷ dias até a recarga"],
                    ["Margem diária", k.margin !== null ? `${k.margin >= 0 ? "+" : "−"}${brl2(Math.abs(k.margin))}` : "—", k.margin === null ? "precisa de ritmo" : k.margin >= 0 ? "folga no modelo, não meta de gasto" : "acima do limite"],
                    ["Autonomia", k.autonomy_days !== null ? `${num1(k.autonomy_days)} dias` : "—", k.autonomy_days === null ? "sem estimativa de esgotamento" : k.uncovered_days ? `${num1(k.uncovered_days)} de ${k.days_left} dias sem cobertura` : `cobre os ${k.days_left} dias até a recarga`],
                  ].map(([kk, v, s]) => (
                    <div key={kk} className="surface-card p-3"><div className="text-xs text-muted-foreground">{kk}</div><div className="mt-1 text-[20px] font-bold tabular-nums leading-tight">{v}</div><div className="text-[11px] leading-snug text-muted-foreground">{s}</div></div>
                  ))}
                </div>
                {tl ? <p className="px-1 text-sm text-muted-foreground" data-testid="ticket-today-remaining">{tl}</p> : null}
                {rest ? <p className="px-1 text-sm text-muted-foreground" data-testid="ticket-rest-days">{restDaysText(rest)}</p> : null}

                <section className="surface-card flex flex-col gap-3 p-5" data-testid="ticket-forecast">
                  <div className="flex items-baseline justify-between"><h2 className="font-bold">Como o ciclo fecha</h2><span className="text-xs text-muted-foreground">{dm(state.cycle.start)} a {dm(state.cycle.next)}</span></div>
                  <div className="mx-auto w-full max-w-[460px]"><BurnDownChart series={series} state={state} opening={opening} simRate={simActive ? rate : null} /></div>
                  <p className="text-sm leading-relaxed">
                    {!proj || proj.status === "unknown"
                      ? "Registre alguns gastos, ou mais uma leitura de saldo, para eu estimar o ritmo."
                      : proj.depletion_date
                        ? <>No ritmo de {brl2(state.rate.per_day)}/dia, o saldo acaba em <strong className="font-semibold">{dm(proj.depletion_date)}</strong>. Faltariam cerca de {brl2(proj.shortfall)} até a recarga, se o consumo continuar assim.</>
                        : <>No ritmo de {brl2(state.rate.per_day)}/dia, sobram cerca de <strong className="font-semibold">{brl2(proj.leftover)}</strong> antes da recarga{wallet.carries_over ? ", e a sobra passa para o próximo ciclo" : ""}.</>}
                  </p>
                  <ForecastModelNote backtest={backtest} weekdayNow={wkNow} balance={state.day_start_balance} until={benefitAddDays(state.cycle.next, -1)} />
                  {k.rate !== null && (
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <label htmlFor="ticket-sim-rate" className="text-sm font-semibold">E se eu gastar por dia...</label>
                      <div className="flex flex-wrap gap-2">
                        {[["Atual", state.rate.per_day], ["Limite diário", k.limit ?? 0]].filter(([, v]) => (v as number) > 0).map(([l, v]) => (
                          <button key={l as string} type="button" onClick={() => { setRate(Math.round((v as number) * 100) / 100); trackTicket("simulation_change", { action: l === "Atual" ? "preset_current" : "preset_limit" }); }} aria-pressed={rate !== null && Math.abs(rate - (v as number)) < 0.01}
                            className={`min-h-11 rounded-xl border-2 px-3 text-sm font-semibold ${rate !== null && Math.abs(rate - (v as number)) < 0.01 ? "border-primary bg-accent text-accent-foreground" : "border-border"}`}>{l as string} · {brl2(v as number)}</button>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <input id="ticket-sim-rate" type="range" min={0} max={Math.max(10, Math.ceil(Math.max(state.rate.per_day, k.limit ?? 0) * 2))} step={1}
                          value={Math.round(rate ?? state.rate.per_day)} onChange={(e) => setRate(Number(e.target.value))} onPointerUp={() => trackTicket("simulation_change", { action: "slider" })} className="flex-1 accent-[hsl(var(--primary))]" aria-label="Gasto diário simulado" />
                        <input type="number" inputMode="decimal" min={0} step="0.01" value={rate ?? ""} placeholder={state.rate.per_day.toFixed(2)}
                          onChange={(e) => setRate(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))} onBlur={() => trackTicket("simulation_change", { action: "input" })} aria-label="Gasto diário simulado em reais"
                          className="h-11 w-24 rounded-xl border border-border bg-card px-2 text-right text-sm tabular-nums" />
                      </div>
                      {sim && simActive && (
                        <p className="text-sm leading-relaxed" data-testid="ticket-sim-result">
                          {sim.depletion_date
                            ? <>A {brl2(rate!)}/dia, o saldo dura {num1(sim.covers_days ?? 0)} dias e acaba em {dm(sim.depletion_date)}: faltariam cerca de {brl2(sim.shortfall)} até a recarga.</>
                            : <>A {brl2(rate!)}/dia, o ciclo fecha e sobram cerca de {brl2(sim.leftover)}.</>}
                          {" "}<button type="button" onClick={() => { setRate(null); trackTicket("simulation_change", { action: "reset" }); }} className="font-semibold text-primary">Voltar à previsão</button>
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">Simulação local: não muda metas nem lançamentos.</p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {perfResumo && ownReady && (
              <PerformanceGrid perf={perfResumo} title={perfResumo.cycle.open ? "Desempenho do ciclo atual" : "Desempenho do último ciclo encerrado"} />
            )}
            {opps[0] && (
              <section className="surface-card flex flex-col gap-1.5 p-5" data-testid="ticket-priority-action">
                <span className="text-xs font-semibold text-primary">Sua próxima ação</span>
                <strong className="text-[15px] font-semibold">{opps[0].title}</strong>
                <span className="text-[13px] leading-relaxed text-muted-foreground">{opps[0].body}</span>
                <div className="mt-1 flex flex-wrap gap-3">
                  {opps.length > 1 && <button type="button" onClick={() => setTab("analises")} className="text-sm font-semibold text-primary">Ver todas as oportunidades</button>}
                  <button type="button" onClick={() => dismiss(opps[0].id)} className="text-sm font-semibold text-muted-foreground">Dispensar</button>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {tab === "analises" && cyc && (
        <div className="flex flex-col gap-4">
          {!ownReady && <p className="surface-card p-4 text-sm text-muted-foreground">Carregando os gastos de alimentação das suas contas…</p>}
          {weekData && (
            <section className="surface-card flex flex-col gap-3 p-5" data-testid="ticket-weekday">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">Quando você mais gasta</h2>
                <SourceFilterChips value={weekSource} onChange={(s) => { setWeekSource(s); trackTicket("chart_select", { chart: "weekday_source", source: s }); }} label="Fonte do gasto" />
              </div>
              <span className="-mt-2 text-xs text-muted-foreground tabular-nums">Média por dia, dias sem compra contam como zero · {dm(weekData.from)} a {dm(weekData.to)} ({weekData.days} dias){weekPrev ? " · traço = ciclo anterior" : ""}</span>
              <WeekdayAvgChart data={weekData} previous={weekPrev} selected={weekSel} onSelect={(wd) => { setWeekSel(wd); trackTicket("chart_select", { chart: "weekday" }); }} />
              {weekSel !== null && (
                <button type="button" onClick={() => openStatement({ weekday: weekSel, source: weekSource, cycleOnly: true }, "weekday")} className="min-h-11 rounded-xl border border-border text-sm font-semibold">
                  Ver lançamentos de {WEEKDAY_PLURAL[weekSel]}
                </button>
              )}
              <div className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed" data-testid="ticket-weekday-insight">
                <span className="text-xs font-semibold text-muted-foreground">No período</span>
                {peak
                  ? <div><strong className="font-semibold">{WEEKDAY_FULL[peak.weekday]} pesa {peak.share_pct}% do gasto.</strong> <span className="text-muted-foreground">Em média {brl2(peak.avg)} por dia, {num1(peak.ratio)} vezes a média dos outros dias ({brl2(peak.others_avg)}).</span></div>
                  : <div className="text-muted-foreground">Em observação: preciso de pelo menos 4 ocorrências de cada dia neste ciclo para apontar um padrão.</div>}
              </div>
            </section>
          )}
          {ownReady && bySource.length > 0 && (
            <TicketVsOwnChart cycles={bySource} today={today} selectedStart={cyc.start} onSelect={(start) => { const i = cycles.findIndex((c) => c.start === start); if (i >= 0) chooseCycle(i); }} />
          )}
          {ownReady && win && (
            <MerchantRanking rows={ranking} sortBy={rankSort} onSort={setRankSort} hasPrevious={!!perfSel?.previous}
              onOpen={(key, label) => openStatement({ merchantKey: key, merchantLabel: label, cycleOnly: true }, "merchant")}
              onExpand={() => trackTicket("chart_select", { chart: "merchant" })} />
          )}
          {ownReady && stages && stages.stages.length > 0 && (
            <CycleStageChart stages={stages.stages} finalOwnShare={stages.final_own_share} depletion={depletion} onSelect={() => trackTicket("chart_select", { chart: "cycle_stage" })} />
          )}
          <section className="flex flex-col gap-2.5" data-testid="ticket-opportunities">
            <h2 className="px-1 font-bold">Oportunidades</h2>
            {opps.length === 0 && <p className="surface-card p-4 text-sm text-muted-foreground">Em observação: ainda não há sinal forte o bastante para sugerir uma ação.</p>}
            {opps.map((o) => (
              <div key={o.id} className="surface-card flex flex-col gap-2 p-4" data-testid={`ticket-opportunity-${o.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1"><strong className="text-[15px] font-semibold">{o.title}</strong><span className="text-[13px] leading-relaxed text-muted-foreground">{o.body}</span></div>
                  {o.badge && <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[13px] font-bold tabular-nums">{o.badge}</span>}
                </div>
                <div className="flex flex-wrap gap-3">
                  {o.cta && <button type="button" onClick={() => { trackTicket("opportunity_action", { opportunity: o.id, action: "cta" }); o.cta!.run(); }} className="min-h-9 text-sm font-semibold text-primary">{o.cta.label}</button>}
                  <button type="button" onClick={() => dismiss(o.id)} className="min-h-9 text-sm font-semibold text-muted-foreground">Dispensar</button>
                </div>
              </div>
            ))}
            {dismissed.some((d) => d.endsWith(`:${state.cycle.start}`)) && (
              <button type="button" onClick={() => { const next = dismissed.filter((d) => !d.endsWith(`:${state.cycle.start}`)); setDismissed(next); try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* sem armazenamento */ } }}
                className="self-start px-1 text-xs font-semibold text-primary">Mostrar as dispensadas</button>
            )}
            <p className="px-1 text-xs text-muted-foreground">Estimativas a partir do último ciclo com dados suficientes; não somam entre si e não são economia garantida.</p>
          </section>
        </div>
      )}

      {tab === "extrato" && (
        <TicketStatement rows={statement} filters={stmtFilters} onChange={setStmtFilters} cycleRange={cycleRange}
          onEdit={(id) => { const e = entries.find((x) => x.id === id); if (e) onEdit(e); }} onRemove={onRemove} removing={removing} />
      )}

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">O saldo do Ticket fica separado do seu caixa livre, da renda e do patrimônio. Os gastos do bolso aparecem aqui só para comparar; eles continuam contados em Meu mês como sempre.</p>
    </div>
  );
}

/** Previsão por dia da semana (P2): só substitui o ritmo constante se ganhou no teste retroativo; até lá, aparece
 *  como teste, com versão, horizonte e erro médio de cada modelo. */
function ForecastModelNote({ backtest, weekdayNow, balance, until }: { backtest: ReturnType<typeof backtestForecast>; weekdayNow: number | null; balance: number | null; until: string }) {
  if (weekdayNow === null || balance === null) return null;
  const left = Math.round((balance - weekdayNow) * 100) / 100;
  const n = backtest.cases.length;
  return (
    <div className="rounded-xl bg-muted/50 p-3 text-[13px] leading-relaxed" data-testid="ticket-forecast-model">
      <div>
        Considerando o dia da semana, o consumo até {dm(until)} seria de {formatBRL(weekdayNow)}:{" "}
        {left >= 0 ? <>sobrariam cerca de {formatBRL(left)}.</> : <>faltariam cerca de {formatBRL(-left)}.</>}
      </div>
      <div className="text-xs text-muted-foreground">
        {n === 0
          ? "Modelo em teste: ainda não há ciclo encerrado com histórico suficiente para comparar."
          : `${backtest.better ? "Este modelo errou menos" : "Ainda em teste: o ritmo constante continua sendo a previsão oficial"} · ${n} ${n === 1 ? "ciclo testado" : "ciclos testados"} a partir do dia ${backtest.cut_day}, erro médio ${formatBRL(backtest.mae_weekday ?? 0)} contra ${formatBRL(backtest.mae_constant ?? 0)} do ritmo constante.`}
      </div>
    </div>
  );
}
