// Blocos financeiros canônicos (`finance_contract.v4`).
// Consomem EXCLUSIVAMENTE as pontes do motor (`src/lib/engine/bridges.ts`).
// Nenhum cálculo aqui — apenas apresentação, copy humana e hierarquia visual.
import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Info,
  Landmark,
  PiggyBank,
  Scale,
  Wallet,
} from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type {
  BalanceExplanation,
  BridgeConfidence,
  CashBridge,
  NetWorthBridge,
  PeriodPerformance,
} from "@/lib/engine/bridges";

const CONFIDENCE_COPY: Record<BridgeConfidence, { label: string; tone: string }> = {
  high: { label: "Conciliado com o banco", tone: "text-success" },
  medium: { label: "Conciliação parcial", tone: "text-amber-600 dark:text-amber-400" },
  low: { label: "Conciliação pendente", tone: "text-destructive" },
};

export function ConfidenceChip({ confidence }: { confidence: BridgeConfidence }) {
  const c = CONFIDENCE_COPY[confidence];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${c.tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {c.label}
    </span>
  );
}

/* ───────────────────────── BLOCO A — POSIÇÃO ATUAL ───────────────────────── */

export interface PositionSummary {
  cash: number;
  invested: number;
  resources: number;
  cardsOwed: number;
  otherDebts: number;
  netWorth: number;
  futureInstallments: number;
}

export function PositionBlock({ position }: { position: PositionSummary }) {
  return (
    <section className="surface-card p-4" aria-label="Sua posição atual">
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
          <Wallet size={15} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Sua posição atual</h2>
          <p className="text-[11px] text-muted-foreground">Não muda com o período selecionado</p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2">
        <Cell label="Dinheiro em conta" value={position.cash} icon={<Landmark size={12} />} />
        <Cell label="Investido" value={position.invested} icon={<PiggyBank size={12} />} />
        <Cell label="Seus recursos hoje" value={position.resources} strong hint="Antes das obrigações" />
        <Cell
          label="Patrimônio líquido"
          value={position.netWorth}
          strong
          icon={<Scale size={12} />}
          hint="Já sem fatura e dívidas"
        />

      </dl>

      <dl className="mt-2 grid grid-cols-2 gap-2">
        <Cell label="Fatura em aberto" value={position.cardsOwed} tone="negative" />
        <Cell label="Outras dívidas" value={position.otherDebts} tone="negative" />
      </dl>

      {position.futureInstallments > 0 ? (
        <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          <strong className="font-semibold text-foreground">{formatBRL(position.futureInstallments)}</strong>{" "}
          em parcelas de meses futuros. Isso é compromisso agendado, não dívida de hoje.
        </p>
      ) : null}
    </section>
  );
}

function Cell({
  label, value, tone = "neutral", strong, icon,
}: {
  label: string;
  value: number;
  tone?: "neutral" | "negative";
  strong?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 px-3 py-2">
      <dt className="flex items-center gap-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd
        className={`truncate ${strong ? "text-base font-bold" : "text-sm font-semibold"} ${
          tone === "negative" && value > 0 ? "text-destructive" : "text-foreground"
        }`}
      >
        {formatBRL(value)}
      </dd>
    </div>
  );
}

/* ────────────────────── BLOCO B — RESULTADO DA ROTINA ────────────────────── */

export function RoutineBlock({
  performance, periodLabel,
}: { performance: PeriodPerformance; periodLabel?: string }) {
  const gap = performance.operationalGap;
  const surplus = performance.operationalResult > 0 ? performance.operationalResult : 0;
  return (
    <section className="surface-card p-4" aria-label="Como foi sua rotina financeira">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Como foi sua rotina financeira</h2>
        {periodLabel ? <span className="text-[11px] text-muted-foreground">{periodLabel}</span> : null}
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-success/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Receitas reais</p>
          <p className="text-sm font-bold text-success">{formatBRL(performance.operationalIncome)}</p>
        </div>
        <div className="rounded-xl bg-destructive/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Gastos reais</p>
          <p className="text-sm font-bold text-destructive">{formatBRL(performance.operationalExpense)}</p>
        </div>
      </div>

      <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2.5">
        {gap > 0 ? (
          <>
            <p className="text-xs font-semibold text-foreground">Gastos acima das receitas: {formatBRL(gap)}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Você usou {formatBRL(gap)} de recursos que já tinha. Isso não quer dizer que sua conta ficou negativa.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-success">Sobrou {formatBRL(surplus)} da sua rotina</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {performance.savingsRate !== null
                ? `Você guardou ${(performance.savingsRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do que recebeu.`
                : "Sem receitas registradas no período."}
            </p>
          </>
        )}
      </div>

      {performance.refunds > 0 ? (
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          {formatBRL(performance.refunds)} em estornos e reembolsos já abateram seus gastos.
        </p>
      ) : null}

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Aplicações, resgates, transferências, empréstimos e pagamentos de fatura não entram aqui —
        eles mudam de lugar, não são receita nem gasto.
      </p>
    </section>
  );
}

/* ─────────────────── BLOCO C — FORMAÇÃO DO SALDO (CASH BRIDGE) ─────────────────── */

export function CashBridgeBlock({
  bridge, explanation, periodLabel, defaultOpen = false,
}: {
  bridge: CashBridge;
  explanation: BalanceExplanation;
  periodLabel?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const delta = bridge.confirmedClosingCash - bridge.openingCash;

  return (
    <section className="surface-card p-4" aria-label="Como seu saldo mudou">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Como seu saldo mudou</h2>
        {periodLabel ? <span className="text-[11px] text-muted-foreground">{periodLabel}</span> : null}
      </header>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Endpoint label="Saldo início" value={bridge.openingCash} />
        <span
          className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
            delta >= 0 ? "text-success" : "text-destructive"
          }`}
        >
          {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {formatBRL(Math.abs(delta))}
        </span>
        <Endpoint label="Saldo final" value={bridge.confirmedClosingCash} strong />
      </div>

      <p className="mt-3 text-xs font-semibold text-foreground">{explanation.headline}</p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 inline-flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-left text-xs font-medium"
      >
        <span className="inline-flex items-center gap-1.5">
          <Info size={13} className="text-primary" />
          Entenda como esse saldo foi formado
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <ol className="space-y-1.5">
            <BridgeRow label="Saldo início" amount={bridge.openingCash} direction={0} />
            {bridge.lines.map((line) => (
              <BridgeRow
                key={line.key}
                label={line.label}
                amount={line.amount}
                direction={line.direction}
                count={line.count}
              />
            ))}
            <BridgeRow label="Saldo final" amount={bridge.confirmedClosingCash} direction={0} strong />
          </ol>

          {Math.abs(bridge.reconciliationDifference) > 0.01 ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[11px] leading-snug text-destructive">
              Diferença de reconciliação de {formatBRL(Math.abs(bridge.reconciliationDifference))}. Confira o extrato
              da conta para conciliar.
            </p>
          ) : null}

          <div className="rounded-xl bg-muted/50 px-3 py-2.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">{explanation.body}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <ConfidenceChip confidence={bridge.confidence} />
              <span className="text-[10px] text-muted-foreground">{bridge.formulaVersion}</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Endpoint({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="min-w-0 text-center">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`truncate ${strong ? "text-base font-bold" : "text-sm font-semibold"} text-foreground`}>
        {formatBRL(value)}
      </div>
    </div>
  );
}

function BridgeRow({
  label, amount, direction, count, strong,
}: { label: string; amount: number; direction: number; count?: number; strong?: boolean }) {
  const sign = direction > 0 ? "+" : direction < 0 ? "−" : "";
  const color = direction > 0 ? "text-success" : direction < 0 ? "text-destructive" : "text-foreground";
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
      <span className={`min-w-0 truncate text-[11px] ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {label}
        {count && count > 1 ? <span className="ml-1 text-[10px] text-muted-foreground">({count}x)</span> : null}
      </span>
      <span className={`shrink-0 text-xs ${strong ? "font-bold" : "font-semibold"} ${color}`}>
        {sign} {formatBRL(amount)}
      </span>
    </li>
  );
}

/* ──────────── BLOCO D — MOVIMENTAÇÕES QUE NÃO SÃO RECEITA NEM GASTO ──────────── */

export function PatrimonialBlock({
  cashBridge, netWorth,
}: { cashBridge: CashBridge; netWorth: NetWorthBridge }) {
  const [showAll, setShowAll] = useState(false);
  const rows: Array<{ label: string; amount: number; hint: string }> = [
    { label: "Aplicações em investimentos", amount: cashBridge.investmentApplications, hint: "Saiu da conta, entrou no investimento." },
    { label: "Resgates de investimentos", amount: cashBridge.investmentRedemptions, hint: "Saiu do investimento, entrou na conta." },
    { label: "Rendimento dos investimentos", amount: netWorth.investmentReturn, hint: "Ganho do investimento — aumenta o patrimônio." },
    { label: "Transferências recebidas", amount: cashBridge.externalTransfersIn, hint: "Entrada de terceiro, não é receita da rotina." },
    { label: "Transferências enviadas", amount: cashBridge.externalTransfersOut, hint: "Saída para terceiro, não é gasto da rotina." },
    { label: "Empréstimos creditados", amount: cashBridge.loanProceeds, hint: "Entra dinheiro e cria dívida do mesmo valor." },
    { label: "Pagamentos de fatura", amount: cashBridge.cardPayments, hint: "Reduz caixa e fatura; o consumo já foi contado." },
    { label: "Amortização de dívidas", amount: cashBridge.debtPrincipalPayments, hint: "Reduz caixa e dívida no mesmo valor." },
    { label: "Juros e tarifas", amount: cashBridge.debtInterestAndFees, hint: "Custo financeiro real — reduz seu patrimônio." },
  ].filter((r) => Math.abs(r.amount) > 0.005);

  const visible = showAll ? rows : rows.slice(0, 4);
  const nwDelta = netWorth.netWorthChange;

  return (
    <section className="surface-card p-4" aria-label="Movimentações que não são receita nem gasto">
      <header className="mb-1">
        <h2 className="text-sm font-semibold">Movimentações que não são receita nem gasto</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Mudam o dinheiro de lugar ou trocam dívida por caixa. Afetam o saldo, não a sua rotina.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">Nenhuma movimentação patrimonial no período.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {visible.map((r) => (
              <li key={r.label} className="flex items-baseline justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-foreground">{r.label}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{formatBRL(r.amount)}</span>
              </li>
            ))}
          </ul>
          {rows.length > 4 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-2 text-[11px] font-semibold text-primary"
            >
              {showAll ? "Ver menos" : `Ver tudo (${rows.length})`}
            </button>
          ) : null}
        </>
      )}


      <div className="mt-3 rounded-xl border border-border px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Patrimônio no período</p>
        <p className={`text-sm font-bold ${nwDelta >= 0 ? "text-success" : "text-destructive"}`}>
          {nwDelta >= 0 ? "+" : "−"} {formatBRL(Math.abs(nwDelta))}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Começou com {formatBRL(netWorth.openingNetWorth)} e terminou com {formatBRL(netWorth.closingNetWorth)}.
          {netWorth.investmentReturn > 0
            ? ` Inclui ${formatBRL(netWorth.investmentReturn)} de rendimento.`
            : ""}
        </p>
        <div className="mt-2">
          <ConfidenceChip confidence={netWorth.confidence} />
        </div>
      </div>
    </section>
  );
}
