import { ArrowDownRight, ArrowUpRight, Scales } from "@phosphor-icons/react";
import { formatBRL } from "@/lib/engine/facts";
import { formatPeriodLabel } from "@/lib/ui/periodStore";
import type { CashBridge } from "@/lib/engine/bridges";
import { summarizeCashFlow } from "@/lib/finance/cashFlowSummary";
import { cn } from "@/lib/utils";

type Props = {
  cashBridge: CashBridge | null;
  periodStart: string;
  periodEnd: string;
  loading?: boolean;
};

/**
 * Resumo do PERÍODO SELECIONADO em regime de CAIXA.
 * "Entrou" e "Saiu" significam dinheiro que efetivamente movimentou a conta,
 * incluindo transferências e movimentos patrimoniais quando houver impacto no caixa.
 * Receita/gasto da rotina é outro conceito e permanece em `PeriodPerformance`.
 */
export function ResumoPeriodoCard({ cashBridge, periodStart, periodEnd, loading }: Props) {
  const label = formatPeriodLabel(periodStart, periodEnd);
  const cash = summarizeCashFlow(cashBridge);
  const empty = !loading
    && cashBridge != null
    && cash.inflow === 0
    && cash.outflow === 0
    && cash.reconciled;

  return (
    <section aria-label="Resumo do período" className="rounded-[18px] border border-border bg-card p-3.5 shadow-sm animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-primary">Período selecionado</p>
          <h2 className="mt-0.5 font-display text-[15px] font-bold leading-5 text-foreground">Resumo do período</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
        </div>
        <Scales size={18} className="shrink-0 text-muted-foreground" />
      </div>

      {loading ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-secondary" aria-hidden />
      ) : empty ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Não encontrei movimentações de caixa nesse intervalo. Escolha outro período ou registre o que aconteceu ali.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground">Entrou</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-bold tabular-nums text-success">
                <ArrowUpRight weight="bold" size={13} />{formatBRL(cash.inflow)}
              </p>
            </div>
            <div className="border-l border-border pl-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Saiu</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-bold tabular-nums text-destructive">
                <ArrowDownRight weight="bold" size={13} />{formatBRL(cash.outflow)}
              </p>
            </div>
            <div className="border-l border-border pl-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Resultado</p>
              <p className={cn("mt-0.5 text-[13px] font-bold tabular-nums", cash.netFlow < 0 ? "text-destructive" : "text-success")}>
                {formatBRL(cash.netFlow)}
              </p>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {cash.netFlow < 0
              ? `Nesse período saíram ${formatBRL(Math.abs(cash.netFlow))} a mais do que entraram na conta.`
              : `Nesse período entraram ${formatBRL(cash.netFlow)} a mais do que saíram da conta.`}
          </p>

          {!cash.reconciled ? (
            <p className="mt-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
              Há {formatBRL(Math.abs(cash.reconciliationDifference))} ainda não conciliados entre os movimentos identificados e o saldo confirmado. Esse valor não foi inventado como entrada ou saída.
            </p>
          ) : null}

          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Fluxo de caixa mostra o que realmente movimentou a conta. Transferências, estornos, aplicações, resgates, empréstimos e pagamentos de fatura podem aparecer aqui sem virar receita ou gasto da rotina.
          </p>
        </>
      )}
    </section>
  );
}
