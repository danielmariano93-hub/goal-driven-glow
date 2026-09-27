// UserSafeError (`nino_safety.v2`) — único caminho autorizado a transformar uma
// falha técnica em texto para o usuário.
//
// Regra de produto: detalhes operacionais pertencem aos logs/painel admin.
// O usuário recebe uma frase curta, útil e humana — nunca nomes de provedor,
// status HTTP, runtime, contrato, motor, tool, "erro interno" ou explicações da
// mecânica que falhou.

export type UserSafeErrorCode =
  | "INTERNAL_ERROR"
  | "AI_TEMPORARY_UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "BUSINESS_RULE_ERROR"
  | "NOT_FOUND"
  | "PERMISSION_ERROR";

export const USER_SAFE_MESSAGES: Readonly<Record<UserSafeErrorCode, string>> = {
  INTERNAL_ERROR:
    "Não consegui concluir isso agora. Seus dados continuam como estavam. Pode tentar novamente daqui a pouco? 💛",
  AI_TEMPORARY_UNAVAILABLE:
    "Não consegui concluir isso agora. Seus dados continuam como estavam. Pode tentar novamente daqui a pouco? 💛",
  VALIDATION_ERROR:
    "Só preciso de mais um detalhe para fazer isso certinho. Pode me explicar um pouco melhor?",
  BUSINESS_RULE_ERROR:
    "Desse jeito eu não consigo registrar com segurança. Quer que eu te ajude a ajustar?",
  NOT_FOUND:
    "Não encontrei isso nos seus dados. Pode me dar um pouco mais de contexto?",
  PERMISSION_ERROR:
    "Não consegui concluir essa ação agora. Seus dados continuam como estavam. Tente novamente daqui a pouco.",
};

/**
 * Termos de infraestrutura que jamais podem chegar ao usuário.
 * "cartão de crédito" continua legítimo; "créditos do app" não.
 */
export const INFRA_LEAK_PATTERNS: readonly RegExp[] = [
  /cr[eé]ditos?\s+(?:do|da|de)\s+(?:app|aplicativo|conta|plataforma|workspace)/i,
  /(?:sem|acabaram?\s+os|adicionar|reativar|recarregar|repor)\s+(?:os\s+)?cr[eé]ditos/i,
  /cr[eé]ditos?\s+(?:acabaram|esgotad|insuficient)/i,
  /respons[aá]vel\s+pelo\s+app/i,
  /\b(?:lovable|openai|gpt-?\d|gemini|anthropic|claude|waha)\b/i,
  /\b(?:gateway|provider|upstream|service[_\s-]?role|api[_\s-]?key|rate\s*limit)\b/i,
  /\bHTTP\s*\d{3}\b/i,
  /\b(?:status|c[oó]digo|code|erro|error)\s*(?:HTTP\s*)?[:=]?\s*(?:40[23]|429|50[023])\b/i,
  /\b(?:40[23]|429|50[023])\s*(?:erro|error|status)\b/i,
  /configura[cç][ãa]o\s+administrativa/i,
];

/**
 * Jargão interno de execução. Mesmo quando não revela fornecedor, continua
 * sendo uma conversa de engenharia — não uma conversa do Nino com a pessoa.
 */
export const INTERNAL_PROCESS_LEAK_PATTERNS: readonly RegExp[] = [
  /\b(?:runtime|workflow|tool|engine|fail[- ]closed|circuit breaker|schema|payload)\b/i,
  /\b(?:contrato|motor)\s+(?:can[oô]nico|interno|de execu[cç][aã]o|sem[aâ]ntico)\b/i,
  /\bc[aá]lculo executado\b/i,
  /\brecorte da sua pergunta\b/i,
  /\bjanela(?: de compara[cç][aã]o)?\b/i,
  /\bregra de compara[cç][aã]o\b/i,
  /\bbloqueei a resposta\b/i,
  /\bexecutar essa an[aá]lise com seguran[cç]a\b/i,
  /\b(?:erro interno|falha t[eé]cnica|ocorreu um erro|deu erro)\b/i,
  /\b[a-z][a-z0-9_.-]{2,}_[a-z0-9_.-]{2,}\b/i,
];

export function leaksInfrastructure(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return [...INFRA_LEAK_PATTERNS, ...INTERNAL_PROCESS_LEAK_PATTERNS].some((rx) => rx.test(t));
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

export function userSafeMessage(e: unknown): string {
  return USER_SAFE_MESSAGES[classifyUserSafe(e)];
}

/**
 * Última barreira antes de qualquer resposta chegar ao canal.
 * Se houver linguagem de infraestrutura/processo, substitui a frase inteira em
 * vez de tentar "maquiar" pedaços e deixar resíduos estranhos.
 */
export function sanitizeUserFacingText(
  text: string,
  fallback: UserSafeErrorCode = "AI_TEMPORARY_UNAVAILABLE",
): string {
  const t = String(text ?? "");
  if (!leaksInfrastructure(t)) return t;
  return USER_SAFE_MESSAGES[fallback];
}