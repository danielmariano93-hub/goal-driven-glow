// ToolOutcome — classificação universal do resultado de uma ferramenta.
//
// Antes, qualquer `{ok:false}` virava "falha técnica" e o Nino respondia com
// "tive um problema" mesmo quando faltava apenas um dado (valor, cartão, conta,
// emoção). Aqui separamos claramente:
//
//   SUCCESS            → executou
//   NEEDS_INPUT        → falta um dado; o Nino PERGUNTA (não é erro)
//   AMBIGUOUS          → há mais de uma opção válida; o Nino oferece as opções
//   NOT_FOUND          → o que o usuário citou não existe
//   EMPTY_STATE        → não existe dado no período/domínio (resposta legítima)
//   CONFLICT           → o pedido conflita com o estado atual
//   VALIDATION_ERROR   → o pedido é inválido por regra de negócio
//   TECHNICAL_FAILURE  → aí sim é falha técnica
//
// Puro e testável: só olha o código de erro e o resultado da ferramenta.
// deno-lint-ignore-file no-explicit-any

export type OutcomeKind =
  | "SUCCESS"
  | "NEEDS_INPUT"
  | "AMBIGUOUS"
  | "NOT_FOUND"
  | "EMPTY_STATE"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "TECHNICAL_FAILURE";

export type ToolOutcome = {
  kind: OutcomeKind;
  /** Código bruto devolvido pela ferramenta (auditoria/telemetria). */
  code: string | null;
  /** Campo que falta ou está ambíguo (slot pendente). */
  field: string | null;
  /** Opções válidas quando `AMBIGUOUS`. */
  options: string[];
  /** Pergunta pronta em pt-BR quando `NEEDS_INPUT`/`AMBIGUOUS`/`NOT_FOUND`. */
  ask: string | null;
  result: unknown;
};

/** É clarificação (o Nino pergunta) e não falha? */
export function isClarification(kind: OutcomeKind): boolean {
  return kind === "NEEDS_INPUT" || kind === "AMBIGUOUS" || kind === "NOT_FOUND";
}

/** É resposta legítima (não deve virar mensagem de erro)? */
export function isAnswerable(kind: OutcomeKind): boolean {
  return kind === "SUCCESS" || kind === "EMPTY_STATE" || isClarification(kind);
}

type Rule = {
  rx: RegExp;
  kind: OutcomeKind;
  field: string | null;
  ask: string;
  /** Chave do resultado que traz as opções (contas, cartões, categorias). */
  optionsKey?: string;
};

const RULES: Rule[] = [
  { rx: /^(needs_amount|invalid_amount|missing_amount)$/i, kind: "NEEDS_INPUT", field: "amount", ask: "Só me faltou o valor para registrar. Qual foi o valor?" },
  { rx: /^(needs_type|invalid_type)$/i, kind: "NEEDS_INPUT", field: "type", ask: "Só me diga se isso foi um gasto ou um recebimento e eu registro." },
  { rx: /^(needs_description|missing_description)$/i, kind: "NEEDS_INPUT", field: "description", ask: "Me diz em quê foi esse lançamento (o estabelecimento ou o item) e eu registro." },
  { rx: /^(missing_planned_date|needs_date|missing_date)$/i, kind: "NEEDS_INPUT", field: "date", ask: "Qual foi a data? Assim eu acerto a competência do mês." },
  { rx: /^(needs_installments|invalid_installments)$/i, kind: "NEEDS_INPUT", field: "installments", ask: "Foi à vista ou parcelado? Se parcelado, em quantas parcelas?" },
  { rx: /^emotion_not_recognized$/i, kind: "NEEDS_INPUT", field: "emotion", ask: "Como você se sentiu? Pode ser tranquilo, atento, preocupado, confiante, impulsivo, frustrado, celebrando ou culpado." },
  { rx: /^(needs_goal|goal_missing)$/i, kind: "NEEDS_INPUT", field: "goal", ask: "Para qual meta eu registro isso?" },
  { rx: /^(account_ambiguous|multiple_accounts)$/i, kind: "AMBIGUOUS", field: "account", ask: "Em qual conta eu registro esse lançamento?", optionsKey: "accounts" },
  { rx: /^(card_ambiguous|multiple_cards)$/i, kind: "AMBIGUOUS", field: "card", ask: "Em qual cartão foi?", optionsKey: "cards" },
  { rx: /^(category_ambiguous)$/i, kind: "AMBIGUOUS", field: "category", ask: "Qual categoria eu uso?", optionsKey: "categories" },
  { rx: /^account_not_found$/i, kind: "NEEDS_INPUT", field: "account", ask: "Em qual conta eu registro esse lançamento?", optionsKey: "accounts" },
  { rx: /^card_not_found$/i, kind: "NEEDS_INPUT", field: "card", ask: "Não encontrei esse cartão. Em qual cartão foi?", optionsKey: "cards" },
  { rx: /^category_not_found$/i, kind: "NOT_FOUND", field: "category", ask: "Não reconheci essa categoria entre as suas. Me diz o nome como aparece no app.", optionsKey: "categories" },
  { rx: /^(goal_not_found|debt_not_found|transaction_not_found|recurrence_not_found|investment_not_found)$/i, kind: "NOT_FOUND", field: null, ask: "Não encontrei esse item na sua conta. Pode confirmar o nome?" },
  { rx: /^(no_data|empty|no_transactions|empty_period)$/i, kind: "EMPTY_STATE", field: null, ask: "" },
  { rx: /^(already_confirmed|already_paid|duplicate|conflict)/i, kind: "CONFLICT", field: null, ask: "" },
  { rx: /^(planned_date_in_past|invalid_period|invalid_date|validation_)/i, kind: "VALIDATION_ERROR", field: null, ask: "" },
];

function optionNames(result: unknown, key?: string): string[] {
  if (!key || !result || typeof result !== "object") return [];
  const raw = (result as any)[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => typeof item === "string" ? item : String((item as any)?.name ?? (item as any)?.label ?? "").trim())
    .filter((name) => name.length > 0)
    .slice(0, 6);
}

/** Classifica o retorno de `runTool` (ou de qualquer `{ok,result,error}`). */
export function classifyOutcome(execution: { ok: boolean; result?: unknown; error?: string | null }): ToolOutcome {
  if (execution.ok) {
    return { kind: "SUCCESS", code: null, field: null, options: [], ask: null, result: execution.result ?? null };
  }
  const code = String(execution.error ?? (execution.result as any)?.error ?? "").trim() || null;
  const rule = code ? RULES.find((r) => r.rx.test(code)) : undefined;
  if (!rule) {
    return { kind: "TECHNICAL_FAILURE", code, field: null, options: [], ask: null, result: execution.result ?? null };
  }
  const options = optionNames(execution.result, rule.optionsKey);
  const askFromTool = typeof (execution.result as any)?.ask === "string" ? String((execution.result as any).ask).trim() : "";
  let ask = askFromTool || rule.ask;
  if (options.length && isClarification(rule.kind)) ask = `${ask} (${options.join(", ")})`;
  return {
    kind: rule.kind,
    code,
    field: rule.field,
    options,
    ask: ask ? ask : null,
    result: execution.result ?? null,
  };
}
