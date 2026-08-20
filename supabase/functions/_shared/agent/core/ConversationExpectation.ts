// ConversationExpectation — o Nino lembra o que ELE perguntou.
//
// Quando o Nino faz uma pergunta que espera resposta (lembrete de humor,
// "qual valor?", "qual cartão?"), a próxima mensagem deve ser lida como
// resposta a essa pergunta — não como assunto novo nem como complemento de
// uma pergunta financeira antiga. Puro e testável: só olha textos.

export type ExpectationKind = "emotional_checkin" | "entry_slot" | "category_scope";

export type ConversationExpectation = {
  kind: ExpectationKind;
  slots?: string[];
  asked_at: string;
};

/** Expectativa vale por 12h — depois disso a conversa já é outra. */
export const EXPECTATION_TTL_MS = 12 * 60 * 60 * 1000;

export function isExpectationFresh(
  expectation: ConversationExpectation | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expectation?.asked_at) return false;
  const at = Date.parse(expectation.asked_at);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at <= EXPECTATION_TTL_MS;
}

/** Pergunta de humor feita pelo Nino (chat ou lembrete proativo). */
const EMOTIONAL_QUESTION =
  /(se sentindo|se sentiu|como (?:voc[êe]|vc)\s+(?:est[aáà]|ta|t[aá]|anda|foi)\b)|(como (?:est[aá]|ta) (?:o )?(?:seu )?(?:humor|dia)\b)|(check[- ]?in (?:emocional|de humor))|(me conta(?:r)? em uma palavra como)|(como (?:foi|anda) (?:o )?seu dia)/i;


/** Slots de lançamento que o Nino costuma perguntar. */
const ENTRY_SLOT_QUESTION =
  /(qual (?:o )?valor)|(qual (?:o )?cart[aã]o)|(qual (?:a )?conta)|(qual (?:a )?data)|(qual (?:foi )?o estabelecimento)|(em quantas parcelas)/i;

const CATEGORY_QUESTION = /(qual (?:a )?categoria)|(de qual categoria)|(categoria e (?:o )?per[ií]odo)/i;

/** Deduz a expectativa a partir da última fala do Nino. */
export function detectExpectation(replyText: string | null | undefined, now: Date = new Date()):
  ConversationExpectation | null {
  const text = String(replyText ?? "");
  if (!text.trim()) return null;
  const asked_at = now.toISOString();
  if (EMOTIONAL_QUESTION.test(text)) return { kind: "emotional_checkin", asked_at };
  if (ENTRY_SLOT_QUESTION.test(text)) return { kind: "entry_slot", asked_at };
  if (CATEGORY_QUESTION.test(text)) return { kind: "category_scope", asked_at };
  return null;
}

/** Última fala do Nino no histórico do turno (assistant mais recente). */
export function expectationFromHistory(
  history: Array<{ role: string; content: string }> | null | undefined,
  now: Date = new Date(),
): ConversationExpectation | null {
  const last = [...(history ?? [])].reverse()
    .find((entry) => entry.role === "assistant" && String(entry.content ?? "").trim());
  return detectExpectation(last?.content ?? null, now);
}
