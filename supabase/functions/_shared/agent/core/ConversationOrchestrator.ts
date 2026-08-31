// ConversationOrchestrator (`nino_brain.v2`) — camada COMPREENDER.
//
// Responsabilidade única: transformar a mensagem crua + histórico em um plano
// de turno explícito (assunto, período resolvido, sub-perguntas). Não calcula
// nada financeiro e não fala com a LLM: apenas descreve o que foi perguntado.
import { comparablePrevious, currentMonthPeriod, resolvePeriodPt, resolvePeriodRolesPt, type PeriodRoleContract, type ResolvedPeriod } from "../../analytics/periodResolver.ts";

export type TurnPlan = {
  /** Texto usado pelo roteamento (pode herdar o assunto do turno anterior). */
  effective_text: string;
  /** A mensagem atual só complementa a anterior? */
  followup: boolean;
  /** Texto anterior herdado, quando houver. */
  inherited_from: string | null;
  /** Período explícito da pergunta; `null` quando o usuário não citou nenhum. */
  period: ResolvedPeriod | null;
  /** Período usado de fato (com default do mês em curso). */
  effective_period: ResolvedPeriod;
  /** Período comparável imediatamente anterior. */
  previous_period: { from: string; to: string };
  /** Contrato temporal canônico, com período principal e comparação separados. */
  period_roles: PeriodRoleContract;
  /** Sub-perguntas detectadas (>=2 quando a mensagem é composta). */
  tasks: string[];
  composed: boolean;
};

const NOISE = /^(ok|okay|blz|beleza|obrigado|obrigada|valeu|isso|entendi|👍|✅)\W*$/i;

/** Assuntos que, sozinhos, não formam pergunta (dependem do turno anterior). */
const CONTEXT_ONLY = [
  /^e\s+/i,
  /^(e\s+)?(no|em|de|do|da)\s+/i,
  /^(este|esse|neste|nesse|mes|m[eê]s|semana)\b/i,
  /^(agosto|julho|junho|maio|abril|mar[cç]o|fevereiro|janeiro|setembro|outubro|novembro|dezembro)\b/i,
  /^(e\s+)?(o\s+)?(mesmo|idem|igual)\b/i,
  /^(quanto|qual)\??$/i,
];

const SUBJECT_RX =
  /\b(gast|receit|renda|saldo|categoria|estabeleciment|fatura|cart[aã]o|d[ií]vida|meta|investiment|assinatur|previs[aã]o|fechamento|economi|padr[aã]o|compare|compara)/i;



/**
 * Continuação NÃO é "mensagem curta". Só é continuação a mensagem que depende
 * explicitamente da anterior: conector inicial, período isolado, anáfora ou
 * pergunta truncada. Frase autossuficiente ("estou me sentindo atento",
 * "pode registrar", "no crédito") nunca herda o assunto anterior — era isso
 * que fazia resposta curta sair colada numa pergunta financeira antiga.
 */
const MONTHS = /(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i;

/** Mensagem que é só período ("em agosto", "e no mês passado?", "esta semana"). */
const PERIOD_ONLY = new RegExp(
  String.raw`^(?:e\s+)?(?:no|na|em|de|do|da|durante)?\s*(?:${MONTHS.source}|m[eê]s passado|m[eê]s retrasado|este m[eê]s|esse m[eê]s|semana passada|esta semana|essa semana|[uú]ltimos?\s+\d+\s+(?:dias|semanas|meses)|hoje|ontem|anteontem|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*\??$`,
  "i",
);

/** Pergunta truncada que só faz sentido com o assunto anterior. */
const TRUNCATED_QUESTION = /^(?:e\s+)?(?:quanto|quais|qual|onde|quando|como|por que|porque|e a[ií])\s*\??$/i;

/** Referência anafórica ao assunto anterior. */
const ANAPHORA =
  /\b(nessa|nesta|naquela|dessa|desta|daquela|nesse|neste|naquele|desse|deste|daquele|no mesmo|na mesma|mesma coisa|o mesmo|idem|e o|e a)\b/i;

/** Conector inicial que indica complemento da pergunta anterior. */
const DEPENDENT_START = /^(?:e|mas|tamb[eé]m|al[eé]m disso|e ainda|comparado|comparando|idem|mesmo)\b/i;

/** Verbo/afirmação própria: a mensagem se explica sozinha. */
const SELF_CONTAINED =
  /\b(estou|est[aá]|t[oôo]|me sinto|me senti|sinto|senti|sentindo|acho|quero|preciso|vou|posso|pode|podes|registra|registre|anota|anote|marca|confirma|confirmo|cancela|sim|n[aã]o|obrigado|valeu|bom dia|boa tarde|boa noite|oi|ol[aá])\b/i;

function isContextOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (SUBJECT_RX.test(t)) return false;
  if (TRUNCATED_QUESTION.test(t)) return true;
  if (PERIOD_ONLY.test(t)) return true;
  if (SELF_CONTAINED.test(t)) return false;
  if (ANAPHORA.test(t)) return true;
  // Conector inicial só herda quando a frase é realmente um complemento curto.
  if (DEPENDENT_START.test(t) && t.split(/\s+/).length <= 8) return true;
  return CONTEXT_ONLY.some((rx) => rx.test(t)) && t.split(/\s+/).length <= 6;
}


/**
 * Quebra perguntas compostas em sub-perguntas ("quanto gastei e onde mais
 * gastei?"). Determinístico: só divide quando os dois lados têm verbo/assunto.
 */
export function splitTasks(text: string): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const bySentence = raw
    .split(/(?<=[?!.])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  const parts: string[] = [];
  for (const sentence of bySentence.length ? bySentence : [raw]) {
    const chunks = sentence
      .split(/\s*,?\s*\b(?:e tamb[eé]m|tamb[eé]m|e ainda|al[eé]m disso)\b\s*|\s+e\s+(?=(?:quanto|quais|qual|onde|como|quando|quem|me\s|preciso|mostra|manda|comparad|comparando|o que)\b)/i)
      .map((c) => c.trim())
      .filter((c) => c.length > 3);
    if (chunks.length > 1 && chunks.every((c) => /\b(quanto|quais|qual|onde|como|quando|quem|mostra|manda|represent|mudou|variou|compar)\b/i.test(c))) {
      parts.push(...chunks);
    } else {
      parts.push(sentence);
    }
  }
  return parts.slice(0, 4);
}

export function buildTurnPlan(args: {
  text: string;
  history?: Array<{ role: string; content: string }>;
  now?: Date;
}): TurnPlan {
  const now = args.now ?? new Date();
  const text = String(args.text ?? "").trim();
  const previousUser = [...(args.history ?? [])]
    .reverse()
    .find((entry) =>
      entry.role === "user"
      && String(entry.content ?? "").trim()
      && String(entry.content ?? "").trim() !== text
      && !NOISE.test(String(entry.content ?? "").trim())
      && SUBJECT_RX.test(String(entry.content ?? ""))
    )?.content ?? null;

  const followup = !!previousUser && isContextOnly(text) && !NOISE.test(text);
  const effective_text = followup ? `${String(previousUser).trim()} — ${text}` : text;

  const explicit = resolvePeriodPt(text, now);
  const inherited = followup ? resolvePeriodPt(String(previousUser), now) : null;
  const period = explicit ?? inherited;
  // Em follow-up, um período dito agora ("e em julho?") substitui apenas o
  // período herdado; o assunto continua herdado, mas a data anterior não cola.
  const roleText = explicit ? text : (followup ? effective_text : text);
  const resolvedRoles = resolvePeriodRolesPt(roleText, now);
  const effective_period = period && !resolvedRoles.source_span.current
    ? period
    : resolvedRoles.current_period;
  const period_roles: PeriodRoleContract = {
    ...resolvedRoles,
    current_period: effective_period,
  };

  const tasks = splitTasks(effective_text);

  return {
    effective_text,
    followup,
    inherited_from: followup ? String(previousUser) : null,
    period,
    effective_period,
    previous_period: comparablePrevious(effective_period),
    period_roles,
    tasks,
    composed: tasks.length > 1,
  };
}

/** Bloco de prompt determinístico que fixa período e sub-perguntas. */
export function turnPlanPrompt(plan: TurnPlan): string {
  const lines: string[] = [`[LEITURA DA PERGUNTA]`];
  if (plan.followup && plan.inherited_from) {
    lines.push(`Continuação do assunto anterior: "${String(plan.inherited_from).slice(0, 160)}".`);
  }
  lines.push(
    `Período a usar: ${plan.effective_period.label} (${plan.effective_period.from} a ${plan.effective_period.to})`
    + `${plan.effective_period.complete ? "" : " — período ainda em curso, diga isso se comparar com mês fechado"}.`,
  );
  const comparison = plan.period_roles.comparison_period ?? plan.previous_period;
  lines.push(`Período anterior comparável: ${comparison.from} a ${comparison.to}.`);
  lines.push(`Sempre passe from="${plan.effective_period.from}" e to="${plan.effective_period.to}" nas ferramentas que aceitam período.`);
  if (plan.composed) {
    lines.push(`A mensagem tem ${plan.tasks.length} perguntas. Responda TODAS, na ordem:`);
    plan.tasks.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
  }
  return lines.join("\n");
}
