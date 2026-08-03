import { useEffect, useState } from "react";
import { Download, Lightbulb, Loader2, Printer, TrendingDown } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  groupByMonth,
  byCategory,
  filterCanonicalReportTransactions,
  filterPeriod,
  spendingHighlights,
  toCsv,
  type ReportTxn,
} from "@/lib/reports/aggregations";
import { formatBRL } from "@/lib/split/math";
import { resolvePeriodRange } from "@/lib/ui/periodStore";
import { clampRangeToToday } from "@/lib/engine/spendingRhythm";
import { useFinancialSnapshot } from "@/lib/hooks/useFinancialSnapshot";
import { useAccounts, useAccountBalanceSnapshots, useAllTransactions } from "@/lib/db/finance";
import { computeCashBridge, computePeriodPerformance } from "@/lib/engine/bridges";
import {
  CashBridgeBlock,
  PatrimonialBlock,
  PositionBlock,
  RoutineBlock,
} from "@/components/finance/FinanceBlocks";

type BridgeAccount = Parameters<typeof computeCashBridge>[0]["accounts"][number];
type BridgeTxn = Parameters<typeof computeCashBridge>[0]["txs"][number];
type BridgeSnapshot = NonNullable<Parameters<typeof computeCashBridge>[0]["snapshots"]>[number];

const round2cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type MonthBridge = {
  ym: string;
  bridge: ReturnType<typeof computeCashBridge>;
  perf: ReturnType<typeof computePeriodPerformance>;
  patrimonial: number;
  financialPayments: number;
};

/** Card expansível mobile-first — substitui a tabela contábil. */
function MonthCard({ month }: { month: MonthBridge }) {
  const [open, setOpen] = useState(false);
  const [y, m] = month.ym.split("-");
  const label = new Date(Date.UTC(Number(y), Number(m) - 1, 1))
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const delta = round2cents(month.bridge.confirmedClosingCash - month.bridge.openingCash);
  return (
    <article className="surface-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold capitalize">{label}</span>
          <span className="block text-[11px] text-muted-foreground">
            Saldo {formatBRL(month.bridge.openingCash)} → {formatBRL(month.bridge.confirmedClosingCash)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`block text-sm font-bold ${delta >= 0 ? "text-success" : "text-destructive"}`}>
            {delta >= 0 ? "+" : "−"} {formatBRL(Math.abs(delta))}
          </span>
          <span className="block text-[10px] text-muted-foreground">{open ? "ocultar" : "detalhes"}</span>
        </span>
      </button>
      {open ? (
        <dl className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3 text-[11px]">
          <MonthRow label="Saldo inicial" value={month.bridge.openingCash} />
          <MonthRow label="Receitas" value={month.perf.operationalIncome} tone="positive" />
          <MonthRow label="Gastos" value={month.perf.operationalExpense} tone="negative" />
          <MonthRow label="Movimentações patrimoniais" value={month.patrimonial} />
          <MonthRow label="Pagamentos financeiros" value={month.financialPayments} tone="negative" />
          <MonthRow label="Saldo final" value={month.bridge.confirmedClosingCash} strong />
          {Math.abs(month.bridge.reconciliationDifference) > 0.01 ? (
            <MonthRow label="Divergência" value={month.bridge.reconciliationDifference} tone="negative" />
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}

function MonthRow({
  label, value, tone = "neutral", strong,
}: { label: string; value: number; tone?: "neutral" | "positive" | "negative"; strong?: boolean }) {
  const color = tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 px-2.5 py-1.5">
      <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`truncate ${strong ? "text-sm font-bold" : "text-xs font-semibold"} ${color}`}>{formatBRL(value)}</dd>
    </div>
  );
}

export default function Relatorios() {
  const [txns, setTxns] = useState<ReportTxn[] | null>(null);
  const initialRange = resolvePeriodRange();
  const [from, setFrom] = useState(initialRange.start);
  const [to, setTo] = useState(initialRange.end);
  const reportRange = clampRangeToToday({ start: from, end: to });
  const { data: financialSnapshot, loading: financialLoading } = useFinancialSnapshot(reportRange);
  const { data: bridgeAccounts } = useAccounts();
  const { data: bridgeSnapshots } = useAccountBalanceSnapshots();
  const { data: bridgeTxs } = useAllTransactions();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id,account_id,type,status,amount,occurred_at,category_id,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,origin,installments_total,description,friendly_description,categories(name)")
        .order("occurred_at", { ascending: false });
      type RawTxn = Record<string, unknown> & { categories?: { name?: string | null } | null };
      setTxns(((data ?? []) as unknown as RawTxn[]).map((t) => ({
        ...(t as object),
        amount: Number(t.amount),
        category_name: t.categories?.name ?? null,
      }) as unknown as ReportTxn));
    })();
  }, []);

  if (txns === null) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  const filtered = filterCanonicalReportTransactions(filterPeriod(txns, reportRange.start, reportRange.end));
  const monthly = groupByMonth(filtered);
  // FONTE ÚNICA: o ritmo vem do mesmo snapshot canônico da Home (finance-core).
  const rhythm = financialSnapshot?.rhythm.current ?? null;
  const dailyRhythm = (rhythm?.series ?? []).map((point) => ({
    date: point.date,
    gastoDoDia: point.grossAmount,
    mediaTotal: point.runningAverage,
    ritmoTipico: point.typicalRunningAverage,
    label: new Date(`${point.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
  }));
  const byCat = byCategory(filtered);
  const totalIncome = monthly.reduce((s, m) => s + m.income, 0);
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0);
  const maxCat = Math.max(1, ...byCat.map(c => c.total));
  const highlights = spendingHighlights(byCat, totalExpense);

  // Mês a mês com a MESMA ponte canônica do período (nenhum cálculo paralelo).
  const bridgeAccountRows = (bridgeAccounts ?? []).map((a) => ({
    id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active,
  })) as unknown as BridgeAccount[];
  const bridgeTxRows = ((bridgeTxs ?? []) as unknown as Array<Record<string, unknown>>)
    .map((t) => ({ ...t, amount: Number(t.amount) })) as unknown as BridgeTxn[];
  const bridgeSnapRows = ((bridgeSnapshots ?? []) as unknown as Array<Record<string, unknown>>)
    .map((s2) => ({ ...s2, balance: Number(s2.balance) })) as unknown as BridgeSnapshot[];
  const monthlyBridges = monthly.map((m) => {
    const [y, mm] = m.ym.split("-").map(Number);
    const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const monthPeriod = { start: `${m.ym}-01`, end: `${m.ym}-${String(last).padStart(2, "0")}` };
    const bridge = computeCashBridge({
      accounts: bridgeAccountRows,
      txs: bridgeTxRows,
      snapshots: bridgeSnapRows,
      period: monthPeriod,
    });
    const perf = computePeriodPerformance(bridgeTxRows, monthPeriod);
    const patrimonial = round2cents(
      bridge.investmentRedemptions - bridge.investmentApplications
      + bridge.externalTransfersIn - bridge.externalTransfersOut
      + bridge.loanProceeds,
    );
    const financialPayments = round2cents(
      bridge.cardPayments + bridge.debtPrincipalPayments + bridge.debtInterestAndFees,
    );
    return { ym: m.ym, bridge, perf, patrimonial, financialPayments };
  });

  const download = () => {
    const csv = toCsv(filtered.map(t => ({
      data: t.occurred_at, tipo: t.type, valor: t.amount, categoria: t.category_name ?? "",
    })));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (filtered.length === 0) {
    return (
      <div className="space-y-5 pt-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
        <div className="surface-card p-8 text-center">
          <p className="text-sm font-medium">Ainda não há dados no período</p>
          <p className="text-xs text-muted-foreground mt-1">Registre lançamentos para ver seus relatórios factuais.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-2 print:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Análises baseadas apenas nos seus dados</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={download} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"><Download size={12} /> CSV</button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"><Printer size={12} /> Imprimir</button>
        </div>
      </div>

      <div className="surface-card grid min-w-0 grid-cols-1 gap-2 p-3 min-[380px]:grid-cols-2 print:hidden">
        <label className="min-w-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          De
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base normal-case tracking-normal text-foreground" />
        </label>
        <label className="min-w-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Até
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base normal-case tracking-normal text-foreground" />
        </label>
      </div>

      {/* Três perguntas, três seções. Só a primeira abre por padrão. */}
      {financialLoading || !financialSnapshot ? (
        <div className="surface-card grid place-items-center p-6"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <Group title="Onde estou" subtitle="Sua posição de hoje" defaultOpen>
            <PositionBlock
              position={{
                cash: financialSnapshot.netWorth.cash,
                invested: financialSnapshot.investmentsTotal,
                resources: financialSnapshot.netWorth.assets,
                cardsOwed: financialSnapshot.cardDebtToday,
                otherDebts: financialSnapshot.activeDebtTotal,
                netWorth: financialSnapshot.netWorth.net,
                futureInstallments: financialSnapshot.cardFutureInstallments,
              }}
            />
          </Group>

          <Group title="Como foi minha rotina" subtitle="Receitas, gastos e ritmo do período">
            <RoutineBlock performance={financialSnapshot.periodPerformance} periodLabel={`${from} a ${to}`} />

            <div className="surface-card p-3">
              <p className="mb-1 text-[11px] font-semibold">Ritmo de gastos no período</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyRhythm} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatBRL(Number(value)),
                        name === "gastoDoDia"
                          ? "Gasto do dia"
                          : name === "mediaTotal"
                            ? "Média total até o dia"
                            : "Ritmo típico até o dia",
                      ]}
                      labelFormatter={(label) => `Dia ${label}`}
                      contentStyle={{
                        borderRadius: 16,
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--background))",
                        fontSize: 12,
                      }}
                    />
                    <Line type="monotone" dataKey="gastoDoDia" name="Gasto do dia" stroke="hsl(var(--primary))" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="mediaTotal" name="Média total até o dia" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="ritmoTipico" name="Ritmo típico até o dia" stroke="#2FC99A" strokeWidth={2.25} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Gasto do dia</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted-foreground" /> Média até o dia</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2FC99A]" /> Ritmo típico</span>
              </div>
            </div>
          </Group>

          <Group title="Como o saldo mudou" subtitle="Formação do saldo e histórico mensal">
            <CashBridgeBlock
              bridge={financialSnapshot.cashBridge}
              explanation={financialSnapshot.balanceExplanation}
              periodLabel={`${from} a ${to}`}
            />
            <PatrimonialBlock
              cashBridge={financialSnapshot.cashBridge}
              netWorth={financialSnapshot.netWorthBridge}
            />
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">Mês a mês</h3>
              {monthlyBridges.map((m) => <MonthCard key={m.ym} month={m} />)}
            </div>
          </Group>
        </>
      )}


      <section>
        <h2 className="text-sm font-semibold mb-2">Por categoria (despesas)</h2>
        <div className="surface-card p-4 space-y-3">
          {byCat.map(c => (
            <div key={c.category}>
              <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="block truncate font-medium">{c.category}</span>
                  <span className="text-[10px] text-muted-foreground">{c.percentOfExpenses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das despesas</span>
                </div>
                <span className="shrink-0 text-right font-medium">{formatBRL(c.total)} · {c.count}x</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(c.total/maxCat)*100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Consumo real: exclui transferências, investimentos, empréstimos e pagamento de fatura; estornos reduzem o total.</p>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb size={15} className="text-primary" /> Principais leituras do período</h2>
        <div className="space-y-2">
          {highlights.map((h) => (
            <article key={h.id} className="surface-card p-4">
              <div className="flex min-w-0 gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <TrendingDown size={15} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold leading-snug">{h.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.body}</p>
                  {h.impact ? <p className="mt-2 text-[11px] font-medium text-foreground">{h.impact}</p> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
