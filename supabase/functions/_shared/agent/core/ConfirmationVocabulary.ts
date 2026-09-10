// ConfirmationVocabulary (`nino_confirmation.v1`) — vocabulário determinístico
// de confirmação/cancelamento, puro e testável.
//
// Causa raiz do incidente de 10/09/2026: existia um rascunho válido e o usuário
// respondeu "Salvar". O parser só conhecia "sim/ok/pode/confirma/beleza/manda",
// então o turno virou pergunta nova, foi para a camada de análise e produziu
// uma negação falsa de capability ("não consigo confirmar por aqui").
//
// REGRA: estas palavras NÃO são confirmação universal. Elas só resolvem um
// turno quando existe uma operação pendente naquela conversa/usuário. Quem
// aplica esse contexto é o ConfirmationFastPath.

export type ConfirmationAct = "confirm" | "cancel" | "ambiguous" | "unrelated";

/** Normaliza caixa, acento, emoji, pontuação e espaço. */
export function normalizeConfirmationText(text: string | null | undefined): string {
  return String(text ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // emojis e símbolos ficam preservados apenas como marcador conhecido
    .replace(/👍|✅|🆗|👌/g, " sim ")
    .replace(/❌|🚫|👎/g, " nao ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Termos de confirmação aceitos como frase inteira (≤ 5 palavras). */
const CONFIRM_TERMS = [
  "sim", "s", "isso", "e isso", "isso mesmo", "isso ai", "exato", "exatamente",
  "certinho", "certo", "correto", "confere", "ok", "okay", "oks", "ta ok", "ta certo",
  "beleza", "blz", "fechado", "fechou", "combinado", "claro", "positivo", "yes",
  "confirma", "confirmar", "confirmo", "confirmado", "confirmada",
  "salvar", "salva", "salve", "salvo", "pode salvar", "pode salva", "salva sim",
  "registra", "registrar", "registre", "pode registrar", "pode registra", "registra sim",
  "lanca", "lancar", "lance", "pode lancar", "pode lanca",
  "manda", "mandar", "manda ver", "pode mandar", "vai", "pode ir",
  "pode", "pode sim", "pode fazer", "pode seguir", "segue", "pode continuar",
  "faz", "faca", "pode salvar sim", "ta bom", "tudo certo", "perfeito", "isso e",
];

/** Termos de cancelamento aceitos como frase inteira (≤ 5 palavras). */
const CANCEL_TERMS = [
  "nao", "n", "nops", "negativo", "no",
  "cancela", "cancelar", "cancele", "cancelado", "pode cancelar",
  "deixa", "deixa pra la", "deixa assim", "esquece", "esqueca",
  "nao salva", "nao salvar", "nao salve", "nao registra", "nao registrar",
  "nao lanca", "nao lancar", "nao precisa", "nao quero", "nao era isso",
  "desconsidera", "desconsiderar", "descarta", "descartar", "apaga", "apagar",
  "esta errado", "ta errado", "errado", "nao e isso", "nao foi isso",
];

const CONFIRM_SET = new Set(CONFIRM_TERMS);
const CANCEL_SET = new Set(CANCEL_TERMS);

/** Primeira palavra que já indica direção, para frases curtas com ruído. */
const CONFIRM_HEAD = /^(sim|ok|okay|beleza|blz|fechado|fechou|claro|positivo|confirm\w*|salv\w*|registr\w*|lanc\w*|manda|mandar|pode|isso|exato|certinho|correto|confere|perfeito|combinado)\b/;
const CANCEL_HEAD = /^(nao|negativo|cancel\w*|deixa|esquec\w*|desconsider\w*|descart\w*|apag\w*|errado)\b/;

/** Marcadores de leitura/pergunta: nunca confirmam escrita. */
const READ_MARKER = /\b(quanto|quantos|quantas|qual|quais|quando|onde|como|porque|por que|me diz|me dizer|mostra|mostrar|ver|listar|lista|resumo|saldo|extrato|relatorio|analise|gastei|gasto|sobrou)\b/;

/** Negação explícita de escrita: sempre cancelamento, nunca confirmação. */
const CANCEL_STRONG = /\bnao\s+(salv\w*|registr\w*|lanc\w*|precisa|quero|confirm\w*|e isso|foi isso)\b/;

/**
 * Classifica a mensagem como ato de confirmação/cancelamento.
 * `unrelated` = a mensagem tem assunto próprio; o pipeline normal segue.
 * `ambiguous` = parece resposta ao rascunho, mas sem direção clara → perguntar.
 */
export function classifyConfirmationAct(text: string | null | undefined): ConfirmationAct {
  const norm = normalizeConfirmationText(text);
  if (!norm) return "unrelated";

  if (CANCEL_STRONG.test(norm)) return "cancel";

  const words = norm.split(" ").filter(Boolean);
  // Frase exata (o caso dominante: "salvar", "sim", "pode salvar").
  if (CONFIRM_SET.has(norm)) return "confirm";
  if (CANCEL_SET.has(norm)) return "cancel";

  // Frase curta com pontuação/ruído já removidos.
  if (words.length <= 5) {
    // Valor ou pergunta dentro de frase curta não é confirmação: é conteúdo novo.
    if (/\d/.test(norm)) return "unrelated";
    // "pode me dizer quanto gastei" começa com "pode", mas é LEITURA.
    if (READ_MARKER.test(norm)) return "unrelated";
    const confirmHead = CONFIRM_HEAD.test(norm);
    const cancelHead = CANCEL_HEAD.test(norm);
    if (confirmHead && cancelHead) return "ambiguous";
    if (confirmHead) return "confirm";
    if (cancelHead) return "cancel";
    // "acho que sim", "talvez", "sei la" → pergunta antes de escrever.
    if (/\b(acho|talvez|sei la|nao sei|quem sabe)\b/.test(norm)) return "ambiguous";
    if (words.length <= 2 && (CONFIRM_SET.has(words[0]) || CANCEL_SET.has(words[0]))) {
      return CONFIRM_SET.has(words[0]) ? "confirm" : "cancel";
    }
  }
  return "unrelated";
}

/** Ato forte: usado para responder mesmo quando o rascunho já expirou. */
export function isStrongConfirmationAct(text: string | null | undefined): boolean {
  const act = classifyConfirmationAct(text);
  return act === "confirm" || act === "cancel";
}
