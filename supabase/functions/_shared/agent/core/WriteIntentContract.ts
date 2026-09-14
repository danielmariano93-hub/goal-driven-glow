// WriteIntentContract — contrato mínimo entre interpretação e tools de escrita.
//
// Não escolhe intenção e não consulta banco. Apenas garante que, quando o
// parser já reconheceu um domínio de escrita de alta confiança, tools de OUTRO
// domínio não ficam disponíveis no mesmo turno. Isso remove a classe de erro
// "meta → transação → primeiro draft vence" sem criar outro roteador.
import type { ParsedIntent } from "../parser.ts";

const CANONICAL_DRAFT_BY_INTENT: Partial<Record<ParsedIntent["kind"], string>> = {
  transaction: "create_transaction_draft",
  transfer: "create_transfer_draft",
  goal: "create_goal_draft",
  goal_contribution: "add_goal_contribution_draft",
};

export function canonicalDraftForIntent(intent: ParsedIntent): string | null {
  return CANONICAL_DRAFT_BY_INTENT[intent.kind] ?? null;
}

export function isDraftWriteTool(tool: string | null | undefined): boolean {
  return /_draft$/.test(String(tool ?? ""));
}

/**
 * Mantém READ/list tools do capability scope e, para uma escrita reconhecida,
 * expõe no máximo UM draft compatível. Intent desconhecida não é restringida
 * aqui porque o contrato não tem evidência suficiente para decidir o domínio.
 */
export function scopeToolsToWriteIntent(
  allowedTools: readonly string[] | undefined,
  intent: ParsedIntent,
): readonly string[] | undefined {
  const canonical = canonicalDraftForIntent(intent);
  if (!canonical || !allowedTools) return allowedTools;
  return allowedTools.filter((tool) => !isDraftWriteTool(tool) || tool === canonical);
}

/** Runtime fail-closed para uma tool de draft que escape do schema exposto. */
export function isDraftCompatibleWithIntent(tool: string, intent: ParsedIntent): boolean {
  if (!isDraftWriteTool(tool)) return true;
  const canonical = canonicalDraftForIntent(intent);
  return canonical ? tool === canonical : true;
}
