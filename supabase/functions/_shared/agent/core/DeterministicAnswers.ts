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
    const delta = closing - opening;
    const cashLine = `• Caixa no período: ${money(opening)} → ${money(closing)} (${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))})`;
    const lines = reply.split("\n");
    const paceIndex = lines.findIndex((line) => line.startsWith("• Ritmo:"));
    lines.splice(paceIndex >= 0 ? paceIndex : Math.min(4, lines.length), 0, cashLine);
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
 * A implementação interna ainda chama seus formatters locais; normalizamos a
 * resposta final para que nenhum caminho determinístico escape da mesma regra.
 */
export async function executeDeterministicCapability(
  ...args: Parameters<typeof legacy.executeDeterministicCapability>
): Promise<Awaited<ReturnType<typeof legacy.executeDeterministicCapability>>> {
  const turn = await legacy.executeDeterministicCapability(...args);
  if (!turn) return turn;
  return { ...turn, reply: normalizeOperationalCashLanguage(turn.reply) };
}
