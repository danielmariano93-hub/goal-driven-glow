// UserSafeError (`nino_safety.v1`) — único caminho autorizado a transformar uma
// falha técnica em texto para o usuário.
//
// Causa raiz que este módulo fecha: mensagens de infraestrutura (créditos de
// IA, provedor, status HTTP, "o responsável pelo app precisa reativar") eram
// escritas direto na resposta do Nino. O usuário final não tem contexto nem
// poder de ação sobre isso — e a menção expõe operação interna.
//
// Regra: detalhe completo continua em `agent_runs`, logs e painel admin.
// Para o usuário, só existe categoria + texto neutro.

export type UserSafeErrorCode =
  | "INTERNAL_ERROR"
  | "AI_TEMPORARY_UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "BUSINESS_RULE_ERROR"
  | "NOT_FOUND"
  | "PERMISSION_ERROR";

export const USER_SAFE_MESSAGES: Readonly<Record<UserSafeErrorCode, string>> = {
  INTERNAL_ERROR:
    "Tive um problema técnico agora e não consegui concluir. Nada foi alterado nos seus dados. Pode tentar de novo em instantes? 💛",
  AI_TEMPORARY_UNAVAILABLE:
    "Estou com uma limitação temporária para analisar isso agora. Seus dados estão seguros e nada foi alterado. Pode tentar de novo em alguns minutos? 💛",
  VALIDATION_ERROR:
    "Faltou uma informação para eu concluir. Pode me repetir com mais detalhes?",
  BUSINESS_RULE_ERROR:
    "Não consigo concluir dessa forma — a operação não foi registrada. Quer tentar de outro jeito?",
  NOT_FOUND:
    "Não encontrei os dados necessários para responder isso. Pode me dar mais contexto?",
  PERMISSION_ERROR:
    "Não consegui autorizar essa operação. Verifique se sua conta está ativa e tente de novo.",
};

/**
 * Termos que jamais podem chegar ao usuário. Escritos de forma específica de
 * propósito: "cartão de crédito" é assunto legítimo do produto, "créditos do
 * app" é infraestrutura.
 */
export const INFRA_LEAK_PATTERNS: readonly RegExp[] = [
  /cr[eé]ditos?\s+(?:do|da|de)\s+(?:app|aplicativo|conta|plataforma|workspace)/i,
  /(?:sem|acabaram?\s+os|adicionar|reativar|recarregar|repor)\s+(?:os\s+)?cr[eé]ditos/i,
  /cr[eé]ditos?\s+(?:acabaram|esgotad|insuficient)/i,
  /respons[aá]vel\s+pelo\s+app/i,
  /\b(?:lovable|openai|gpt-?\d|gemini|anthropic|claude|waha)\b/i,
  /\b(?:gateway|provider|upstream|service[_\s-]?role|api[_\s-]?key|rate\s*limit)\b/i,
  // Só é vazamento quando o número vem com contexto HTTP explícito. Valor
  // monetário legítimo ("R$ 500,00", "parcela 403") nunca casa aqui.
  /\bHTTP\s*\d{3}\b/i,
  /\b(?:status|c[oó]digo|code|erro|error)\s*(?:HTTP\s*)?[:=]?\s*(?:40[23]|429|50[023])\b/i,
  /\b(?:40[23]|429|50[023])\s*(?:erro|error|status)\b/i,

  /configura[cç][ãa]o\s+administrativa/i,
];

/** Um texto contém vazamento de infraestrutura? */
export function leaksInfrastructure(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return INFRA_LEAK_PATTERNS.some((rx) => rx.test(t));
}

/** Classifica qualquer erro técnico em uma categoria segura para o usuário. */
export function classifyUserSafe(e: unknown): UserSafeErrorCode {
  const s = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
  if (!s) return "INTERNAL_ERROR";
  if (/gateway_40[23]|\b40[23]\b|ai_blocked|circuit|credit|quota|sem cr[eé]dito|rate limit|429|gateway_5\d\d|timeout|abort|fetch failed|econnreset/.test(s)) {
    return "AI_TEMPORARY_UNAVAILABLE";
  }
  if (/forbidden|unauthorized|not allowed|permission|rls/.test(s)) return "PERMISSION_ERROR";
  if (/not_found|no rows|does not exist/.test(s)) return "NOT_FOUND";
  if (/invalid|missing|schema|required|malformed|bad_json/.test(s)) return "VALIDATION_ERROR";
  if (/not_owned|transfer_not_editable|expired|empty_patch|ambiguous/.test(s)) return "BUSINESS_RULE_ERROR";
  return "INTERNAL_ERROR";
}

/** Texto neutro para um erro técnico qualquer. */
export function userSafeMessage(e: unknown): string {
  return USER_SAFE_MESSAGES[classifyUserSafe(e)];
}

/**
 * Guarda de saída: última barreira antes de a resposta ir para o canal.
 * Se o texto vazar infraestrutura, ele é substituído inteiro pelo texto neutro
 * (nunca editado parcialmente — meia frase de infraestrutura ainda vaza).
 */
export function sanitizeUserFacingText(
  text: string,
  fallback: UserSafeErrorCode = "AI_TEMPORARY_UNAVAILABLE",
): string {
  const t = String(text ?? "");
  if (!leaksInfrastructure(t)) return t;
  return USER_SAFE_MESSAGES[fallback];
}
