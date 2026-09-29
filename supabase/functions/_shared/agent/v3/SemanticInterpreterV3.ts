// Nino Runtime V3 — strict semantic interpreter (production-authority ready).
//
// The model is allowed to interpret natural language exactly once. Its raw
// structured output is normalized into TurnSpecV3 and then checked by
// deterministic semantic invariants. Validators can reject; they never repair
// meaning or invoke a second classifier.
// deno-lint-ignore-file no-explicit-any

import { callStructuredFunction } from "../../ai-structured.ts";
import { resolveAiProvider, type AiProviderConfig, type AiProviderName } from "../../ai-runtime.ts";
import { ACTION_KINDS } from "../core/ActionIR.ts";
import { NINO_IDENTITY } from "../core/Conversational.ts";
import { verifySemanticInvariantsV3 } from "./SemanticInvariantsV3.ts";
import {
  ADVISORY_OPERATIONS_V3,
  SCENARIO_LEVERS_V3,
  SLOT_SOURCES_V3,
  TURN_SPEC_V3,
  type AdvisoryTaskV3,
  type EntityFilterV3,
  type FinancialQueryTaskV3,
  type FinancialWriteTaskV3,
  type GoalQueryTaskV3,
  type PeriodExpressionV3,
  type ScenarioSpecV3,
  type SemanticReferenceV3,
  type SemanticTaskV3,
  type TurnSpecV3,
  validateTurnSpecV3,
} from "./TurnSpecV3.ts";

export const SEMANTIC_INTERPRETER_V3_DEADLINE_MS = 12_000;

export type SemanticInterpreterV3Input = {
  text: string;
  history_text?: string | null;
  context_text?: string | null;
  model: string;
  provider_override?: AiProviderConfig | null;
};

export type SemanticInterpreterV3Telemetry = {
  model: string;
  provider: AiProviderName | null;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
};

export type SemanticInterpreterV3Outcome = {
  turn: TurnSpecV3 | null;
  telemetry: SemanticInterpreterV3Telemetry;
  violations: string[];
};

const AUTHORITATIVE_SOURCES = SLOT_SOURCES_V3.filter((source) => source !== "legacy_contract");

const sourcedStringSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "source", "source_span"],
  properties: {
    value: { type: "string" },
    source: { type: "string", enum: [...AUTHORITATIVE_SOURCES] },
    source_span: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

const periodSchema = sourcedStringSchema;
const referenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "target", "expression", "source"],
  properties: {
    kind: { type: "string", enum: ["entity_reference", "result_set_reference"] },
    target: { type: "string", enum: ["category", "merchant", "card", "account", "goal", "debt", "generic"] },
    expression: { type: "string" },
    source: { type: "string", enum: ["current_turn", "quoted_turn", "workflow", "memory"] },
  },
} as const;

const financialTaskPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["metric", "operation", "group_by", "filters", "periods", "limit", "comparison"],
  properties: {
    metric: {
      type: "string",
      enum: ["expense_amount", "income_amount", "balance", "net_worth", "debt_balance", "future_installments", "financial_health"],
    },
    operation: { type: "string", enum: ["value", "sum", "rank", "breakdown", "compare", "trend", "forecast", "explain"] },
    group_by: {
      type: "array",
      maxItems: 1,
      items: { type: "string", enum: ["category", "merchant", "card", "account", "month", "weekday"] },
    },
    filters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "entity"],
        properties: {
          field: { type: "string", enum: ["category", "merchant", "card", "account", "payment_method"] },
          entity: sourcedStringSchema,
        },
      },
    },
    periods: { type: "array", items: periodSchema },
    limit: { anyOf: [{ type: "integer", minimum: 1, maximum: 20 }, { type: "null" }] },
    comparison: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["direction", "baseline_kind", "baseline_period", "baseline_months", "target"],
          properties: {
            direction: { type: "string", enum: ["any", "increase", "decrease", "both"] },
            baseline_kind: { type: "string", enum: ["period", "mean_previous_complete_months"] },
            baseline_period: { anyOf: [periodSchema, { type: "null" }] },
            baseline_months: { anyOf: [{ type: "integer", minimum: 2, maximum: 24 }, { type: "null" }] },
            target: { anyOf: [periodSchema, { type: "null" }] },
          },
        },
      ],
    },
  },
} as const;

const goalTaskPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "goal"],
  properties: {
    operation: { type: "string", enum: ["overview", "progress", "projection"] },
    goal: { anyOf: [sourcedStringSchema, { type: "null" }] },
  },
} as const;

const scenarioSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lever", "category", "amount", "percent", "goal"],
  properties: {
    lever: { type: "string", enum: [...SCENARIO_LEVERS_V3] },
    category: { anyOf: [{ type: "string" }, { type: "null" }] },
    amount: { anyOf: [{ type: "string" }, { type: "null" }] },
    percent: { anyOf: [{ type: "number" }, { type: "null" }] },
    goal: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

const advisoryTaskPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "periods", "scenario", "options"],
  properties: {
    operation: { type: "string", enum: [...ADVISORY_OPERATIONS_V3] },
    periods: { type: "array", items: periodSchema },
    scenario: { anyOf: [scenarioSchema, { type: "null" }] },
    options: { type: "array", maxItems: 6, items: { type: "string" } },
  },
} as const;

const writeTaskPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "slots"],
  properties: {
    action: { type: "string", enum: [...ACTION_KINDS] },
    // Strict schema cannot safely expose an unbounded arbitrary object. Keep
    // semantic slot values textual at this boundary; typed write workflows
    // resolve/validate domain values later without changing meaning.
    slots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
      },
    },
  },
} as const;

function interpreterTool() {
  return {
    name: "emit_nino_turn_spec_v3",
    description: "Emit the single canonical semantic interpretation of the user turn. Never execute tools or calculate money.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "version", "kind", "act", "canonical_request", "inherit_topic", "references",
        "tasks", "direct_reply", "clarification_question",
      ],
      properties: {
        version: { type: "string", enum: [TURN_SPEC_V3] },
        kind: { type: "string", enum: ["conversation", "clarification", "task"] },
        act: { type: "string", enum: ["new_request", "follow_up", "repair", "answer", "topic_switch", "conversational"] },
        canonical_request: { type: "string" },
        inherit_topic: { type: "boolean" },
        references: { type: "array", items: referenceSchema },
        tasks: {
          type: "array",
          description: "Se kind=task, inclua obrigatoriamente pelo menos uma task completa. Nunca use tasks=[] com kind=task. Para conversation/clarification use [].",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "financial", "goal", "advisory", "write"],
            properties: {
              kind: { type: "string", enum: ["financial_query", "goal_query", "advisory", "financial_write"] },
              financial: { anyOf: [financialTaskPayloadSchema, { type: "null" }] },
              goal: { anyOf: [goalTaskPayloadSchema, { type: "null" }] },
              advisory: { anyOf: [advisoryTaskPayloadSchema, { type: "null" }] },
              write: { anyOf: [writeTaskPayloadSchema, { type: "null" }] },
            },
          },
        },
        direct_reply: { anyOf: [{ type: "string" }, { type: "null" }] },
        clarification_question: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  } as const;
}

const SYSTEM = `Você é o Semantic Interpreter V3 do Nino.
IDENTIDADE CANÔNICA: Nino é ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product}; propósito: ${NINO_IDENTITY.purpose}.
Sua única responsabilidade é transformar UMA mensagem em UMA interpretação semântica canônica estruturada.
Você NÃO executa ferramentas, NÃO calcula valores financeiros e NÃO inventa fatos pessoais.

PRINCÍPIOS OBRIGATÓRIOS:
1. A mensagem atual tem precedência sobre memória/contexto. Se o usuário disser explicitamente "Lazer", contexto anterior "Alimentação" não pode substituir Lazer.
2. Memória só preenche informação ausente. Nunca sobrescreve informação explícita do turno atual.
3. Períodos são slots temporais. "esse mês", "mês passado", "hoje" e equivalentes NUNCA são referências a categoria/estabelecimento/meta/dívida.
4. Referências só existem para anáforas reais: "ela", "essa categoria", "delas", "aquele estabelecimento", "essa meta", "essa dívida", mensagem citada etc.
5. Não escolha nome de ferramenta/função. Escolha somente uma das famílias/tarefas semânticas permitidas pelo schema.
6. Perguntas compostas devem gerar múltiplas tasks dentro do mesmo turno, preservando uma única interpretação.
7. source informa de onde cada slot veio. Use current_turn para algo literalmente dito agora; memory/reference somente quando realmente herdado.
8. Se faltar informação indispensável para entender o pedido, kind=clarification, tasks=[], direct_reply=null e faça UMA pergunta curta.
9. kind=conversation é somente conversa que não depende de fatos financeiros pessoais; tasks=[] e clarification_question=null.
10. kind=task exige uma ou mais tasks e direct_reply/clarification_question nulos.
11. "Quais metas eu tenho?" é goal_query/overview. "Como está a meta X?" é goal_query/progress. Não transforme metas em conversa genérica.
12. "Quanto gastei em Lazer esse mês?" é financial_query expense_amount/sum, filtro category=Lazer source=current_turn, período="esse mês" source=current_turn, references=[].
13. Não use result_set/entity reference quando a entidade já foi explicitamente informada no turno atual.
14. canonical_request deve preservar o significado completo sem inventar dados ou datas resolvidas.
15. "Quanto gasto por mês com X?", sem período histórico explícito, é hábito/típico: financial_query expense_amount, operation=value, group_by=[], periods=[], filtro X. NUNCA peça esclarecimento só por faltar período.
16. "Quanto gastei ... por mês nos últimos N meses?" é série histórica factual: financial_query expense_amount, operation=trend, group_by=[month], periods=["últimos N meses"].
17. "mês a mês", "mês por mês", "em cada mês", "evolução mensal" e equivalentes significam série histórica: operation=trend e group_by=[month], preservando filtros e período. Não use sum/breakdown para esse formato.
18. Em financial_write use SOMENTE estas actions de domínio: ${ACTION_KINDS.join(", ")}. "Registre um gasto..." = transaction.create. Não invente nomes de tools/functions.
19. Quando o usuário disser categoria e estabelecimento em qualquer ordem, preserve ambos como filtros independentes; o nome do merchant nunca inclui a categoria.
20. direct_reply de conversation deve respeitar a identidade canônica do Nino, falar de forma simples e humana e nunca citar arquitetura, modelo, provedor, ferramenta, runtime, erro HTTP ou detalhe interno.
21. PROIBIDO emitir kind=task com tasks=[]. Se kind=task, tasks DEVE conter pelo menos uma tarefa completa. Para registrar/anotar/lançar gasto, emita exatamente uma financial_write: kind=financial_write, financial=null, goal=null, advisory=null, write.action=transaction.create e write.slots com os dados explicitamente informados.
22. Para transaction.create, use slots textuais amount, merchant, date, account, category quando existirem. Campos ausentes serão resolvidos pelo workflow; não transforme o pedido em tasks=[].
23. DÍVIDA é uma entidade própria, nunca uma meta. "Paguei R$ 300 da dívida do Lucas" = debt.pay com slots debt="Lucas" e amount="300". "Quite a dívida do Lucas"/"quitei a dívida do Lucas" = debt.pay com debt="Lucas" e full_payment="true".
24. Em "paguei duas parcelas da dívida do Lucas", use debt.pay com debt="Lucas" e installments="2". Não invente amount se ele não foi dito.
25. Quando o usuário disser "essa dívida", "ela" ou equivalente referindo-se a uma dívida anterior, emita entity_reference target=debt com a expressão literal e NÃO invente um nome de dívida. O grounding determinístico fará a ligação.
26. Recorrência explícita nunca é um lançamento único. "Todo dia 10 pago Netflix"/"Netflix todo mês" = recurring.create; preserve amount, day/day_of_month, category e account quando forem ditos.
27. Pedidos de editar/excluir lançamento, meta, categoria, divisão ou recorrência usam as actions update/delete correspondentes. Nunca degrade silenciosamente para create.
28. "Recebi R$ X do João daquela divisão" = split.receive. Preserve participant, amount e date se existirem.
29. Se o usuário pedir duas ações distintas na mesma frase, preserve ambas como tasks separadas. Não apague uma delas nem finja que são uma só.
30. Hipótese/simulação ("e se eu cortar metade do delivery?", "se eu guardar R$ 500 por mês", "se eu comprar um celular de R$ 3.000") = advisory operation=scenario com scenario preenchido: lever=cut_category (category + percent ou amount), extra_savings (amount mensal), purchase (amount), income_change (amount mensal, negativo se perda). goal só quando o usuário citar a meta. Valores hipotéticos NÃO são fatos: nunca vire financial_write.
31. Dilema/decisão ("vale mais quitar o cartão ou investir?", "devo usar a reserva para pagar a dívida?", "compensa trocar de carro agora?") = advisory operation=decision, options com as alternativas literais que o usuário citou (ou [] se só houver uma), scenario=null salvo se houver um valor hipotético claro.
32. Em advisory que não seja scenario use scenario=null; em advisory que não seja decision use options=[].
33. "Quando vou bater/alcançar a meta X?" = goal_query operation=projection com goal=X (ou null se não citar).
34. Pedido composto de fato + conselho ("quanto gastei com lazer e o que você me sugere?") = duas tasks no mesmo turno: financial_query + advisory. Registro + consulta ("anota 50 no mercado e me diz quanto já foi no mês") = financial_write + financial_query.
35. Desabafo, preocupação, planos de vida ou conversa pessoal sem pedido de dado ("tô preocupado com dinheiro", "vou viajar em dezembro") = kind=conversation com direct_reply acolhedor, curto e sem inventar números.

A saída deve ser exclusivamente emit_nino_turn_spec_v3.`;

function sourced(raw: any): { value: string; source: any; source_span: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = String(raw.value ?? "").trim();
  const source = String(raw.source ?? "");
  if (!value || !AUTHORITATIVE_SOURCES.includes(source as any)) return null;
  return {
    value,
    source,
    source_span: raw.source_span == null ? null : String(raw.source_span).trim() || null,
  };
}

function periods(raw: any): PeriodExpressionV3[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PeriodExpressionV3[] = [];
  for (const item of raw) {
    const parsed = sourced(item);
    if (!parsed) return null;
    out.push(parsed as PeriodExpressionV3);
  }
  return out;
}

function references(raw: any): SemanticReferenceV3[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SemanticReferenceV3[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const kind = String(item.kind ?? "");
    const target = String(item.target ?? "");
    const expression = String(item.expression ?? "").trim();
    const source = String(item.source ?? "");
    if (!expression || !["current_turn", "quoted_turn", "workflow", "memory"].includes(source)) return null;
    if (kind === "entity_reference" && ["category", "merchant", "card", "account", "goal", "debt"].includes(target)) {
      out.push({ kind, target: target as any, expression, source: source as any });
      continue;
    }
    if (kind === "result_set_reference" && ["category", "merchant", "goal", "debt", "generic"].includes(target)) {
      out.push({ kind, target: target as any, expression, source: source as any });
      continue;
    }
    return null;
  }
  return out;
}

function normalizeFinancial(raw: any): FinancialQueryTaskV3 | null {
  if (!raw || typeof raw !== "object") return null;
  const filterList: EntityFilterV3[] = [];
  if (!Array.isArray(raw.filters)) return null;
  for (const filter of raw.filters) {
    const entity = sourced(filter?.entity);
    const field = String(filter?.field ?? "");
    if (!entity || !["category", "merchant", "card", "account", "payment_method"].includes(field)) return null;
    filterList.push({ field: field as EntityFilterV3["field"], entity: entity as any });
  }
  const periodList = periods(raw.periods);
  if (!periodList) return null;

  let comparison: FinancialQueryTaskV3["comparison"] = null;
  if (raw.comparison != null) {
    const c = raw.comparison;
    const target = c.target == null ? null : sourced(c.target);
    if (c.target != null && !target) return null;
    if (c.baseline_kind === "period") {
      const baselinePeriod = c.baseline_period == null ? null : sourced(c.baseline_period);
      if (c.baseline_period != null && !baselinePeriod) return null;
      if (c.baseline_months != null) return null;
      comparison = {
        direction: c.direction,
        baseline: { kind: "period", period: baselinePeriod as PeriodExpressionV3 | null },
        target: target as PeriodExpressionV3 | null,
      };
    } else if (c.baseline_kind === "mean_previous_complete_months") {
      if (c.baseline_period != null || !Number.isInteger(c.baseline_months)) return null;
      comparison = {
        direction: c.direction,
        baseline: { kind: "mean_previous_complete_months", months: Number(c.baseline_months) },
        target: target as PeriodExpressionV3 | null,
      };
    } else return null;
  }

  return {
    kind: "financial_query",
    family: "financial.query",
    metric: raw.metric,
    operation: raw.operation,
    group_by: Array.isArray(raw.group_by) ? raw.group_by : [],
    filters: filterList,
    periods: periodList,
    limit: raw.limit == null ? null : Number(raw.limit),
    comparison,
  } as FinancialQueryTaskV3;
}

function normalizeScenario(raw: any): ScenarioSpecV3 | null {
  if (!raw || typeof raw !== "object") return null;
  const lever = String(raw.lever ?? "");
  if (!(SCENARIO_LEVERS_V3 as readonly string[]).includes(lever)) return null;
  const text = (value: unknown) => {
    const out = value == null ? "" : String(value).trim();
    return out ? out : null;
  };
  const percent = raw.percent == null ? null : Number(raw.percent);
  return {
    lever: lever as ScenarioSpecV3["lever"],
    category: text(raw.category),
    amount: text(raw.amount),
    percent: percent != null && Number.isFinite(percent) ? percent : null,
    goal: text(raw.goal),
  };
}

function normalizeTask(raw: any): SemanticTaskV3 | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind ?? "");
  if (kind === "financial_query") {
    if (!raw.financial || raw.goal || raw.advisory || raw.write) return null;
    return normalizeFinancial(raw.financial);
  }
  if (kind === "goal_query") {
    if (!raw.goal || raw.financial || raw.advisory || raw.write) return null;
    const goal = raw.goal.goal == null ? null : sourced(raw.goal.goal);
    if (raw.goal.goal != null && !goal) return null;
    return {
      kind: "goal_query",
      family: "goals",
      operation: raw.goal.operation,
      goal: goal as GoalQueryTaskV3["goal"],
    };
  }
  if (kind === "advisory") {
    if (!raw.advisory || raw.financial || raw.goal || raw.write) return null;
    const periodList = periods(raw.advisory.periods);
    if (!periodList) return null;
    const scenario = normalizeScenario(raw.advisory.scenario);
    if (raw.advisory.scenario != null && !scenario) return null;
    const options = Array.isArray(raw.advisory.options)
      ? raw.advisory.options.map((option: unknown) => String(option ?? "").trim()).filter(Boolean).slice(0, 6)
      : [];
    return {
      kind: "advisory",
      family: "advisory",
      operation: raw.advisory.operation,
      periods: periodList,
      scenario,
      options,
    } as AdvisoryTaskV3;
  }
  if (kind === "financial_write") {
    if (!raw.write || raw.financial || raw.goal || raw.advisory) return null;
    const slots = Array.isArray(raw.write.slots)
      ? Object.fromEntries(raw.write.slots.map((slot: any) => [String(slot.key), String(slot.value)]))
      : {};
    return {
      kind: "financial_write",
      family: "financial.write",
      action: String(raw.write.action ?? "").trim(),
      slots,
    } as FinancialWriteTaskV3;
  }
  return null;
}

export function normalizeSemanticInterpreterV3Output(raw: unknown): TurnSpecV3 | null {
  const value = raw as any;
  if (!value || value.version !== TURN_SPEC_V3) return null;
  const parsedReferences = references(value.references);
  if (!parsedReferences) return null;
  const common = {
    version: TURN_SPEC_V3,
    act: value.act,
    canonical_request: String(value.canonical_request ?? "").trim(),
    inherit_topic: Boolean(value.inherit_topic),
    references: parsedReferences,
  } as const;

  let turn: TurnSpecV3 | null = null;
  if (value.kind === "conversation") {
    if (!String(value.direct_reply ?? "").trim() || value.clarification_question != null || (value.tasks ?? []).length) return null;
    turn = {
      ...common,
      kind: "conversation",
      response_intent: "conversation",
      direct_reply: String(value.direct_reply).trim(),
    };
  } else if (value.kind === "clarification") {
    if (!String(value.clarification_question ?? "").trim() || value.direct_reply != null || (value.tasks ?? []).length) return null;
    turn = {
      ...common,
      kind: "clarification",
      response_intent: "clarification",
      question: String(value.clarification_question).trim(),
    };
  } else if (value.kind === "task") {
    if (value.direct_reply != null || value.clarification_question != null || !Array.isArray(value.tasks) || !value.tasks.length) return null;
    const taskList: SemanticTaskV3[] = [];
    for (const item of value.tasks) {
      const task = normalizeTask(item);
      if (!task) return null;
      taskList.push(task);
    }
    turn = {
      ...common,
      kind: "task",
      response_intent: "execute",
      tasks: taskList as [SemanticTaskV3, ...SemanticTaskV3[]],
    };
  }
  if (!turn) return null;
  if (!validateTurnSpecV3(turn).ok) return null;
  if (!verifySemanticInvariantsV3(turn).ok) return null;
  return turn;
}

export async function interpretSemanticTurnV3(
  input: SemanticInterpreterV3Input,
): Promise<SemanticInterpreterV3Outcome> {
  const started = Date.now();
  const fail = (error: string, provider: AiProviderName | null = null, violations: string[] = []): SemanticInterpreterV3Outcome => ({
    turn: null,
    violations,
    telemetry: {
      model: input.model,
      provider,
      llm_calls: 1,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms: Date.now() - started,
      ok: false,
      error,
    },
  });

  const provider = input.provider_override ?? resolveAiProvider();
  if (!provider) return fail("semantic_interpreter_v3_not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEMANTIC_INTERPRETER_V3_DEADLINE_MS);
  try {
    const user = [
      input.context_text ? `Contexto tipado disponível:\n${input.context_text}` : "",
      input.history_text ? `Histórico relevante:\n${input.history_text}` : "",
      `Mensagem atual:\n${input.text}`,
      "Emita somente emit_nino_turn_spec_v3.",
    ].filter(Boolean).join("\n\n");

    const structured = await callStructuredFunction({
      provider,
      model: input.model,
      system: SYSTEM,
      user,
      tool: interpreterTool(),
      signal: controller.signal,
      temperature: 0,
      reasoning_effort: "low",
    });
    if (!structured.ok) {
      return {
        turn: null,
        violations: [],
        telemetry: {
          model: structured.model,
          provider: structured.provider,
          llm_calls: structured.attempts ?? 1,
          tokens_in: structured.input_tokens,
          tokens_out: structured.output_tokens,
          latency_ms: structured.latency_ms,
          ok: false,
          error: structured.error_code ?? "semantic_interpreter_v3_gateway_error",
        },
      };
    }

    let parsed: unknown;
    try { parsed = JSON.parse(structured.arguments); } catch {
      return fail("semantic_interpreter_v3_json_invalid", structured.provider);
    }
    const turn = normalizeSemanticInterpreterV3Output(parsed);
    if (!turn) return fail("semantic_interpreter_v3_contract_invalid", structured.provider);
    const invariant = verifySemanticInvariantsV3(turn);
    if (!invariant.ok) return fail("semantic_interpreter_v3_invariant_failed", structured.provider, invariant.violations);

    return {
      turn,
      violations: [],
      telemetry: {
        model: structured.model,
        provider: structured.provider,
        llm_calls: structured.attempts ?? 1,
        tokens_in: structured.input_tokens,
        tokens_out: structured.output_tokens,
        latency_ms: structured.latency_ms,
        ok: true,
        error: null,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}