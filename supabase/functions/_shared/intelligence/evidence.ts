import type { EvidencePackage, SemanticQuery } from "./contracts.ts";
import type { WeekdayPatternResult } from "../analytics/weekdayPattern.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function asEvidence(result: WeekdayPatternResult): EvidencePackage<WeekdayPatternResult> {
  return {
    metric_key: result.metric_key,
    formula_version: result.formula_version,
    period: result.period,
    sample_size: result.sample_size,
    confidence: result.confidence,
    result,
    exclusions: result.exclusions,
    outliers: result.outliers,
    limitations: result.limitations,
    generated_at: new Date().toISOString(),
  };
}

/** "nas últimas 12 semanas (01/06 a 16/08)" — período sempre dito em voz alta. */
function periodLabel(result: WeekdayPatternResult): string {
  const weeks = Math.max(1, Math.round(result.period.weeks_observed));
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `nas últimas ${weeks} semanas (${br(result.period.from)} a ${br(result.period.to)})`;
}

/** Base monetária e média verdadeira por dia corrido. */
function baseLabel(result: WeekdayPatternResult): string {
  const base = result.metric_base === "total_consumption" ? "todo o consumo confirmado" : "apenas os gastos ajustáveis";
  return `Considerei ${base}: ${BRL.format(result.base_amount)} no período, média de ${BRL.format(result.mean_per_day)} por dia corrido`;
}

function precisionCaveat(result: WeekdayPatternResult): string {
  if (result.bank_posting_share < 0.3) return "";
  const pct = Math.round(result.bank_posting_share * 100);
  return ` Vale a ressalva: ${pct}% desse valor veio da data de lançamento do extrato, então uma compra de fim de semana pode aparecer na segunda.`;
}

function weekdayRow(result: WeekdayPatternResult, weekday: number) {
  return result.weekdays.find((row) => row.weekday === weekday) ?? null;
}

/** Responde diretamente sobre os dias que o usuário citou. */
function mentionedAnswer(result: WeekdayPatternResult, weekdays: number[]): string {
  const rows = weekdays.map((w) => weekdayRow(result, w)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (!rows.length) return "";
  const ranked = [...result.weekdays].sort((a, b) => b.mean_all_days - a.mean_all_days);
  const parts = rows.map((row) => {
    const position = ranked.findIndex((r) => r.weekday === row.weekday) + 1;
    return `${row.label}: ${BRL.format(row.mean_all_days)} por dia (${position}º lugar)`;
  });
  const leader = ranked[0];
  const included = rows.some((row) => row.weekday === leader?.weekday);
  const closing = leader && !included
    ? ` Quem lidera é ${leader.label}, com ${BRL.format(leader.mean_all_days)} por dia.`
    : " É de fato o seu dia mais pesado.";
  return `${parts.join("; ")}.${closing}`;
}

export function composeWeekdayPatternReply(result: WeekdayPatternResult, query: SemanticQuery): string {
  const prefix = query.correction ? "Você tem razão em separar padrão de um pico isolado. " : "";
  const period = periodLabel(result);
  const base = baseLabel(result);
  const caveat = precisionCaveat(result);

  // Consultas literais de total/frequência/ticket têm contratos próprios e não
  // dependem de existir um vencedor de comportamento típico.
  if (query.interpretation === "total_concentration") {
    const w = result.total_concentration_winner;
    if (!w) return `${prefix}Não encontrei gastos ${period} para comparar os dias.`;
    return `${prefix}${w.label} concentrou ${w.share_pct}% do valor gasto ${period}. ${base}. Isso mede volume total, não seu comportamento típico.${caveat}`;
  }
  if (query.interpretation === "frequency") {
    const w = result.frequency_winner;
    if (!w) return `${prefix}Ainda não há histórico suficiente ${period} para comparar a frequência de compras por dia da semana.`;
    return `${prefix}${w.label} é o dia com maior frequência de compras ${period}, com média de ${w.transactions_per_occurrence.toFixed(1).replace(".0", "")} transações por ocorrência.${caveat}`;
  }
  if (query.interpretation === "average_ticket") {
    const w = result.ticket_winner;
    if (!w) return `${prefix}Ainda não há transações suficientes ${period} para calcular o ticket médio por dia da semana.`;
    return `${prefix}${w.label} tem o maior ticket médio ${period}, de ${BRL.format(w.average_ticket)} por compra.${caveat}`;
  }

  const anyMoney = result.base_amount > 0;
  if (!anyMoney) {
    const limitation = result.limitations[0];
    return `${prefix}Não encontrei gastos registrados ${period} para comparar os dias da semana.${limitation ? ` ${limitation}` : ""}`;
  }

  // Quando o usuário nomeia dias, a resposta começa pelo que ele perguntou.
  const mentioned = query.mentioned_weekdays ?? [];
  const mentionedBlock = mentioned.length ? mentionedAnswer(result, mentioned) : "";

  const ranked = [...result.weekdays].filter((row) => row.mean_all_days > 0)
    .sort((a, b) => b.mean_all_days - a.mean_all_days);
  const leader = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;
  const tie = Boolean(leader && runnerUp && leader.mean_all_days > 0
    && (leader.mean_all_days - runnerUp.mean_all_days) / leader.mean_all_days < 0.15);

  const head = mentionedBlock ? `${prefix}${mentionedBlock}` : prefix;

  let body: string;
  if (!leader) {
    body = `Ainda não consigo eleger um dia com segurança ${period}.`;
  } else if (tie && runnerUp) {
    body = `${period.charAt(0).toUpperCase()}${period.slice(1)}, ${leader.label} (${BRL.format(leader.mean_all_days)} por dia) e ${runnerUp.label} (${BRL.format(runnerUp.mean_all_days)} por dia) estão praticamente empatados na liderança — são os seus dois dias mais pesados.`;
  } else {
    body = `${period.charAt(0).toUpperCase()}${period.slice(1)}, ${leader.label} lidera com ${BRL.format(leader.mean_all_days)} por dia, contra ${runnerUp ? `${BRL.format(runnerUp.mean_all_days)} de ${runnerUp.label}` : "os demais dias"}.`;
  }

  const stability = result.decision === "established"
    ? "Isso já se repete com regularidade suficiente para eu chamar de padrão seu."
    : "Ainda é histórico curto para eu chamar de padrão consolidado, mas é a leitura real do período.";

  return [head, body, `${base}.${caveat}`, stability]
    .filter((part) => String(part ?? "").trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
