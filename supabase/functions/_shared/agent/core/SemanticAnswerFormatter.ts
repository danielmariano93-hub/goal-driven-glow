// SemanticAnswerFormatter (`nino_semantic_ir.v4`)
//
// Deterministic response generation from engine evidence. The LLM never
// recalculates or rewrites monetary truth.
// deno-lint-ignore-file no-explicit-any
import {
  formatFinancialSnapshot, formatForecastMonthClose, formatGoalsOverview,
  formatMerchantDistribution, formatSpendingAnalysis, formatEngineNarrative,
} from "./DeterministicAnswers.ts";
import {
  formatAverageComparisonEnhanced,
  formatPeriodComparisonEnhanced,
} from "./ComparisonPresentation.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatDebtStatus(result: any): string | null {
  const facts = result?.facts ?? null;
  const rows = Array.isArray(result?.breakdown) ? result.breakdown : [];
  if (!facts) return null;
  const count = Number(facts.debts_analyzed ?? rows.length ?? 0);
  if (count <= 0) return "Você não tem dívidas ativas registradas.";
  const total = Number(facts.total_outstanding ?? rows.reduce((sum: number, row: any) => sum + Number(row?.outstanding_balance ?? 0), 0));
  const visible = rows.slice(0, 8).map((row: any) => {
    const name = String(row?.name ?? "Dívida").trim();
    const outstanding = Number(row?.outstanding_balance ?? 0);
    return `• ${name}: ${BRL.format(outstanding)}`;
  }).join("\n");
  const more = rows.length > 8 ? `\n• +${rows.length - 8} outra(s)` : "";
  const monthly = Number(facts.monthly_installments_total);
  const monthlyLine = Number.isFinite(monthly) && monthly > 0 ? ` As parcelas somam ${BRL.format(monthly)} por mês.` : "";
  return `Você tem ${count} dívida(s) ativa(s), com saldo total de ${BRL.format(total)}.${monthlyLine}${visible ? `\n\n${visible}${more}` : ""}`;
}

/** Patrimônio líquido: o total e de onde ele vem (tudo sai do resultado da engine). */
function formatNetWorth(result: any): string | null {
  const total = Number(result?.net_worth);
  if (!Number.isFinite(total)) return null;
  const c = result?.composition ?? {};
  const lines = [`Seu patrimônio líquido hoje é de *${BRL.format(total)}*.`];
  const parts: string[] = [];
  if (Number(c.cash)) parts.push(`• Dinheiro em conta: ${BRL.format(Number(c.cash))}`);
  if (Number(c.invested)) parts.push(`• Investido: ${BRL.format(Number(c.invested))}`);
  if (Number(c.account_overdraft)) parts.push(`• Cheque especial: −${BRL.format(Number(c.account_overdraft))}`);
  if (Number(c.cards_owed)) parts.push(`• Fatura de cartão em aberto: −${BRL.format(Number(c.cards_owed))}`);
  if (Number(c.other_debts)) parts.push(`• Outras dívidas: −${BRL.format(Number(c.other_debts))}`);
  if (parts.length) lines.push("", ...parts);
  return lines.join("\n");
}

/** Saldo por conta: a(s) conta(s) pedida(s), ou aviso honesto quando o nome não existe. */
function formatAccountBalance(result: any): string | null {
  const accounts = Array.isArray(result?.accounts) ? result.accounts : [];
  const filter = result?.account_filter;
  if (filter && filter.applied !== true) {
    const names = Array.isArray(result?.available_accounts) ? result.available_accounts.filter(Boolean) : [];
    return `Não encontrei uma conta chamada *${filter.requested}*.${names.length ? ` Suas contas: ${names.join(", ")}.` : ""}`;
  }
  if (!accounts.length) return "Você ainda não tem contas cadastradas.";
  if (accounts.length === 1) return `O saldo da conta *${accounts[0].name}* é de *${BRL.format(Number(accounts[0].balance))}*.`;
  return ["Saldo por conta:", ...accounts.map((a: any) => `• ${a.name}: ${BRL.format(Number(a.balance))}`)].join("\n");
}

/** Parcelas futuras de cartão: total, mês a mês e quantas são. */
function formatFutureInstallments(result: any): string | null {
  const count = Number(result?.count ?? 0);
  const total = Number(result?.total);
  if (!Number.isFinite(total)) return null;
  const mf = result?.merchant_filter as { requested?: string; matched_purchases?: number } | undefined;
  if (mf && (count <= 0 || total <= 0)) {
    return mf.matched_purchases
      ? `Não há parcelas futuras em aberto no ${mf.requested}.`
      : `Não encontrei compras parceladas no ${mf.requested}.`;
  }
  if (count <= 0 || total <= 0) return "Você não tem parcelas futuras no cartão registradas.";
  const months = Array.isArray(result?.by_month) ? result.by_month : [];
  const label = (m: string) => { const [y, mo] = String(m).split("-"); return mo && y ? `${mo}/${y}` : String(m); };
  const lines = [mf
    ? `Ainda faltam *${BRL.format(total)}* no ${mf.requested}, em ${count} parcela${count === 1 ? "" : "s"}.`
    : `Você tem *${BRL.format(total)}* em ${count} parcela${count === 1 ? "" : "s"} futura${count === 1 ? "" : "s"} no cartão.`];
  const rows = months.slice(0, 6).map((row: any) => `• ${label(row.competence_month)}: ${BRL.format(Number(row.total ?? row.amount ?? 0))}`);
  if (rows.length) lines.push("", ...rows);
  return lines.join("\n");
}

import { formatSpendingAggregate } from "./handlers/GenericAggregateFormat.ts";

const dm = (iso: string) => { const [, mo, d] = String(iso).slice(0, 10).split("-"); return mo && d ? `${d}/${mo}` : String(iso); };

function formatFinancialSources(result: any): string | null {
  const cards: any[] = Array.isArray(result?.cards) ? result.cards : null as any;
  const accounts: any[] = Array.isArray(result?.accounts) ? result.accounts : null as any;
  if (!cards || !accounts) return null;
  const lines: string[] = [];
  if (cards.length) {
    lines.push(`*Cartões de crédito* (${cards.length}):`);
    for (const c of cards) {
      const bits = [c.closing_day ? `fecha dia ${c.closing_day}` : null, c.due_day ? `vence dia ${c.due_day}` : null,
        Number.isFinite(Number(c.total_limit)) && Number(c.total_limit) > 0 ? `limite ${BRL.format(Number(c.total_limit))}` : null].filter(Boolean);
      lines.push(`• ${c.name}${bits.length ? ` — ${bits.join(", ")}` : ""}`);
    }
  } else lines.push("Você não tem cartão de crédito cadastrado.");
  lines.push("");
  if (accounts.length) {
    lines.push(`*Contas* (${accounts.length}):`);
    for (const a of accounts) lines.push(`• ${a.name}`);
  } else lines.push("Você não tem conta bancária cadastrada.");
  return lines.join("\n");
}

function formatCashProjection(result: any): string | null {
  const available = Number(result?.available_today);
  if (!Number.isFinite(available) || !Array.isArray(result?.days)) return null;
  const days: any[] = result.days;
  const neg = result.first_negative_date ? days.find((d) => d.date === result.first_negative_date) : null;
  const upto = neg ? days.filter((d) => d.date <= neg.date) : days.slice(0, 6);
  const lines: string[] = [`Seu saldo disponível hoje é *${BRL.format(available)}*.`];
  if (neg) {
    lines.push(`Somando as entradas previstas e os compromissos pendentes, o caixa fica em *${BRL.format(neg.balance)}* em *${dm(neg.date)}*.`);
  } else if (days.length) {
    lines.push(`Nos próximos ${Number(result.horizon_days) || 30} dias o caixa não fica negativo; o menor saldo projetado é *${BRL.format(Number(result.lowest_balance))}* em ${dm(result.lowest_date)}.`);
  } else {
    return `${lines[0]} Não há entradas nem compromissos pendentes nos próximos ${Number(result.horizon_days) || 30} dias.`;
  }
  lines.push("", "Dia a dia:");
  // Do primeiro dia em diante: os compromissos mais próximos são justamente os que o usuário
  // quer conferir. Passando de 12 dias, o resto vira uma linha de resumo (sem sumir o dia crítico).
  const shown = upto.length > 12 ? [...upto.slice(0, 11), upto[upto.length - 1]] : upto;
  for (const d of shown) {
    const parts = (d.items ?? []).map((i: any) => `${i.kind === "income" ? "+" : "−"} ${i.name} ${BRL.format(Number(i.amount))}${i.estimated ? " (estimado)" : ""}`);
    lines.push(`• *${dm(d.date)}*: ${parts.join("; ")} → saldo ${BRL.format(Number(d.balance))}`);
  }
  if (shown.length < upto.length) lines.push(`(${upto.length - shown.length} dias intermediários omitidos; o saldo acima já os inclui.)`);
  if (upto.some((d) => (d.items ?? []).some((i: any) => i.estimated))) {
    lines.push("", "Itens “estimado” vêm de recorrência ou entrada prevista, não de valor confirmado.");
  }
  return lines.join("\n");
}

const MONTH_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function formatCardInvoice(result: any): string | null {
  if (!result || result.engine !== "get_card_invoice") return null;
  const [y, m] = String(result.month ?? "").split("-").map(Number);
  const label = y && m ? `${MONTH_PT[m - 1]} de ${y}` : "o mês";
  if (result.has_cards === false) return headline(result);
  if (result.card_filter && result.card_filter.applied === false) return `Não encontrei um cartão chamado “${result.card_filter.requested}”. Me diga o nome como aparece em Cartões.`;
  const rows: any[] = result.cards ?? [];
  const known = rows.filter((r) => r.source !== "unavailable" && r.source !== "none");
  if (!known.length) return `Ainda não tenho compras nem parcelas lançadas na fatura de ${label}.`;
  const how = (r: any) => r.source === "official" ? "fatura oficial"
    : r.needs_review ? `fatura importada em revisão: o documento lido traz ${BRL.format(Number(r.imported_amount))}; pelas compras e parcelas já lançadas a estimativa é essa`
    : "estimativa com as compras e parcelas já lançadas";
  const due = (r: any) => r.due_date ? `, vence em ${dm(r.due_date)}` : "";
  if (known.length === 1) {
    const r = known[0];
    return `A fatura de ${label}${rows.length > 1 || result.card_filter ? ` do ${r.card}` : ""} está em *${BRL.format(Number(r.amount))}* (${how(r)}${due(r)}).`;
  }
  const lines = [`Faturas de ${label}: *${BRL.format(Number(result.total))}* no total.`];
  for (const r of known) lines.push(`• ${r.card}: *${BRL.format(Number(r.amount))}* (${how(r)}${due(r)})`);
  return lines.join("\n");
}

function formatPeriodTransactions(result: any): string | null {
  if (!result || result.engine !== "list_period_transactions") return null;
  const word = result.kind === "income" ? "entradas" : "gastos";
  if (result.category_filter && result.category_filter.applied === false) return `Não encontrei a categoria “${result.category_filter.requested}”.`;
  const span = result.from === result.to ? dm(result.from) : `${dm(result.from)} a ${dm(result.to)}`;
  if (!Number(result.count)) return `Não encontrei ${word} em ${span}.`;
  const lines = [`${Number(result.count)} ${word} em ${span}, somando *${BRL.format(Number(result.total))}*:`, ""];
  for (const it of result.items ?? []) lines.push(`• ${dm(it.date)} · ${it.description}${it.category ? ` (${it.category})` : ""}: *${BRL.format(Number(it.amount))}*`);
  if (result.truncated) lines.push("", `Mostrei os ${Number(result.shown)} mais recentes de ${Number(result.count)}. Me peça uma categoria ou estabelecimento para filtrar.`);
  return lines.join("\n");
}

function formatBenefitStatus(result: any): string | null {
  if (!result || result.engine !== "get_benefit_status") return null;
  if (result.enabled === false || result.configured === false) return headline(result);
  const lines: string[] = [];
  if (result.balance === null || result.needs_reading) {
    return "Ainda não tenho uma leitura do seu saldo de Ticket Alimentação. Me diga quanto aparece no app do ticket hoje (ex.: “ticket 412,40”) e eu passo a acompanhar.";
  }
  const est = result.estimated ? " (estimado a partir da última leitura)" : "";
  lines.push(`Seu Ticket Alimentação tem *${BRL.format(Number(result.balance))}*${est}.`);
  const c = result.cycle ?? {};
  if (c.next) lines.push(`Faltam *${Number(c.days_left)} dias* para o próximo crédito (${dm(c.next)}).`);
  const p = result.projection;
  if (p && p.status !== "unknown") {
    if (p.depletion_date) {
      lines.push(`No seu ritmo (*${BRL.format(Number(result.rate_per_day))}/dia*), o saldo acaba em *${dm(p.depletion_date)}* e faltam cerca de *${BRL.format(Number(p.shortfall))}* até o crédito.`);
    } else {
      lines.push(`No seu ritmo (*${BRL.format(Number(result.rate_per_day))}/dia*), o saldo cobre até o próximo crédito e ainda sobram *${BRL.format(Number(p.leftover))}*.`);
    }
  }
  if (result.ideal_per_day != null) lines.push(`Para fechar o ciclo, o ideal é gastar até *${BRL.format(Number(result.ideal_per_day))}/dia*.`);
  const sc = result.scenario;
  if (sc && sc.status) {
    lines.push(sc.depletion_date
      ? `Gastando *${BRL.format(Number(sc.per_day))}/dia*, o saldo acaba em *${dm(sc.depletion_date)}* (faltam ${BRL.format(Number(sc.shortfall))}).`
      : `Gastando *${BRL.format(Number(sc.per_day))}/dia*, o saldo fecha o ciclo e sobram *${BRL.format(Number(sc.leftover))}*.`);
  }
  const peak = result.weekday_peak;
  if (peak) lines.push(`O dia que mais pesa é *${peak.label}*: ${Number(peak.share_pct)}% do gasto, média de ${BRL.format(Number(peak.avg_per_occurrence))}${peak.confidence === "low" ? ` (primeira leitura, com ${Number(peak.days_observed)} dias de histórico)` : ""}.`);
  const leak = result.food_outside_ticket;
  if (leak && Number(leak.amount) > 0) lines.push(`Fora do Ticket, você gastou *${BRL.format(Number(leak.amount))}* com alimentação neste ciclo (${(leak.categories ?? []).join(", ").toLowerCase()}).`);
  if (result.inconsistent) lines.push("Os lançamentos passaram do saldo lido; vale conferir a leitura do app do ticket.");
  return lines.join("\n");
}

const FORMATTERS: Record<string, (result: any) => string | null> = {
  get_net_worth: formatNetWorth,
  get_account_balance: formatAccountBalance,
  get_future_installments: formatFutureInstallments,
  analyze_spending: formatSpendingAnalysis,
  merchant_distribution: formatMerchantDistribution,
  spending_aggregate: formatSpendingAggregate,
  compare_to_monthly_average: formatAverageComparisonEnhanced,
  get_financial_snapshot: formatFinancialSnapshot,
  get_goals_overview: formatGoalsOverview,
  get_debt_status: formatDebtStatus,
  forecast_month_close: formatForecastMonthClose,
  explain_cash_projection: formatCashProjection,
  list_financial_sources: formatFinancialSources,
  get_benefit_status: formatBenefitStatus,
  get_card_invoice: formatCardInvoice,
  list_period_transactions: formatPeriodTransactions,
  compare_periods: formatPeriodComparisonEnhanced,
};

function headline(result: any): string | null {
  const h = result?.answer_format?.headline ?? result?.headline;
  return typeof h === "string" && h.trim().length > 8 ? h.trim() : null;
}

export function semanticBlockText(engine: string | null, result: unknown): string | null {
  if (!engine || !result) return null;
  const formatter = FORMATTERS[engine];
  if (formatter) {
    try {
      const text = formatter(result as any);
      if (text && text.trim()) return text.trim();
    } catch { /* fallback to canonical narrative/headline */ }
  }
  try {
    const narrative = formatEngineNarrative(result as any);
    if (narrative && narrative.trim()) return narrative.trim();
  } catch { /* ignore */ }
  return headline(result);
}
