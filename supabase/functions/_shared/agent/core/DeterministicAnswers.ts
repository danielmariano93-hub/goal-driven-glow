// Fachada semântica para respostas determinísticas do Nino.
//
// A implementação histórica continua isolada em DeterministicAnswersImpl.ts.
// Este arquivo impede que métricas de renda/consumo (que deliberadamente
// excluem transferências e movimentos patrimoniais) sejam descritas como
// "dinheiro que entrou/saiu da conta".
import * as legacy from "./DeterministicAnswersImpl.ts";

export * from "./DeterministicAnswersImpl.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function money(value: unknown): string {
  return BRL.format(Number(value ?? 0));
}

function finite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula totais de caixa apenas com componentes explicitamente expostos pelo
 * snapshot do agente. O total só é publicado se esses componentes + a diferença
 * de conciliação explicarem a variação bancária real. Assim, linhas raras que
 * ainda não estejam expostas (ex.: rendimento creditado) nunca geram um total
 * aparentemente exato, porém incompleto.
 */
export function cashFlowFromAgentBridge(bridge: any): {
  inflow: number;
  outflow: number;
  netFlow: number;
  bankDelta: number;
  publishable: boolean;
} | null {
  if (!bridge) return null;
  const opening = Number(bridge.opening_cash);
  const closing = Number(bridge.closing_cash);
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) return null;

  const inflow = round2(
    finite(bridge.operational_income)
      + finite(bridge.refunds_and_reimbursements)
      + finite(bridge.investment_redemptions)
      + finite(bridge.external_transfers_in)
      + finite(bridge.loan_proceeds)
      + Math.max(0, finite(bridge.adjustments)),
  );
  const outflow = round2(
    finite(bridge.operational_account_expense)
      + finite(bridge.investment_applications)
      + finite(bridge.external_transfers_out)
      + finite(bridge.card_payments)
      + finite(bridge.debt_principal_payments)
      + Math.max(0, -finite(bridge.adjustments)),
  );
  const netFlow = round2(inflow - outflow);
  const bankDelta = round2(closing - opening);
  const reconciliationDifference = finite(bridge.reconciliation_difference);
  const publishable = Math.abs(round2(netFlow + reconciliationDifference - bankDelta)) <= 0.01;

  return { inflow, outflow, netFlow, bankDelta, publishable };
}

/**
 * Corrige apenas SEMÂNTICA de apresentação. Não recalcula fatos nem altera
 * qualquer classificação financeira.
 */
export function normalizeOperationalCashLanguage(reply: string): string {
  return String(reply ?? "")
    .replace(/• Entrou este mês:/g, "• Receitas da rotina:")
    .replace(/• Você gastou:/g, "• Gastos da rotina:")
    .replace(/Entre ([^\n]+), entraram \*/g, "Entre $1, as receitas da rotina somaram *")
    .replace(/Maiores ([^\n:]+) de entrada:/g, "Maiores $1 de receita:")
    .replace(
      /Nos últimos 30 dias entraram \*([^*]+)\* e saíram \*([^*]+)\* — resultado de ([^\n.]+)\./g,
      "Nos últimos 30 dias, as receitas da rotina somaram *$1* e os gastos da rotina *$2* — resultado operacional de $3.",
    );
}

/**
 * Resumo financeiro: renda/consumo permanecem operacionais; caixa é mostrado
 * separadamente quando o snapshot traz a CashBridge.
 */
export function formatFinancialSnapshot(s: any): string {
  let reply = normalizeOperationalCashLanguage(legacy.formatFinancialSnapshot(s));
  const bridge = s?.cash_bridge;
  const opening = Number(bridge?.opening_cash);
  const closing = Number(bridge?.closing_cash);
  if (Number.isFinite(opening) && Number.isFinite(closing)) {
    const cash = cashFlowFromAgentBridge(bridge);
    const lines = reply.split("\n");
    const paceIndex = lines.findIndex((line) => line.startsWith("• Ritmo:"));
    const insertion: string[] = [];

    if (cash?.publishable) {
      insertion.push(
        `• Fluxo de caixa: entrou ${money(cash.inflow)} · saiu ${money(cash.outflow)} · resultado ${cash.netFlow >= 0 ? "+" : "−"}${money(Math.abs(cash.netFlow))}`,
      );
    }

    const delta = closing - opening;
    insertion.push(`• Caixa no período: ${money(opening)} → ${money(closing)} (${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))})`);
    lines.splice(paceIndex >= 0 ? paceIndex : Math.min(4, lines.length), 0, ...insertion);
    reply = lines.join("\n");
  }
  return reply;
}

export function formatSpendingAnalysis(result: any): string {
  return normalizeOperationalCashLanguage(legacy.formatSpendingAnalysis(result));
}

export function formatFinancialEvolution(result: any): string {
  return normalizeOperationalCashLanguage(legacy.formatFinancialEvolution(result));
}

/**
 * A implementação interna ainda chama seus formatters locais; aqui reaplicamos
 * a fachada ao resultado real da tool para que o caminho de produção receba a
 * mesma semântica dos formatters exportados.
 */
export async function executeDeterministicCapability(
  ...args: Parameters<typeof legacy.executeDeterministicCapability>
): Promise<Awaited<ReturnType<typeof legacy.executeDeterministicCapability>>> {
  const turn = await legacy.executeDeterministicCapability(...args);
  if (!turn) return turn;

  const request = args[1] as any;
  const capability = request?.capability;
  if (capability?.name === "financial_snapshot" || (capability?.name === "month_report" && capability?.required_tool === "get_financial_snapshot")) {
    const snapshotCall = [...(turn.toolCalls ?? [])].reverse().find((call: any) => call?.ok && call?.tool_name === "get_financial_snapshot");
    if (snapshotCall?.result) {
      return { ...turn, reply: formatFinancialSnapshot(snapshotCall.result) };
    }
  }

  return { ...turn, reply: normalizeOperationalCashLanguage(turn.reply) };
}
