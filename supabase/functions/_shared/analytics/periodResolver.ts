// PeriodResolver (`period_truth.v1`) — resolução determinística de períodos em
// português, sempre em America/Sao_Paulo e sempre com datas explícitas.
// A LLM NUNCA inventa datas: quem fala o período é este módulo.

export type ResolvedPeriod = {
  from: string;
  to: string;
  /** Rótulo humano usado na resposta ("agosto", "últimos 30 dias"). */
  label: string;
  /** Trecho reconhecido no texto. */
  matched: string;
  /** Mês completo (até o último dia) ou mês em curso (até hoje)? */
  complete: boolean;
  kind: "day" | "week" | "month" | "rolling" | "range";
};

export type PeriodRoleContract = {
  current_period: ResolvedPeriod;
  comparison_period: { from: string; to: string; label?: string } | null;
  comparison_basis: "calendar_previous_month" | "preceding_window" | null;
  source_span: { current: string; comparison: string | null };
};

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const MONTH_LABELS = Object.keys(MONTHS);

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

export function todaySP(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthPeriod(year: number, month: number, today: string, complete: boolean): ResolvedPeriod {
  const mm = String(month).padStart(2, "0");
  const from = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
  const to = complete ? last : (last > today && from <= today ? today : last);
  return {
    from, to, label: MONTH_LABELS[month - 1], matched: MONTH_LABELS[month - 1],
    complete: to === last, kind: "month",
  };
}

function rolling(days: number, today: string, label: string, matched: string): ResolvedPeriod {
  return { from: shift(today, -(days - 1)), to: today, label, matched, complete: true, kind: "rolling" };
}

/**
 * Resolve o período citado na mensagem. Retorna `null` quando o texto não
 * menciona período algum — nesse caso o chamador decide o default (nunca aqui).
 */
export function resolvePeriodPt(text: string, now: Date = new Date()): ResolvedPeriod | null {
  const t = norm(text);
  if (!t) return null;
  const today = todaySP(now);
  const [year, month] = today.split("-").map(Number);

  if (/\bhoje\b/.test(t)) return { from: today, to: today, label: "hoje", matched: "hoje", complete: true, kind: "day" };
  if (/\bontem\b/.test(t)) {
    const d = shift(today, -1);
    return { from: d, to: d, label: "ontem", matched: "ontem", complete: true, kind: "day" };
  }
  if (/\b(semana passada|ultima semana)\b/.test(t)) {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const thisMonday = shift(today, -((dow + 6) % 7));
    return { from: shift(thisMonday, -7), to: shift(thisMonday, -1), label: "semana passada", matched: "semana passada", complete: true, kind: "week" };
  }
  if (/\b(esta semana|essa semana|nesta semana|semana atual)\b/.test(t)) {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    return { from: shift(today, -((dow + 6) % 7)), to: today, label: "esta semana", matched: "esta semana", complete: false, kind: "week" };
  }
  if (/\bmesmo periodo do mes passado\b/.test(t)) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const dayOfMonth = Number(today.slice(8, 10));
    const mm = String(prevMonth).padStart(2, "0");
    const cap = Math.min(dayOfMonth, lastDayOfMonth(prevYear, prevMonth));
    return {
      from: `${prevYear}-${mm}-01`, to: `${prevYear}-${mm}-${String(cap).padStart(2, "0")}`,
      label: "mesmo período do mês passado", matched: "mesmo periodo do mes passado",
      complete: false, kind: "range",
    };
  }
  if (/\b(mes passado|mes anterior)\b/.test(t)) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const p = monthPeriod(prevYear, prevMonth, today, true);
    return { ...p, label: "mês passado", matched: "mês passado" };
  }
  const lastMonths = t.match(/\bultimos?\s+(dois|tres|2|3|4|5|6)\s+meses\b/);
  if (lastMonths) {
    const map: Record<string, number> = { dois: 2, tres: 3 };
    const count = map[lastMonths[1]] ?? Number(lastMonths[1]);
    const startMonth = ((month - count) % 12 + 12) % 12 || 12;
    const startYear = month - count < 1 ? year - 1 : year;
    return {
      from: `${startYear}-${String(startMonth).padStart(2, "0")}-01`, to: today,
      label: `últimos ${count} meses`, matched: lastMonths[0], complete: false, kind: "range",
    };
  }
  const rollingDays = t.match(/\bultimos?\s+(\d{1,3})\s+dias\b/);
  if (rollingDays) {
    const days = Math.max(1, Math.min(730, Number(rollingDays[1])));
    return rolling(days, today, `últimos ${days} dias`, rollingDays[0]);
  }
  if (/\b(comeco|inicio) do mes\b/.test(t)) {
    return {
      from: `${year}-${String(month).padStart(2, "0")}-01`, to: shift(`${year}-${String(month).padStart(2, "0")}-01`, 9),
      label: "começo do mês", matched: "começo do mês", complete: true, kind: "range",
    };
  }

  const namedMonth = MONTH_LABELS.find((name) => new RegExp(`\\b${name}\\b`).test(t));
  if (namedMonth) {
    const m = MONTHS[namedMonth];
    const explicitYear = Number(t.match(new RegExp(`${namedMonth}(?:\\s+de)?\\s+(20\\d{2})`))?.[1] ?? 0);
    const targetYear = explicitYear || (m > month ? year - 1 : year);
    const wantsComplete = /\b(mes inteiro|inteiro|fechado|completo|todo o mes)\b/.test(t);
    const isCurrentMonth = targetYear === year && m === month;
    return monthPeriod(targetYear, m, today, wantsComplete || !isCurrentMonth);
  }

  if (/\b(este mes|esse mes|neste mes|nesse mes|mes atual|no mes)\b/.test(t)) {
    const p = monthPeriod(year, month, today, /\b(mes inteiro|todo o mes)\b/.test(t));
    return { ...p, label: "este mês", matched: "este mês" };
  }
  if (/\bate hoje\b/.test(t)) {
    const p = monthPeriod(year, month, today, false);
    return { ...p, label: "este mês até hoje", matched: "até hoje" };
  }

  return null;
}

/** Período padrão quando a mensagem não cita nenhum: mês em curso. */
export function currentMonthPeriod(now: Date = new Date()): ResolvedPeriod {
  const today = todaySP(now);
  const [year, month] = today.split("-").map(Number);
  const p = monthPeriod(year, month, today, false);
  return { ...p, label: "este mês", matched: "" };
}

/**
 * Resolve as expressões temporais pelo PAPEL que exercem na pergunta.
 * Uma referência introduzida por "comparado/versus" nunca substitui o
 * período principal. Esse contrato é a fonte única para planner e telemetria.
 */
export function resolvePeriodRolesPt(text: string, now: Date = new Date()): PeriodRoleContract {
  const raw = String(text ?? "");
  const normalized = norm(raw);

  const namedPair = normalized.match(new RegExp(`\\b(${MONTH_LABELS.join("|")})(?:\\s+de\\s+(20\\d{2}))?\\s+(?:comparad[oa]s?\\s+(?:a|com)|versus|vs)\\s+(?:o\\s+)?(${MONTH_LABELS.join("|")})(?:\\s+de\\s+(20\\d{2}))?\\b`));
  if (namedPair) {
    const currentText = `${namedPair[1]}${namedPair[2] ? ` de ${namedPair[2]}` : ""}`;
    const comparisonText = `${namedPair[3]}${namedPair[4] ? ` de ${namedPair[4]}` : ""}`;
    const current = resolvePeriodPt(currentText, now) ?? currentMonthPeriod(now);
    const comparison = resolvePeriodPt(comparisonText, now);
    return {
      current_period: current,
      comparison_period: comparison ? { from: comparison.from, to: comparison.to, label: comparison.label } : null,
      comparison_basis: "calendar_previous_month",
      source_span: { current: currentText, comparison: comparisonText },
    };
  }

  // Marcadores explícitos do período principal têm precedência sobre qualquer
  // expressão comparativa presente mais cedo ou mais tarde na frase.
  const currentSpan = normalized.match(/\b(este mes|esse mes|neste mes|nesse mes|mes atual|mes em curso)\b/)?.[0] ?? null;
  const comparisonSpan = normalized.match(/\b(mesmo periodo (?:do|de) mes (?:passado|anterior)|mesmo recorte (?:do|de) mes (?:passado|anterior)|mes passado|mes anterior)\b/)?.[0] ?? null;
  const hasComparisonConnector = /\b(compar|versus|vs|em relacao|contra)\b/.test(normalized)
    || /\bmesmo (?:periodo|recorte)\b/.test(normalized);

  const current = currentSpan
    ? (resolvePeriodPt(currentSpan, now) ?? currentMonthPeriod(now))
    : comparisonSpan && hasComparisonConnector
      ? currentMonthPeriod(now)
      : (resolvePeriodPt(raw, now) ?? currentMonthPeriod(now));

  if (comparisonSpan && hasComparisonConnector) {
    return {
      current_period: current,
      comparison_period: samePeriodPreviousMonth(current),
      comparison_basis: "calendar_previous_month",
      source_span: { current: currentSpan ?? "período atual implícito", comparison: comparisonSpan },
    };
  }

  if (/\b(?:periodo|janela) imediatamente anterior\b/.test(normalized) || /\bcomparad[oa]s? ao periodo anterior\b/.test(normalized)) {
    return {
      current_period: current,
      comparison_period: comparablePrevious(current),
      comparison_basis: "preceding_window",
      source_span: { current: currentSpan ?? current.matched, comparison: "período imediatamente anterior" },
    };
  }

  return {
    current_period: current,
    comparison_period: null,
    comparison_basis: null,
    source_span: { current: currentSpan ?? current.matched, comparison: null },
  };
}

/** Período anterior comparável (mesma duração, imediatamente antes). */
export function comparablePrevious(period: { from: string; to: string }): { from: string; to: string } {
  const days = Math.max(1, Math.round(
    (Date.parse(`${period.to}T12:00:00Z`) - Date.parse(`${period.from}T12:00:00Z`)) / 86_400_000,
  ) + 1);
  return { from: shift(period.from, -days), to: shift(period.from, -1) };
}

/** Mesmo recorte deslocado um mês calendário, com clamp no fim do mês. */
export function samePeriodPreviousMonth(period: { from: string; to: string }): { from: string; to: string } {
  const move = (iso: string): string => {
    const [year, month, day] = iso.split("-").map(Number);
    const targetMonthIndex = month - 2;
    const lastDay = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
    const target = new Date(Date.UTC(year, targetMonthIndex, Math.min(day, lastDay)));
    return target.toISOString().slice(0, 10);
  };
  return { from: move(period.from), to: move(period.to) };
}
