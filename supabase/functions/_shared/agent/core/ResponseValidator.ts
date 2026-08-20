// ResponseValidator — final safety pass on outgoing replies.
// - `validateReply(raw)` : string-in/string-out (used by AgentCore; behaviour
//   unchanged from Fase 1 so existing tests stay green).
// - `validate(reply, ctx)` : structured result with an action hint so higher
//   layers can decide to accept, regenerate once, or drop to deterministic
//   fallback. This is additive.
// deno-lint-ignore-file no-explicit-any
import { validateAnalyticalClaims } from "../../intelligence/claimValidator.ts";
import type { ToolCallEvidence } from "../../intelligence/contracts.ts";

const MAX_REPLY_LEN = 4000;
export const FRIENDLY_ORCHESTRATOR_ERROR =
  "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";

export function validateReply(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return FRIENDLY_ORCHESTRATOR_ERROR;
  return t.length > MAX_REPLY_LEN ? t.slice(0, MAX_REPLY_LEN) : t;
}

export type ValidationAction = "accept" | "regenerate" | "fallback_deterministic";

export type ValidationResult = {
  action: ValidationAction;
  body: string;
  reasons: string[];
};

export type ValidationContext = {
  hasDraft?: boolean;
  expectedKind?: "receipt" | "draft" | "question" | "info" | "cancelled" | "expired";
  toolCallErrors?: number;
  /** True quando existe ≥1 tool call bem-sucedida que cria rascunho OU confirma
   *  uma pendência neste mesmo turno. Usado para bloquear alucinação de recibo. */
  hasSuccessfulMutation?: boolean;
  userText?: string;
  toolCalls?: ToolCallEvidence[];
  /** True quando o usuário pediu explicitamente um gráfico/artefato visual. */
  artifactExpected?: boolean;
  /** True quando o turno realmente produziu um artefato (linha em agent_artifacts). */
  artifactReady?: boolean;
  /** Canonical tool that must have succeeded before a factual answer. */
  requiredTool?: string | null;
  /** True quando o turno é de lançamento (registro no ledger). */
  entryTurn?: boolean;
};

const DRAFT_LANGUAGE_RX = /\b(rascunho|proposta)\b.*\b(confirmar|confirma|registrar|registro|criar|criei|salvar)\b|\b(posso|vou|quer que eu)\s+(criar|crie|registrar|registre|salvar|salve)\b/i;

// "Você confirma?", "confirma?", "posso registrar/lançar/salvar?".
// Sinaliza que o LLM pediu confirmação — nesse caso PRECISA existir um rascunho.
const CONFIRM_QUESTION_RX = /\b(voc[eê]\s+confirma|confirma\s*\?|posso\s+(registrar|lan[çc]ar|salvar|criar|anotar))\b/i;

// Frases que afirmam sucesso ("Despesa registrada ✅", "salvo com sucesso",
// "anotado", "confirmado"). Se aparecerem sem uma mutation real neste turno,
// é alucinação e cai no fallback determinístico.
const RECEIPT_LANGUAGE_RX = /(\b(?:despesa|receita|lan[çc]amento|transfer[eê]ncia|aporte|opera[çc][aã]o)\s+(?:foi\s+)?(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao]|criad[ao]|cadastrad[ao])\b)|(\b(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao])\b.*(?:✅|com sucesso))|(✅\s*$)/i;

// Convites de rascunho que o LLM produz sem chamar tool alguma:
//  - "Responda CONFIRMAR / *CONFIRMAR*"
//  - "CONFIRMAR para registrar/salvar/lançar/criar/anotar"
//  - "Posso lançar/registrar/salvar ...?"
//  - "Vou lançar/registrar/salvar ..."
const DRAFT_INVITE_RX = /(responda\s*\*?\s*confirmar\s*\*?)|(\*?\s*confirmar\s*\*?\s*para\s+(registrar|salvar|lan[çc]ar|criar|anotar))|(\bposso\s+(lan[çc]ar|registrar|salvar|criar|anotar)\b[^?]{0,80}\?)|(\bvou\s+(lan[çc]ar|registrar|salvar|criar|anotar)\b)/i;

// Afirmação de entrega de artefato visual sem que o turno de fato tenha
// produzido um. Bloqueia "aqui está o gráfico", "segue o gráfico", "preparei/
// gerei/enviei o gráfico" quando artifactReady === false.
const GRAPH_CLAIM_RX = /\b(aqui\s+est[aá]|segue|preparei|gerei|enviei|montei|criei)\b[^.\n]{0,60}\b(gr[aá]fico|visualiza[çc][aã]o|chart)\b/i;

// Qualquer cartão de rascunho em prosa ("Rascunhei aqui...", "confirma esse
// lançamento?") sem ferramenta executada é invenção do modelo.
const DRAFT_CARD_RX = /\brascunh\w+\b|\bconfirm\w+\b[^?\n]{0,60}\?|\bt[aá]\s+certo\b[^?\n]{0,20}\?/i;

// Inversão de persona: o modelo escreve como se fosse o usuário falando com o
// Nino ("Ah, Nino!", "Nino, esqueci de perguntar", "obrigado, Nino").
// O Nino é quem responde — jamais se dirige a si mesmo.
export const PERSONA_INVERSION_RX = /(^|[\s,;!¡"“(])(ah|oi|ol[aá]|e a[íi]|obrigad[oa]|valeu|desculpa|nossa|opa|certo|sim|n[ãa]o|beleza|blz|ok|okay|t[aá]|tudo bem|claro|perfeito|combinado|entendi|pode ser|pode|show|isso)[,!]+\s*nino\b|[,]\s*nino\s*[.!?]|\bnino[,!]\s+(esqueci|preciso|me\s|pode\s|voc[eê]\s)/i;


const MUTATION_TOOLS = new Set([
  "create_transaction_draft", "create_transfer_draft", "create_goal_contribution_draft",
  "create_goal_draft", "confirm_pending_action",
]);

/**
 * Mensagem honesta e específica para falha de lançamento. Substitui o
 * "Ops, algo deu errado… tente novamente", que não diz nada ao usuário.
 */
export function entryFailureMessage(toolCalls: ToolCallEvidence[] = []): string {
  const failed = toolCalls.filter((c) => !c.ok && MUTATION_TOOLS.has(String(c.tool_name)));
  const errors = failed.map((c) => String((c as any).error ?? (c as any).result?.error ?? ""));
  const joined = errors.join(" ");
  if (/needs_amount|invalid_amount/.test(joined)) {
    return "Só me faltou o valor para registrar. Qual foi o valor?";
  }
  if (/needs_type|invalid_type/.test(joined)) {
    return "Só me diga se isso foi um gasto ou um recebimento e eu registro.";
  }
  if (/needs_description/.test(joined)) {
    return "Me diz em quê foi esse lançamento (o estabelecimento ou o item) e eu registro.";
  }
  if (/account_not_found/.test(joined)) {
    const accounts = failed
      .flatMap((c) => ((c as any).result?.accounts ?? []) as string[])
      .filter((name) => typeof name === "string" && name.trim());
    if (accounts.length) return `Em qual conta eu registro? (${[...new Set(accounts)].join(", ")})`;
    return "Em qual conta eu registro esse lançamento?";
  }
  if (/card_not_found/.test(joined)) {
    return "Não encontrei esse cartão. Em qual cartão foi?";
  }

  return "Não registrei nada ainda. Me confirma o valor e em quê foi, que eu lanço na hora.";
}

export function validate(raw: string, ctx: ValidationContext = {}): ValidationResult {
  const reasons: string[] = [];
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    reasons.push("empty_reply");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Detect malformed JSON leaks (assistant returning raw JSON blob)
  if (/^\s*[[{]/.test(trimmed) && trimmed.length > 40) {
    try { JSON.parse(trimmed); reasons.push("json_leak"); }
    catch { reasons.push("malformed_json_leak"); }
    return { action: "regenerate", body: trimmed.slice(0, MAX_REPLY_LEN), reasons };
  }
  // Inversão de persona: descarta e devolve resposta determinística.
  if (PERSONA_INVERSION_RX.test(trimmed)) {
    reasons.push("persona_inversion");
    const body = ctx.entryTurn === true
      ? entryFailureMessage(ctx.toolCalls ?? [])
      : FRIENDLY_ORCHESTRATOR_ERROR;
    return { action: "accept", body, reasons };
  }
  // Turno de lançamento em que a ferramenta de rascunho falhou: a resposta é
  // sempre determinística, jamais prosa livre do modelo.
  if (ctx.entryTurn === true && ctx.hasSuccessfulMutation === false
    && (ctx.toolCalls ?? []).some((c) => !c.ok && MUTATION_TOOLS.has(String(c.tool_name)))) {
    reasons.push("entry_tool_failed");
    return { action: "accept", body: entryFailureMessage(ctx.toolCalls ?? []), reasons };
  }
  // Receipt without a draft is inconsistent

  if (ctx.expectedKind === "receipt" && ctx.hasDraft === false) {
    reasons.push("receipt_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Recibo alucinado: fala como se tivesse salvo mas nenhuma tool de mutação
  // rodou. Bloqueia mesmo quando expectedKind ficou como "info".
  if (ctx.hasSuccessfulMutation === false && RECEIPT_LANGUAGE_RX.test(trimmed)) {
    reasons.push("hallucinated_receipt");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Pediu confirmação sem ter criado o rascunho: força o caminho determinístico
  // que sabe montar o draft a partir de mensagens estruturadas.
  if (ctx.hasDraft === false && CONFIRM_QUESTION_RX.test(trimmed)) {
    reasons.push("confirm_question_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Convite de rascunho ("Responda CONFIRMAR…", "Posso lançar…?", "Vou registrar…")
  // sem qualquer mutação real neste turno = alucinação do template. Cai no
  // caminho determinístico que sabe montar o rascunho de verdade.
  if (ctx.hasSuccessfulMutation === false && DRAFT_INVITE_RX.test(trimmed)) {
    reasons.push("hallucinated_draft_invite");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  if (ctx.entryTurn === true && ctx.hasSuccessfulMutation === false && DRAFT_CARD_RX.test(trimmed)) {
    reasons.push("hallucinated_draft_card");
    return { action: "accept", body: entryFailureMessage(ctx.toolCalls ?? []), reasons };
  }
  if (ctx.hasDraft === false && DRAFT_LANGUAGE_RX.test(trimmed)) {
    reasons.push("draft_language_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  if (ctx.requiredTool) {
    const requiredSucceeded = (ctx.toolCalls ?? []).some((call) =>
      call.tool_name === ctx.requiredTool && call.ok
    );
    if (!requiredSucceeded) {
      reasons.push(`required_tool_missing:${ctx.requiredTool}`);
      if (MUTATION_TOOLS.has(String(ctx.requiredTool))) {
        return { action: "accept", body: entryFailureMessage(ctx.toolCalls ?? []), reasons };
      }
      const honestFailure = /\b(n[aã]o consegui|indispon[ií]vel|tente novamente|nenhum dado foi alterado)\b/i.test(trimmed);
      return {
        action: "accept",
        body: honestFailure
          ? trimmed.slice(0, MAX_REPLY_LEN)
          : "Não consegui consultar a fonte financeira necessária para responder com segurança. Nenhum dado foi alterado; tente novamente em instantes.",
        reasons,
      };
    }
  }
  // Alegação de entrega de gráfico sem artefato pronto neste turno.
  // Não abandona a resposta (o texto pode conter conteúdo útil): reescreve
  // como esclarecimento honesto.
  if (ctx.artifactReady === false && GRAPH_CLAIM_RX.test(trimmed)) {
    reasons.push("hallucinated_chart_delivery");
    const rewritten = ctx.artifactExpected
      ? "Ainda estou preparando o gráfico — te mando em instantes. Se quiser, já posso te resumir em texto o que ele vai mostrar."
      : "Não gerei nenhum gráfico neste turno. Se quiser ver visualmente, me diga qual métrica e período.";
    return { action: "accept", body: rewritten, reasons };
  }
  // Recibo declarado combinado com QUALQUER erro de tool ⇒ suspeito.
  // Antes exigíamos ≥2 erros; agora, se o texto soa a recibo e houve ao menos 1
  // erro, tratamos como fallback. O limite geral segue em ≥2.
  const errs = ctx.toolCallErrors ?? 0;
  if (errs >= 1 && RECEIPT_LANGUAGE_RX.test(trimmed) && ctx.hasSuccessfulMutation === false) {
    reasons.push("receipt_with_tool_errors");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  if (errs >= 2) {
    reasons.push("too_many_tool_errors");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }

  if (ctx.userText) {
    const analytical = validateAnalyticalClaims(trimmed, ctx.userText, ctx.toolCalls ?? []);
    if (!analytical.ok) {
      reasons.push(...analytical.reasons);
      return {
        action: "accept",
        body: String(analytical.safe_reply ?? FRIENDLY_ORCHESTRATOR_ERROR).slice(0, MAX_REPLY_LEN),
        reasons,
      };
    }
  }
  const body = trimmed.length > MAX_REPLY_LEN ? trimmed.slice(0, MAX_REPLY_LEN) : trimmed;
  return { action: "accept", body, reasons };
}
