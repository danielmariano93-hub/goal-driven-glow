// nino_habit_patterns.v2 — padrões comportamentais que a tela de hábitos e a inteligência
// proativa compartilham (função pura).
//
// Princípios:
//  - Candidato → testes de qualidade → ranking → insight explicável. No máximo 2 na tela.
//  - Um insight diz o que se repete, o que o Nino AINDA NÃO SABE e (só quando a resposta muda a
//    recomendação) faz UMA pergunta de contexto. As ações dependem da resposta, nunca da média.
//  - Fins de semana de várias categorias viram UM insight (consolidação), não vários cards iguais.
//  - Projeção é uma linha de consequência (hipótese), não o assunto da página.
//  - Compromisso só nasce com aceite explícito (aqui só se calcula a sugestão).
import { buildWeekendForecasts, weekendFridayOf, type WeekendForecast } from "./weekendForecast.ts";
import { detectWeekdayPatterns, type NudgeGoal, type NudgeTransaction, type WeekdayPattern } from "./weekdayNudge.ts";
import { money0 } from "./weekendMessages.ts";
import {
  ANSWER_INTERPRETATION, PATTERN_QUESTION, patternQuestionText, patternSubject, validAnswers,
  type ContextAnswerRow, type PatternAnswerKey,
} from "./habitContext.ts";

export const HABIT_PATTERNS_VERSION = "nino_habit_patterns.v2";

export const HABIT_PATTERN_RULES = {
  /** Máximo de descobertas no fluxo principal. */
  maxShown: 2,
  /** Abaixo disso o padrão não é mostrado (qualidade insuficiente). */
  minConfidence: 0.55,
  /** Categorias de fim de semana juntas num mesmo insight. */
  maxGrouped: 3,
  /** Utilidade mínima: a página não precisa estar sempre cheia. */
  minUtility: 0.15,
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
  /** Meta que o padrão atual pede (arredondada); só uma referência para a conversa. */
  goal_near_pattern: number | null;
  rationale: string[];
};

export type CreateGoalSuggestion = { kind: "create_goal"; category: string; near_pattern: number; rationale: string[] };
export type SharedExpensesSuggestion = { kind: "shared_expenses"; category: string; rationale: string[] };

export type PatternAction = LimitSuggestion | ReviewGoalSuggestion | CreateGoalSuggestion | SharedExpensesSuggestion;

export type PatternQuestion = {
  key: typeof PATTERN_QUESTION.key;
  text: string;
  options: Array<{ key: PatternAnswerKey; label: string }>;
};

export type HabitPattern = {
  id: string;
  type: "recurrence";
  scope: "weekend" | "weekday";
  /** Categorias do insight (consolidadas). */
  categories: string[];
  /** Categoria principal (compatibilidade). */
  category: string;
  /** Observação concreta, o que se repete. */
  title: string;
  /** Até três fatos recuperáveis (contagem, valor, janela). */
  evidence: string[];
  /** UMA linha de consequência financeira (hipótese, nunca promessa). */
  consequence: string;
  /** O que o Nino ainda não sabe (a razão da pergunta). */
  unknown: string | null;
  alternatives: string[];
  confidence: number;
  relevance: number;
  learning_value: number;
  utility: number;
  /** Pergunta de contexto: só existe quando a resposta muda a recomendação e ainda não foi respondida. */
  question: PatternQuestion | null;
  answer: { key: PatternAnswerKey; label: string } | null;
  interpretation: string | null;
  /** Ações conforme a resposta (vazio enquanto não há resposta). */
  actions: PatternAction[];
  /** Ações genéricas: só aparecem se a pessoa preferir não responder. */
  skip_actions: PatternAction[];
  /** Controle de repetição: um insight por conjunto de categorias e semana. */
  repetition_key: string;
};

const WEEKDAY_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round50 = (n: number) => Math.max(50, Math.round(n / 50) * 50);

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

const anchorWord = (f: WeekendForecast) => (f.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses");

type Member = {
  forecast: WeekendForecast;
  evidence: string;
  consequence: string;
  /** Ações por resposta (precalculadas). */
  byAnswer: Record<PatternAnswerKey, PatternAction[]>;
  generic: PatternAction[];
};

function genericActions(f: WeekendForecast, today: string): PatternAction[] {
  if (f.misaligned) {
    return [{
      kind: "review_goal", category: f.category, fair_per_weekend: f.fair_per_weekend, expected: f.expected_per_weekend,
      goal_near_pattern: f.state === "pressure" ? round50(f.projected_month) : null,
      rationale: [
        `Para fechar o mês na ${anchorWord(f)}, caberiam uns ${money0(f.fair_per_weekend)} por fim de semana — bem abaixo do seu padrão (${money0(f.expected_per_weekend)}).`,
        "Pode ser que a meta precise ser revista, e não o seu comportamento.",
      ],
    }];
  }
  if (f.target != null && f.projected_if_target != null && dow(today) !== 6 && dow(today) !== 0) {
    const scenarios: LimitScenario[] = [
      { label: "Manter o padrão", target: null, projected_month: f.projected_month, vs_anchor: round2(f.projected_month - f.anchor.amount) },
      { label: `Ficar em ${money0(f.target)}`, target: f.target, projected_month: f.projected_if_target, vs_anchor: round2(f.projected_if_target - f.anchor.amount) },
    ];
    if (f.fair_per_weekend > 0 && Math.round(f.fair_per_weekend / 10) * 10 !== f.target && f.fair_per_weekend < f.expected_per_weekend) {
      const fair = Math.max(10, Math.round(f.fair_per_weekend / 10) * 10);
      scenarios.push({ label: `Ficar em ${money0(fair)}`, target: fair, projected_month: round2(f.projected_month - f.expected_per_weekend + fair), vs_anchor: round2(f.projected_month - f.expected_per_weekend + fair - f.anchor.amount) });
    }
    return [{
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
    }];
  }
  return [];
}

function memberOf(f: WeekendForecast, today: string): Member {
  const over = f.projected_month - f.anchor.amount;
  const generic = genericActions(f, today);
  const evidence = `${f.category}: gasto em ${f.active_weekends} dos últimos ${f.weekends} fins de semana, em geral entre ${money0(f.low)} e ${money0(f.high)}${f.weekend_share >= 0.55 ? `; cerca de ${Math.round(f.weekend_share * 100)}% do gasto da categoria é de sexta a domingo` : ""}.`;
  const consequence = f.state === "pressure"
    ? `${f.category} pode fechar o mês perto de ${money0(f.projected_month)} (${money0(over)} acima da ${anchorWord(f)})`
    : `${f.category} está dentro da ${anchorWord(f)}, mas um fim de semana típico usa boa parte da folga (${money0(f.slack)})`;

  // Se já estava planejado: o ajuste é na meta (nunca um corte). Sem meta, uma meta perto do padrão deixa o mês previsível.
  const planned: PatternAction[] = f.state === "pressure"
    ? f.anchor.kind === "goal"
      ? [{
          kind: "review_goal", category: f.category, fair_per_weekend: f.fair_per_weekend, expected: f.expected_per_weekend, goal_near_pattern: round50(f.projected_month),
          rationale: [
            `Se esses gastos já estavam planejados, o ponto de partida é a meta: o seu padrão leva ${f.category} a algo perto de ${money0(round50(f.projected_month))} no mês, contra uma meta de ${money0(f.anchor.amount)}.`,
            "Você pode manter a meta como está (e decidir o que cortar), ou ajustá-la ao que de fato está planejado.",
          ],
        }]
      : [{
          kind: "create_goal", category: f.category, near_pattern: round50(f.projected_month),
          rationale: [`Como é um gasto planejado, uma meta perto de ${money0(round50(f.projected_month))} para ${f.category} deixa o mês previsível — sem apertar além do que já está combinado com você mesmo.`],
        }]
    : [];

  const shared: PatternAction[] = [{
    kind: "shared_expenses", category: f.category,
    rationale: [
      `Quando o gasto com ${f.category} envolve outras pessoas, dividir a conta separa o que é seu do que é compartilhado e deixa o seu número mais fiel.`,
    ],
  }];

  return {
    forecast: f, evidence, consequence, generic,
    byAnswer: { planned, spontaneous: generic, for_others: shared, depends: [] },
  };
}

function groupConsequence(members: Member[]): string {
  const parts = members.map((m) => m.consequence);
  if (parts.length === 1) return `Se esse ritmo continuar, ${parts[0]}.`;
  return `Se esse ritmo continuar: ${parts.slice(0, -1).join("; ")} e ${parts[parts.length - 1]}.`;
}

function answerOf(answers: Map<string, string[]>, categories: string[]): PatternAnswerKey | null {
  for (const c of categories) {
    const a = answers.get(`${patternSubject(c)}|planned_vs_spontaneous`)?.[0];
    if (a && a in ANSWER_INTERPRETATION) return a as PatternAnswerKey;
  }
  return null;
}

const ANSWER_LABEL = Object.fromEntries(PATTERN_QUESTION.options.map((o) => [o.key, o.label])) as Record<PatternAnswerKey, string>;

function weekendInsight(forecasts: WeekendForecast[], today: string, answers: Map<string, string[]>): HabitPattern {
  const members = forecasts.slice(0, HABIT_PATTERN_RULES.maxGrouped).map((f) => memberOf(f, today));
  const categories = members.map((m) => m.forecast.category);
  const confidence = Math.min(...members.map((m) => clamp01(0.5 + (m.forecast.active_weekends / m.forecast.weekends) * 0.35 - (m.forecast.data_gap ? 0.1 : 0))));
  const stake = (m: Member) => {
    const f = m.forecast;
    return clamp01((f.state === "pressure" ? Math.max(0, f.projected_month - f.anchor.amount) : f.slack) / Math.max(1, f.anchor.amount));
  };
  const relevance = clamp01(Math.max(...members.map(stake)) + 0.1 * (members.length - 1));
  const d = dow(today);
  const opportunity = d >= 1 && d <= 5 ? 1 : 0.5;

  const answer = answerOf(answers, categories);
  const skip_actions = members.flatMap((m) => m.generic);
  const branches = members.some((m) => m.generic.length > 0);
  const question: PatternQuestion | null = !answer && branches
    ? { key: PATTERN_QUESTION.key, text: patternQuestionText(categories), options: [...PATTERN_QUESTION.options] }
    : null;
  const learning = answer ? 0.6 : question ? 1 : 0.7;
  const actions = answer ? members.flatMap((m) => m.byAnswer[answer]) : [];
  const hasGap = members.some((m) => m.forecast.data_gap === "card_missing");

  return {
    id: `weekend:${[...categories].sort().join("+")}`,
    type: "recurrence",
    scope: "weekend",
    categories,
    category: categories[0],
    title: categories.length === 1
      ? `Seus fins de semana concentram o gasto com ${categories[0]}`
      : `Seus fins de semana concentram o gasto com ${categories.slice(0, -1).join(", ")} e ${categories[categories.length - 1]}`,
    evidence: members.map((m) => m.evidence),
    consequence: groupConsequence(members),
    unknown: "Ainda não sei se esses gastos são planejados, decididos na hora ou envolvem outras pessoas — e isso muda o que faz sentido sugerir.",
    alternatives: [
      "Alguns desses fins de semana podem ter sido viagens, eventos ou compras maiores que não se repetem.",
      ...(hasGap ? ["Há compras de cartão deste mês que ainda podem não ter sido lançadas."] : []),
    ],
    confidence: Math.round(confidence * 100) / 100,
    relevance: Math.round(relevance * 100) / 100,
    learning_value: learning,
    utility: Math.round(relevance * confidence * opportunity * learning * 1000) / 1000,
    question,
    answer: answer ? { key: answer, label: ANSWER_LABEL[answer] } : null,
    interpretation: answer ? ANSWER_INTERPRETATION[answer] : null,
    actions,
    skip_actions,
    repetition_key: `weekend:${[...categories].sort().join("+")}:${isoWeekKey(today)}`,
  };
}

function weekdayInsight(p: WeekdayPattern, today: string): HabitPattern {
  const confidence = clamp01(0.45 + (p.occurrences / p.weeks) * 0.4);
  const monthly = p.when_it_happens * p.weekday_count_in_month;
  const relevance = clamp01(monthly / 1000);
  const name = WEEKDAY_PLURAL[p.weekday];
  return {
    id: `weekday:${p.category}:${p.weekday}`,
    type: "recurrence",
    scope: "weekday",
    categories: [p.category],
    category: p.category,
    title: `Nas ${name}, ${p.category} costuma pesar mais`,
    evidence: [
      `Nas últimas ${p.weeks} semanas, você gastou com ${p.category} em ${p.occurrences} ${name}, em geral uns ${money0(p.when_it_happens)} por vez.`,
      `Nos outros dias, a média diária é de uns ${money0(p.typical_other_days)}.`,
    ],
    consequence: `Em um mês com ${p.weekday_count_in_month} ${name}, isso soma perto de ${money0(monthly)} só nesses dias.`,
    unknown: "Ainda não sei se são compras planejadas ou decisões do momento; vale olhar os registros.",
    alternatives: ["Pode ser uma rotina fixa da semana (compra de feira, mensalidade, transporte) e não um excesso."],
    confidence: Math.round(confidence * 100) / 100,
    relevance: Math.round(relevance * 100) / 100,
    learning_value: 0.7,
    utility: Math.round(relevance * confidence * 0.7 * 0.7 * 1000) / 1000,
    // Sem ação possível, perguntar não muda nada: não pergunta.
    question: null,
    answer: null,
    interpretation: null,
    actions: [],
    skip_actions: [],
    repetition_key: `weekday:${p.category}:${p.weekday}:${isoWeekKey(today)}`,
  };
}

export type BuildPatternsInput = {
  transactions: NudgeTransaction[];
  today: string;
  goals?: Record<string, NudgeGoal>;
  /** Respostas de contexto da pessoa (ainda válidas ou não: o filtro de validade é daqui). */
  contextAnswers?: ContextAnswerRow[];
  /** Repetições recentes (repetition_key) que não devem voltar a ser destaque. */
  recentKeys?: ReadonlySet<string>;
  /** Insights que a pessoa já recusou como destaque. */
  dismissedIds?: ReadonlySet<string>;
};

export type BuildPatternsResult = {
  version: string;
  shown: HabitPattern[];
  /** Candidatos descartados e por quê (auditoria e testes). */
  suppressed: Array<{ id: string; reason: "low_confidence" | "low_value" | "repeated" | "dismissed" | "overflow" | "covered_by_weekend" }>;
};

export function buildHabitPatterns(input: BuildPatternsInput): BuildPatternsResult {
  const { transactions, today } = input;
  const goals = input.goals ?? {};
  const answers = validAnswers(input.contextAnswers ?? [], today);
  const candidates: HabitPattern[] = [];

  const forecasts = buildWeekendForecasts(transactions, today, goals, { anyDay: true });
  const suppressed: BuildPatternsResult["suppressed"] = [];
  // Categorias fracas ficam de fora do grupo (um grupo só vale com confiança suficiente em cada categoria).
  const solid = forecasts.filter((f) => clamp01(0.5 + (f.active_weekends / f.weekends) * 0.35 - (f.data_gap ? 0.1 : 0)) >= HABIT_PATTERN_RULES.minConfidence);
  for (const f of forecasts) if (!solid.includes(f)) suppressed.push({ id: `weekend:${f.category}`, reason: "low_confidence" });
  if (solid.length) candidates.push(weekendInsight(solid, today, answers));
  const weekendCats = new Set(solid.map((f) => f.category));

  // Dias úteis (seg–qui): roda a detecção para cada dia da última semana.
  const seen = new Set<string>();
  for (let k = 0; k < 7; k++) {
    const d = addDays(today, -k);
    if ([5, 6, 0].includes(dow(d))) continue;
    for (const p of detectWeekdayPatterns(transactions, d)) {
      const id = `weekday:${p.category}:${p.weekday}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (weekendCats.has(p.category)) { suppressed.push({ id, reason: "covered_by_weekend" }); continue; }
      candidates.push(weekdayInsight(p, today));
    }
  }

  const kept: HabitPattern[] = [];
  for (const c of candidates) {
    if (c.confidence < HABIT_PATTERN_RULES.minConfidence) { suppressed.push({ id: c.id, reason: "low_confidence" }); continue; }
    if (c.utility < HABIT_PATTERN_RULES.minUtility) { suppressed.push({ id: c.id, reason: "low_value" }); continue; }
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
