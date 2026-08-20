// ContinuationContract (`nino_continuation.v1`) — o Nino sabe qual pergunta ELE
// acabou de fazer.
//
// Antes: o Nino oferecia "quer comparar o acumulado do dia 1º até hoje com o
// mesmo período do mês passado? me dá o ok" e, ao receber "Ok", respondia
// "não encontrei nada pendente para confirmar" — porque só existia pendência de
// ESCRITA financeira (`pending_confirmations`). Aqui a oferta CONVERSACIONAL
// passa a ser persistida como operação estruturada e o "ok" a executa.
//
// Precedência de roteamento (não negociável):
//   ação conversacional pendente > escrita financeira pendente > ack genérico
// A escrita pendente ganha quando existe: confirmar lançamento nunca pode ser
// engolido por uma oferta de análise.

export type ContinuationActionType =
  | "financial_comparison"
  | "financial_performance"
  | "detail_breakdown"
  | "simulation"
  | "projection"
  | "generic_analysis";

export type ContinuationOperation = {
  metric?: string | null;
  scope?: string | null;
  subject?: string | null;
  comparison_mode?: string | null;
  /** Texto determinístico que reexecuta a operação oferecida. */
  restated_request: string;
};

export type PendingConversationAction = {
  action_type: ContinuationActionType;
  requested_operation: ContinuationOperation;
  confirmation_expected: true;
  accepted_answers: string[];
  asked_at: string;
  expires_at: string;
};

/** A oferta vale por 6h — depois disso a conversa já é outra. */
export const CONTINUATION_TTL_MS = 6 * 60 * 60 * 1000;

export const ACCEPTED_ANSWERS = [
  "sim", "ok", "okay", "pode", "pode sim", "claro", "manda", "manda ai", "segue",
  "quero", "bora", "vamos", "isso", "por favor", "faz", "traz", "mostra", "beleza", "blz", "aham",
];

/** Frases em que o Nino oferece fazer algo e espera um "ok". */
const OFFER_RX =
  /(quer(?:ia)? que eu\b)|(quer comparar)|(quer ver)|(posso comparar)|(posso te mostrar)|(posso detalhar)|(posso simular)|(posso calcular)|(posso trazer)|(me d[aá] o ok)|(me confirma que eu)|(se quiser,? eu (?:consigo|posso|trago))|(te trago esses n[uú]meros)|(eu consigo separar)/i;

const NEGATIVE_RX = /\b(n[aã]o|nada|depois|agora n[aã]o|deixa)\b/i;

function classifyOffer(text: string): ContinuationActionType {
  const t = text.toLowerCase();
  if (/(compar|mesmo per[ií]odo|m[eê]s passado|dias [uú]teis|ciclo)/.test(t)) return "financial_comparison";
  if (/(simul|se eu comprar|parcel)/.test(t)) return "simulation";
  if (/(proje|fechamento|vai sobrar|at[eé] o fim do m[eê]s)/.test(t)) return "projection";
  if (/(detalh|separar|abrir por|quebrar por|por categoria|por estabelecimento)/.test(t)) return "detail_breakdown";
  if (/(evolu|performance|como (?:voc[eê]|vc) est[aá])/.test(t)) return "financial_performance";
  return "generic_analysis";
}

function comparisonModeFrom(text: string): string | null {
  const t = text.toLowerCase();
  if (/dias? [uú]te/.test(t)) return "SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH";
  if (/ciclo|fatura/.test(t)) return "SAME_CARD_CYCLE_POINT";
  if (/(dia 1|1º|primeiro dia).*(m[eê]s passado|mesmo per[ií]odo)|acumulado do m[eê]s/.test(t)) return "MTD_EQUIVALENT";
  if (/m[eê]s passado|mesmo per[ií]odo/.test(t)) return "MTD_EQUIVALENT";
  if (/semana/.test(t)) return "WEEK_OVER_WEEK";
  if (/(30 dias|[uú]ltimos 30)/.test(t)) return "PREVIOUS_EQUIVALENT_PERIOD";
  return null;
}

/** Recorta a frase de oferta (uma sentença) para reexecutar exatamente aquilo. */
function offerSentence(text: string): string {
  const sentences = String(text ?? "").split(/(?<=[.!?\n])\s+/);
  const hit = sentences.find((s) => OFFER_RX.test(s));
  return (hit ?? text).replace(/\s+/g, " ").trim().slice(0, 400);
}

/** Detecta uma oferta do Nino na resposta que ele acabou de dar. */
export function detectContinuationOffer(
  replyText: string | null | undefined,
  now: Date = new Date(),
): PendingConversationAction | null {
  const text = String(replyText ?? "");
  if (!text.trim() || !OFFER_RX.test(text)) return null;
  const sentence = offerSentence(text);
  const action_type = classifyOffer(sentence);
  const mode = comparisonModeFrom(sentence);
  return {
    action_type,
    requested_operation: {
      metric: /receita|entrada/i.test(sentence) ? "income" : "expense",
      comparison_mode: mode,
      restated_request: sentence,
    },
    confirmation_expected: true,
    accepted_answers: ACCEPTED_ANSWERS,
    asked_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CONTINUATION_TTL_MS).toISOString(),
  };
}

export function isContinuationFresh(
  action: PendingConversationAction | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!action?.expires_at) return false;
  const at = Date.parse(action.expires_at);
  return Number.isFinite(at) && now.getTime() < at;
}

/** "ok", "sim", "pode", "manda" — resposta afirmativa curta e sem assunto novo. */
export function isAffirmativeAnswer(
  text: string,
  action?: PendingConversationAction | null,
): boolean {
  const raw = String(text ?? "").trim().toLowerCase()
    .replace(/[!?.,;:]+$/g, "")
    .replace(/\s+/g, " ");
  if (!raw || raw.split(" ").length > 4) return false;
  if (NEGATIVE_RX.test(raw)) return false;
  const accepted = action?.accepted_answers?.length ? action.accepted_answers : ACCEPTED_ANSWERS;
  return accepted.includes(raw) || accepted.some((a) => raw === `${a} ok` || raw === `${a} por favor`);
}

/**
 * Texto determinístico que substitui o "ok" no turno: o roteamento passa a ver
 * a operação completa que o próprio Nino ofereceu, em vez de um ack genérico.
 */
export function continuationPrompt(action: PendingConversationAction): string {
  const op = action.requested_operation;
  const mode = op.comparison_mode;
  const hint = mode === "SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH"
    ? " Use a comparação pelos mesmos dias úteis de cada mês."
    : mode === "SAME_CARD_CYCLE_POINT"
      ? " Compare no mesmo ponto do ciclo da fatura."
      : mode === "MTD_EQUIVALENT"
        ? " Compare o acumulado do dia 1º até hoje com o mesmo intervalo do mês anterior."
        : mode === "WEEK_OVER_WEEK"
          ? " Compare a semana atual até hoje com o mesmo ponto da semana anterior."
          : "";
  return `Sim, faça isso: ${op.restated_request}${hint}`.trim();
}

/** Decide se o turno atual é a continuação de uma oferta do Nino. */
export function resolveContinuation(args: {
  text: string;
  intentKind?: string | null;
  action: PendingConversationAction | null | undefined;
  hasPendingWrite: boolean;
  now?: Date;
}): { continue: boolean; prompt: string | null; action: PendingConversationAction | null; reason: string } {
  const now = args.now ?? new Date();
  if (!args.action || !isContinuationFresh(args.action, now)) {
    return { continue: false, prompt: null, action: null, reason: "no_fresh_offer" };
  }
  if (!isAffirmativeAnswer(args.text, args.action)) {
    return { continue: false, prompt: null, action: null, reason: "not_affirmative" };
  }
  // Precedência: escrita financeira pendente ganha do convite analítico.
  if (args.hasPendingWrite) {
    return { continue: false, prompt: null, action: null, reason: "pending_write_precedence" };
  }
  return {
    continue: true,
    prompt: continuationPrompt(args.action),
    action: args.action,
    reason: `continuation:${args.action.action_type}`,
  };
}
