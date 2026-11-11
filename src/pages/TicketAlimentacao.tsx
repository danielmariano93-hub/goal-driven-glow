import { todayLine } from "@/lib/ticket/todayLine";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import {
  balanceSeries, computeBenefitState, merchantBreakdown, suggestions, weekdayPattern, whatIf,
  type BenefitStatus,
} from "@/lib/engine/benefitWallet";
import { useBenefitEnabled, useBenefitEntries, type BenefitEntryRow, useBenefitFoodLeak, useBenefitWallet, useDeleteBenefitEntry } from "@/lib/db/benefitWallet";
import { BurnDownChart } from "@/components/ticket/BurnDownChart";
import { WeekdayBars } from "@/components/ticket/WeekdayBars";
import { EntrySheet, isEditableBenefitEntry, type Mode as EntryMode } from "@/components/ticket/EntrySheet";
import { StatementImportSheet } from "@/components/ticket/StatementImportSheet";
import { SetupWallet } from "@/components/ticket/SetupWallet";

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const brl2 = (n: number) => formatBRL(n);

const PILL: Record<BenefitStatus, { text: string; cls: string; dot: string }> = {
  ok: { text: "Fecha o ciclo", cls: "bg-success/15 text-success", dot: "bg-success" },
  tight: { text: "Margem curta", cls: "bg-warning/20 text-foreground", dot: "bg-warning" },
  short: { text: "Vai faltar", cls: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
  unknown: { text: "Sem ritmo ainda", cls: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};
const KIND_LABEL = { credit: "Crédito", spend: "Gasto", balance_reading: "Saldo informado", adjustment: "Ajuste" } as const;

export default function TicketAlimentacao() {
  const enabled = useBenefitEnabled();
  const walletQ = useBenefitWallet(enabled.data === true);
  const entriesQ = useBenefitEntries(walletQ.data?.id);
  const remove = useDeleteBenefitEntry(walletQ.data?.id);
  const cycleStartForLeak = useMemo(() => (walletQ.data ? computeBenefitState(walletQ.data, entriesQ.data ?? [], todayISO()).cycle.start : undefined), [walletQ.data, entriesQ.data]);
  const leak = useBenefitFoodLeak(cycleStartForLeak, todayISO(), !!walletQ.data);
  const today = todayISO();
  const [tab, setTab] = useState<"resumo" | "padroes">("resumo");
  const [sheet, setSheet] = useState(false);
  const [sheetMode, setSheetMode] = useState<EntryMode>("spend");
  const openSheet = (m: EntryMode) => { setSheetMode(m); setSheet(true); };
  const [editing, setEditing] = useState<BenefitEntryRow | null>(null);
  const [importing, setImporting] = useState(false);
  const [rate, setRate] = useState<number | null>(null);

  const wallet = walletQ.data;
  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const view = useMemo(() => {
    if (!wallet) return null;
    const state = computeBenefitState(wallet, entries, today);
    const pattern = weekdayPattern(entries, today);
    const merchants = merchantBreakdown(entries, state.cycle.start, today);
    return {
      state, pattern, merchants,
      series: balanceSeries(wallet, entries, today),
      tips: suggestions(state, pattern, merchants),
      hasSpends: entries.some((e) => e.kind === "spend"),
    };
  }, [wallet, entries, today]);

  if (enabled.isLoading || (enabled.data && walletQ.isLoading)) return <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!enabled.data) return <Navigate to="/app" replace />;

  const header = (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link to="/app" aria-label="Voltar" className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><ArrowLeft size={20} /></Link>
        <h1 className="font-display text-xl font-bold">Ticket Alimentação</h1>
      </div>
      {wallet && (
        <div className="flex items-center gap-2">
          <button onClick={() => setImporting(true)} className="min-h-11 rounded-full border border-border px-3 text-sm font-semibold">Importar extrato</button>
          <button onClick={() => openSheet("spend")} aria-label="Registrar gasto" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground"><Plus size={20} /></button>
        </div>
      )}
    </header>
  );

  if (!wallet || !view) {
    return <div className="mx-auto flex max-w-2xl flex-col gap-4">{header}<SetupWallet today={today} /></div>;
  }

  const { state, pattern, merchants, series, tips, hasSpends } = view;
  const proj = state.projection;
  const pill = PILL[proj?.status ?? "unknown"];
  const opening = wallet.monthly_credit + (state.carry_in ?? 0);
  const usedPct = opening > 0 ? Math.min(100, Math.round((state.spent_in_cycle / opening) * 100)) : 0;

  const headline = state.needs_reading
    ? "Informe o saldo de hoje para eu calcular o ritmo."
    : !proj || proj.status === "unknown"
      ? "Registre alguns gastos, ou mais uma leitura de saldo, para eu estimar o ritmo."
      : proj.depletion_date
        ? `No ritmo de ${brl2(state.rate.per_day)}/dia, o Ticket cobre até ${dm(proj.depletion_date)}.`
        : `No ritmo de ${brl2(state.rate.per_day)}/dia, o Ticket cobre o ciclo inteiro.`;
  const subline = !proj || proj.status === "unknown"
    ? ""
    : proj.depletion_date
      ? `Faltam ${Math.round(proj.uncovered_days)} dias até o crédito de ${dm(state.cycle.next)}: cerca de ${brl2(proj.shortfall)} sairiam do seu bolso.`
      : wallet.carries_over
        ? `Sobram cerca de ${brl2(proj.leftover)}, que passam para o próximo mês.`
        : `Sobram cerca de ${brl2(proj.leftover)}, que não passam para o próximo mês.`;

  const ideal = state.ideal_per_day ?? 0;
  const chipValues = state.rate.per_day > 0
    ? [...new Set([state.rate.per_day, Math.max(1, Math.round((state.rate.per_day + ideal) / 2)), Math.max(1, Math.floor(ideal))])].filter((v) => v > 0).sort((a, b) => b - a)
    : [];
  const chosen = rate ?? state.rate.per_day;
  const sim = chipValues.length ? whatIf(state, chosen) : null;
  const recent = [...entries].reverse().slice(0, 12);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-8">
      {header}

      <div role="tablist" className="flex gap-1.5 rounded-2xl bg-muted p-1">
        {([["resumo", "Resumo"], ["padroes", "Padrões"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`min-h-11 flex-1 rounded-xl text-sm font-semibold ${tab === id ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "resumo" && (
        <>
          <section className="surface-card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Saldo agora</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.cls}`}><span className={`h-2 w-2 rounded-full ${pill.dot}`} />{pill.text}</span>
            </div>
            {state.balance === null ? (
              <button onClick={() => openSheet("reading")} className="btn-brand min-h-12">Informar o saldo de hoje</button>
            ) : (
              <>
                <div>
                  <div className="text-4xl font-bold tracking-tight">{brl2(state.balance)}</div>
                  <div className="text-xs text-muted-foreground">
                    {state.estimated ? `Estimado hoje · última leitura há ${state.reading_age_days} ${state.reading_age_days === 1 ? "dia" : "dias"}` : "Saldo informado hoje"}
                  </div>
                </div>
                <div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }} /></div>
                  <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                    <span>{brl2(state.spent_in_cycle)} gastos de {brl2(opening)}</span>
                    <span>{state.cycle.elapsed_days} de {state.cycle.total_days} dias</span>
                  </div>
                </div>
                <div className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
                  <strong className="font-semibold">{headline}</strong>
                  {subline && <div className="mt-0.5 text-muted-foreground">{subline}</div>}
                </div>
                {state.inconsistent && <p className="rounded-xl bg-warning/15 p-3 text-sm">O saldo calculado ficou negativo: falta lançar algum gasto ou atualizar o saldo.</p>}
              </>
            )}
          </section>

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Registrar no Ticket">
            <button type="button" onClick={() => openSheet("spend")} className="btn-brand min-h-12 px-2 text-sm">Registrar gasto</button>
            <button type="button" onClick={() => openSheet("reading")} className="min-h-12 rounded-xl border border-border bg-card px-2 text-sm font-semibold">Saldo agora</button>
            <button type="button" onClick={() => openSheet("credit")} className="min-h-12 rounded-xl border border-border bg-card px-2 text-sm font-semibold">Entrou crédito</button>
          </div>

          {state.balance !== null && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  ["Ritmo", state.rate.per_day > 0 ? brl2(state.rate.per_day) : "—", "por dia"],
                  ["Ideal", brl2(ideal), "por dia"],
                  ["Cobertura", proj?.covers_days != null ? Math.min(proj.covers_days, state.cycle.days_left).toFixed(1).replace(".", ",") : "—", `de ${state.cycle.days_left} dias`],
                ].map(([k, v, s]) => (
                  <div key={k} className="surface-card p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="mt-1 text-base font-bold">{v}</div><div className="text-[11px] text-muted-foreground">{s}</div></div>
                ))}
              </div>
              {todayLine(state, brl2, dm) ? (
                <p className="px-1 text-sm text-muted-foreground" data-testid="ticket-today-remaining">{todayLine(state, brl2, dm)}</p>
              ) : null}

              <section className="surface-card flex flex-col gap-3 p-5">
                <div className="flex items-baseline justify-between"><h2 className="font-bold">Como o mês fecha</h2><span className="text-xs text-muted-foreground">{dm(state.cycle.start)} a {dm(state.cycle.next)}</span></div>
                <BurnDownChart series={series} state={state} opening={opening} />
                {chipValues.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <span className="text-sm font-semibold">E se eu gastar por dia...</span>
                    <div className="flex gap-2">
                      {chipValues.map((v) => (
                        <button key={v} onClick={() => setRate(v)} aria-pressed={Math.abs(chosen - v) < 0.005}
                          className={`min-h-11 flex-1 rounded-xl border-2 text-sm font-semibold ${Math.abs(chosen - v) < 0.005 ? "border-primary bg-accent text-accent-foreground" : "border-border"}`}>{brl2(v)}</button>
                      ))}
                    </div>
                    {sim && (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {sim.depletion_date ? `Acaba no dia ${dm(sim.depletion_date)} e faltam ${brl2(sim.shortfall)} do seu bolso.` : `Fecha o ciclo e ainda sobram ${brl2(sim.leftover)}.`}
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section className="surface-card flex flex-col gap-2 p-5">
                <h2 className="font-bold">De onde veio</h2>
                <dl className="text-sm">
                  {state.carry_in !== null && state.carry_in > 0 && <div className="flex justify-between border-b border-border py-2.5"><dt>Sobra do ciclo anterior</dt><dd className="font-semibold text-success">+ {brl2(state.carry_in)}</dd></div>}
                  <div className="flex justify-between border-b border-border py-2.5"><dt>Crédito de {dm(state.cycle.start)}</dt><dd className="font-semibold text-success">+ {brl2(wallet.monthly_credit)}</dd></div>
                  <div className="flex justify-between border-b border-border py-2.5"><dt>Gastos lançados</dt><dd className="font-semibold">− {brl2(state.spent_in_cycle)}</dd></div>
                  <div className="flex justify-between pt-2.5"><dt className="font-semibold">Saldo agora</dt><dd className="font-bold">{brl2(state.balance)}</dd></div>
                </dl>
              </section>
            </>
          )}
        </>
      )}

      {tab === "padroes" && (
        <>
          {!hasSpends && (
            <p className="surface-card p-5 text-sm leading-relaxed text-muted-foreground">
              Para ver o dia da semana em que você mais gasta e para onde o dinheiro vai, registre os gastos (botão +, aba “Gastei”). Só com o saldo, o Nino consegue o ritmo e a data em que acaba, mas não esses padrões.
            </p>
          )}
          {merchants.length > 0 && (
            <section className="surface-card flex flex-col gap-3 p-5">
              <div className="flex items-baseline justify-between"><h2 className="font-bold">Para onde foi</h2><span className="text-xs text-muted-foreground">{brl2(state.spent_in_cycle)} neste ciclo</span></div>
              {merchants.map((m) => (
                <div key={m.merchant} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm"><span>{m.merchant}</span><span><strong className="font-semibold">{brl2(m.total)}</strong> <span className="text-muted-foreground">· {m.share_pct}%</span></span></div>
                  <div className="h-2.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${m.share_pct}%` }} /></div>
                </div>
              ))}
            </section>
          )}
          {hasSpends && (
            <section className="surface-card flex flex-col gap-3 p-5">
              <div className="flex items-baseline justify-between"><h2 className="font-bold">Quando eu gasto</h2><span className="text-xs text-muted-foreground">{pattern.days_observed < 56 ? `${pattern.days_observed} ${pattern.days_observed === 1 ? "dia" : "dias"} de histórico` : "últimas 8 semanas"}</span></div>
              <WeekdayBars pattern={pattern} />
              {pattern.peak ? (
                <div className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
                  <strong className="font-semibold">{pattern.peak.label === "sáb" ? "Sábado" : pattern.peak.label === "dom" ? "Domingo" : `${pattern.peak.label.charAt(0).toUpperCase()}${pattern.peak.label.slice(1)}`} pesa {pattern.peak.share_pct}% do seu Ticket.</strong>
                  <div className="text-muted-foreground">Em média, esse dia custa {brl2(pattern.peak.avg_per_occurrence)}, {pattern.peak.ratio.toFixed(1).replace(".", ",")} vezes a média dos outros dias ({brl2(pattern.peak.others_avg)}).</div>
                  {pattern.confidence === "low" && (
                    <div className="mt-1 text-xs text-muted-foreground">Primeira leitura, com {pattern.days_observed} dias de histórico: ela se firma conforme você lança mais gastos, mas já serve para se antecipar.</div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Com mais alguns gastos lançados eu já aponto em quais dias da semana você mais gasta.</p>
              )}
            </section>
          )}
          {leak.data && leak.data.amount > 0 && (
            <section className="surface-card flex flex-col gap-1 p-5">
              <h2 className="font-bold">Comida fora do Ticket</h2>
              <div className="text-2xl font-bold">{brl2(leak.data.amount)}</div>
              <p className="text-sm text-muted-foreground">
                Neste ciclo você pagou do bolso {leak.data.count} {leak.data.count === 1 ? "gasto" : "gastos"} com alimentação ({leak.data.categories.join(", ").toLowerCase()}). Esse valor está nas suas contas, não no Ticket.
              </p>
            </section>
          )}
          {tips.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h2 className="px-1 font-bold">Como reduzir</h2>
              {tips.map((t) => (
                <div key={t.id} className="surface-card flex items-start justify-between gap-3 p-4">
                  <div className="flex flex-col gap-1"><strong className="text-[15px] font-semibold">{t.title}</strong><span className="text-[13px] leading-relaxed text-muted-foreground">{t.body}</span></div>
                  {t.monthly_saving !== null && <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-1 text-[13px] font-bold text-success">+ {brl2(t.monthly_saving)}</span>}
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {recent.length > 0 && (
        <section className="surface-card flex flex-col gap-1 p-5">
          <h2 className="mb-1 font-bold">Lançamentos</h2>
          {recent.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
              <div className="min-w-0">
                <div className="truncate font-medium">{KIND_LABEL[e.kind]}{e.merchant ? ` · ${e.merchant}` : ""}</div>
                <div className="text-xs text-muted-foreground">{dm(e.occurred_on)}</div>
              </div>
              <div className="flex items-center gap-1">
                <strong className={`font-semibold ${e.kind === "credit" ? "text-success" : ""}`}>{e.kind === "spend" ? "− " : e.kind === "credit" ? "+ " : ""}{brl2(e.amount)}</strong>
                {isEditableBenefitEntry(e) && (
                  <button aria-label="Editar lançamento" onClick={() => setEditing(e)}
                    className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Pencil size={16} /></button>
                )}
                <button aria-label="Excluir lançamento" disabled={remove.isPending}
                  onClick={() => remove.mutate(e.id, { onSuccess: () => toast.success("Lançamento excluído"), onError: () => toast.error("Não consegui excluir agora.") })}
                  className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </section>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">Este saldo fica separado do seu caixa livre, da renda e do patrimônio. Só alimenta esta tela.</p>
      <EntrySheet open={sheet} onOpenChange={setSheet} walletId={wallet.id} today={today} initialMode={sheetMode} />
      <EntrySheet open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }} walletId={wallet.id} today={today} entry={editing} />
      <StatementImportSheet open={importing} onOpenChange={setImporting} walletId={wallet.id} entries={entries} />
    </div>
  );
}
