// nino_habit_patterns.v1 — padrões comportamentais que a tela de hábitos e a inteligência
// proativa compartilham (função pura).
//
// Princípios (especificação de redesenho de hábitos):
//  - Candidato → testes de qualidade → ranking → insight explicável. No máximo 2 na tela.
//  - Cada padrão carrega observação, evidência recuperável, hipóteses alternativas,
//    confiança, relevância e UMA ação possível, opcional e reversível.
//  - Projeção é hipótese com intervalo, nunca promessa. Sem causa psicológica inventada.
//  - O compromisso só existe depois do aceite explícito (aqui só se calcula a sugestão).
import { buildWeekendForecasts, weekendFridayOf, type WeekendForecast } from "./weekendForecast.ts";
import { detectWeekdayPatterns, type NudgeGoal, type NudgeTransaction, type WeekdayPattern } from "./weekdayNudge.ts";
import { money0 } from "./weekendMessages.ts";

export const HABIT_PATTERNS_VERSION = "nino_habit_patterns.v1";

export const HABIT_PATTERN_RULES = {
  /** Máximo de descobertas no fluxo principal. */
  maxShown: 2,
  /** Abaixo disso o padrão não é mostrado (qualidade insuficiente). */
  minConfidence: 0.55,
} as const;

export type LimitScenario = { label: string; target: number | null; projected_month: number; vs_anchor: number };

export type LimitSuggestion = {
  kind: "suggest_limit";
  category: string;
  /** Sexta do fim de semana a que o limite se refere. */
  friday: string;
  target: number;
  expected: number;
  /** Hipótese do mês no ritmo atual, com faixa. */
  projected_before: number;
  projected_low: number;
  projected_high: number;
  projected_if_met: number;
  anchor: { kind: "goal" | "average"; amount: number };
  /** Conta em linguagem simples, passo a passo (sem pesos nem fórmulas). */
  rationale: string[];
  scenarios: LimitScenario[];
};

export type ReviewGoalSuggestion = {
  kind: "review_goal";
  category: string;
  fair_per_weekend: number;
  expected: number;
  rationale: string[];
};

export type HabitPattern = {
  id: string;
  type: "recurrence";
  scope: "weekend" | "weekday";
  category: string;
  /** Observação concreta, o que aconteceu. */
  title: string;
  /** Até três fatos recuperáveis (contagem, valor, janela). */
  evidence: string[];
  /** Por que pode importar (hipótese, não certeza). */
  meaning: string;
  /** Explicações alternativas que a pessoa deve poder considerar. */
  alternatives: string[];
  confidence: number;
  relevance: number;
  utility: number;
  action: LimitSuggestion | ReviewGoalSuggestion | null;
  /** Controle de repetição: um padrão por categoria e semana. */
  repetition_key: string;
};

const WEEKDAY_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function isoWeekKey(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dow(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function anchorWord(f: WeekendForecast): string {
  return f.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses";
}

function weekendPattern(f: WeekendForecast, today: string): HabitPattern {
  const confidence = clamp01(0.5 + (f.active_weekends / f.weekends) * 0.35 + (f.data_gap ? -0.1 : 0));
  const over = f.projected_month - f.anchor.amount;
  const stake = f.state === "pressure" ? Math.max(0, over) : f.slack;
  const relevance = clamp01(stake / Math.max(1, f.anchor.amount));
  // Oportunidade: dá para agir antes do fim de semana (seg–sex); sáb/dom já é tarde para esta rodada.
  const d = dow(today);
  const opportunity = d >= 1 && d <= 5 ? 1 : 0.5;
  const evidence = [
    `Você gastou com ${f.category} em ${f.active_weekends} dos últimos ${f.weekends} fins de semana, em geral entre ${money0(f.low)} e ${money0(f.high)} (média ${money0(f.expected_per_weekend)}).`,
    `Neste mês: ${money0(f.month_to_date)}. ${f.anchor.kind === "goal" ? "Sua meta" : "A média dos últimos 3 meses"} é ${money0(f.anchor.amount)}.`,
  ];
  if (f.weekend_share >= 0.55) evidence.push(`Cerca de ${Math.round(f.weekend_share * 100)}% do que você gasta com ${f.category} acontece de sexta a domingo.`);

  const meaning = f.state === "pressure"
    ? `Se esse padrão se repetir, o mês de ${f.category} pode fechar perto de ${money0(f.projected_month)} (entre ${money0(f.projected_low)} e ${money0(f.projected_high)}), ${money0(over)} acima da ${anchorWord(f)}.`
    : `Você está dentro da meta e ainda restam ${money0(f.slack)}; um fim de semana típico usa boa parte dessa folga.`;
  const alternatives = [
    "Alguns desses fins de semana podem ter sido viagens, eventos ou compras maiores que não se repetem.",
    ...(f.data_gap === "card_missing" ? ["Há compras de cartão deste mês que ainda podem não ter sido lançadas."] : []),
  ];

  let action: HabitPattern["action"] = null;
  if (f.misaligned) {
    action = {
      kind: "review_goal", category: f.category, fair_per_weekend: f.fair_per_weekend, expected: f.expected_per_weekend,
      rationale: [
        `Para fechar o mês na ${anchorWord(f)}, caberiam uns ${money0(f.fair_per_weekend)} por fim de semana — bem abaixo do seu padrão (${money0(f.expected_per_weekend)}).`,
        "Pode ser que a meta precise ser revista, e não o seu comportamento.",
      ],
    };
  } else if (f.target != null && f.projected_if_target != null && dow(today) !== 6 && dow(today) !== 0) {
    const scenarios: LimitScenario[] = [
      { label: "Manter o padrão", target: null, projected_month: f.projected_month, vs_anchor: round2(f.projected_month - f.anchor.amount) },
      { label: `Ficar em ${money0(f.target)}`, target: f.target, projected_month: f.projected_if_target, vs_anchor: round2(f.projected_if_target - f.anchor.amount) },
    ];
    if (f.fair_per_weekend > 0 && Math.round(f.fair_per_weekend / 10) * 10 !== f.target && f.fair_per_weekend < f.expected_per_weekend) {
      const fair = Math.max(10, Math.round(f.fair_per_weekend / 10) * 10);
      scenarios.push({ label: `Ficar em ${money0(fair)}`, target: fair, projected_month: round2(f.projected_month - f.expected_per_weekend + fair), vs_anchor: round2(f.projected_month - f.expected_per_weekend + fair - f.anchor.amount) });
    }
    action = {
      kind: "suggest_limit",
      category: f.category,
      friday: f.friday,
      target: f.target,
      expected: f.expected_per_weekend,
      projected_before: f.projected_month,
      projected_low: f.projected_low,
      projected_high: f.projected_high,
      projected_if_met: f.projected_if_target,
      anchor: f.anchor,
      rationale: [
        `Seu fim de semana típico com ${f.category} é de uns ${money0(f.expected_per_weekend)}.`,
        `Um limite de ${money0(f.target)} é um degrau possível (cerca de ${Math.round((1 - f.target / f.expected_per_weekend) * 100)}% abaixo do típico), não o corte total.`,
        `Trocando o gasto esperado deste fim de semana por ${money0(f.target)}, o mês de ${f.category} fecharia em torno de ${money0(f.projected_if_target)} — é uma estimativa, não uma garantia.`,
        ...(f.fair_per_weekend > 0 && f.state === "pressure" ? [`Para fechar na ${anchorWord(f)}, o ideal seria ficar perto de ${money0(f.fair_per_weekend)} por fim de semana.`] : []),
      ],
      scenarios,
    };
  }

  return {
    id: `weekend:${f.category}`,
    type: "recurrence",
    scope: "weekend",
    category: f.category,
    title: `Seus fins de semana pesam em ${f.category}`,
    evidence: evidence.slice(0, 3),
    meaning,
    alternatives,
    confidence: Math.round(confidence * 100) / 100,
    relevance: Math.round(relevance * 100) / 100,
    utility: Math.round(relevance * confidence * opportunity * 1000) / 1000,
    action,
    repetition_key: `weekend:${f.category}:${isoWeekKey(today)}`,
  };
}

function weekdayPattern(p: WeekdayPattern, today: string): HabitPattern {
  const confidence = clamp01(0.45 + (p.occurrences / p.weeks) * 0.4);
  const relevance = clamp01((p.when_it_happens * p.weekday_count_in_month) / 1000);
  const name = WEEKDAY_PLURAL[p.weekday];
  return {
    id: `weekday:${p.category}:${p.weekday}`,
    type: "recurrence",
    scope: "weekday",
    category: p.category,
    title: `Nas ${name}, ${p.category} costuma pesar mais`,
    evidence: [
      `Nas últimas ${p.weeks} semanas, você gastou com ${p.category} em ${p.occurrences} ${name}, em geral uns ${money0(p.when_it_happens)} por vez.`,
      `Nos outros dias, a média diária é de uns ${money0(p.typical_other_days)}.`,
    ],
    meaning: `Vale olhar os registros para entender se são compras planejadas ou decisões do momento.`,
    alternatives: ["Pode ser uma rotina fixa da semana (compra de feira, mensalidade, transporte) e não um excesso."],
    confidence: Math.round(confidence * 100) / 100,
    relevance: Math.round(relevance * 100) / 100,
    utility: Math.round(relevance * confidence * 0.7 * 1000) / 1000,
    action: null,
    repetition_key: `weekday:${p.category}:${p.weekday}:${isoWeekKey(today)}`,
  };
}

export type BuildPatternsInput = {
  transactions: NudgeTransaction[];
  today: string;
  goals?: Record<string, NudgeGoal>;
  /** Repetições recentes (repetition_key) que não devem voltar a ser destaque. */
  recentKeys?: ReadonlySet<string>;
  /** Categorias que a pessoa já recusou como destaque. */
  dismissedIds?: ReadonlySet<string>;
};

export type BuildPatternsResult = {
  version: string;
  shown: HabitPattern[];
  /** Candidatos descartados e por quê (auditoria e testes). */
  suppressed: Array<{ id: string; reason: "low_confidence" | "repeated" | "dismissed" | "overflow" | "covered_by_weekend" }>;
};

export function buildHabitPatterns(input: BuildPatternsInput): BuildPatternsResult {
  const { transactions, today } = input;
  const goals = input.goals ?? {};
  const candidates: HabitPattern[] = [];

  for (const f of buildWeekendForecasts(transactions, today, goals, { anyDay: true })) candidates.push(weekendPattern(f, today));
  const weekendCats = new Set(candidates.map((c) => c.category));

  // Dias úteis (seg–qui): roda a detecção para cada dia da última semana.
  const seen = new Set<string>();
  for (let k = 0; k < 7; k++) {
    const d = addDays(today, -k);
    if ([5, 6, 0].includes(dow(d))) continue;
    for (const p of detectWeekdayPatterns(transactions, d)) {
      const id = `weekday:${p.category}:${p.weekday}`;
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(weekdayPattern(p, today));
    }
  }

  const suppressed: BuildPatternsResult["suppressed"] = [];
  const kept: HabitPattern[] = [];
  for (const c of candidates) {
    if (c.scope === "weekday" && weekendCats.has(c.category)) { suppressed.push({ id: c.id, reason: "covered_by_weekend" }); continue; }
    if (c.confidence < HABIT_PATTERN_RULES.minConfidence) { suppressed.push({ id: c.id, reason: "low_confidence" }); continue; }
    if (input.dismissedIds?.has(c.id)) { suppressed.push({ id: c.id, reason: "dismissed" }); continue; }
    if (input.recentKeys?.has(c.repetition_key)) { suppressed.push({ id: c.id, reason: "repeated" }); continue; }
    kept.push(c);
  }
  kept.sort((a, b) => b.utility - a.utility);
  const shown = kept.slice(0, HABIT_PATTERN_RULES.maxShown);
  for (const c of kept.slice(HABIT_PATTERN_RULES.maxShown)) suppressed.push({ id: c.id, reason: "overflow" });
  return { version: HABIT_PATTERNS_VERSION, shown, suppressed };
}

export { weekendFridayOf };
