// SemanticCompiler (`nino_semantic_ir.v2`)
// A LLM entende a linguagem; ela NÃO vê tools e NÃO executa nada.
// A saída é Financial Query IR via function calling forçado.
import {
  FINANCIAL_DIMENSIONS, FINANCIAL_METRICS, FINANCIAL_OPERATIONS,
  fastFinancialIR, MAX_IR_QUERIES, normalizeToV2, validateFinancialIR,
  validateFinancialIRv2, withCanonicalPeriods,
  type FinancialQueryIR,
} from "./FinancialQueryIR.ts";
import { readGatewayUsage, recordAiUsage, recordGatewayCall } from "../../aiUsageLedger.ts";


const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type SemanticCompilerTelemetry = {
  model: string | null;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
  source: "fast_path" | "llm" | "unavailable";
};

type CompileInput = {
  text: string;
  model: string;
  period: { from: string; to: string; label?: string };
  comparison_period?: { from: string; to: string; label?: string } | null;
  previous_query?: string | null;
  sb?: any;
  user_id?: string | null;
  run_id?: string | null;
  /** `nino_semantic_ir.v3`: multi-query real (teto MAX_IR_QUERIES). */
  max_queries?: number;
  /** Contexto de replan: só entra quando a investigação pede novo IR. */
  replan?: {
    current_ir: unknown;
    execution_summary: Array<{ query_id: string; status: string; engine: string | null }>;
    missing_targets: string[];
  } | null;
  /** Rótulo da chamada na telemetria de uso de IA. */
  reason?: string;
};

export type SemanticCompileOutcome = {
  ir: FinancialQueryIR | null;
  telemetry: SemanticCompilerTelemetry;
};

/** Schema do IR emitido pela LLM. `maxQueries=1` mantém o contrato v2. */
function compilerTool(maxQueries: number) {
  return {
  type: "function",
  function: {
    name: "emit_financial_query_ir",
    description: "Compila a intenção financeira do usuário em IR sem escolher ferramentas.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "intent", "needs_clarification", "assumptions", "queries",
        "completeness_targets", "unsupported_reason",
      ],
      properties: {
        intent: { type: "string", enum: ["lookup", "analyze", "investigate", "unsupported"] },
        needs_clarification: { type: "array", items: { type: "string" }, maxItems: 3 },
        assumptions: { type: "array", items: { type: "string" }, maxItems: 4 },
        queries: {
          type: "array", minItems: 0, maxItems: Math.max(1, Math.min(MAX_IR_QUERIES, maxQueries)),
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "metric", "operation", "group_by", "filters", "limit"],
            properties: {
              id: { type: "string" },
              metric: { type: "string", enum: [...FINANCIAL_METRICS] },
              operation: { type: "string", enum: [...FINANCIAL_OPERATIONS] },
              group_by: {
                type: "array", maxItems: 1,
                items: { type: "string", enum: [...FINANCIAL_DIMENSIONS] },
              },
              filters: {
                type: "array", maxItems: 4,
                items: {
                  type: "object", additionalProperties: false,
                  required: ["field", "op", "value"],
                  properties: {
                    field: { type: "string", enum: ["category", "card", "account", "payment_method"] },
                    op: { type: "string", enum: ["eq"] },
                    value: { type: "string" },
                  },
                },
              },
              limit: { anyOf: [{ type: "integer", minimum: 1, maximum: 20 }, { type: "null" }] },
              ...(maxQueries > 1
                ? { depends_on: { type: "array", maxItems: 3, items: { type: "string" } } }
                : {}),
            },
          },
        },
        completeness_targets: { type: "array", maxItems: 8, items: { type: "string" } },
        unsupported_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
  },
  } as const;
}

const SYSTEM = `Você é o compilador semântico do Nino, um agente financeiro pessoal.
Sua única tarefa é traduzir a pergunta para Financial Query IR.
NÃO responda ao usuário. NÃO escolha, mencione ou invente tools/functions.
NÃO calcule números. NÃO invente entidades. O backend é a autoridade de datas.

Regras de compilação:
- "quais categorias mais gastei" => expense_amount + rank + group_by category.
- "quanto gastei no total" => expense_amount + sum + group_by [].
- "quanto entrou/recebi" => income_amount.
- "por cartão" significa group_by card; "no cartão Nubank" significa filter card=Nubank.
- "por conta" significa group_by account; "na conta X" significa filter account=X.
- "só crédito/no crédito" => filter payment_method=credit_card.
- "só débito/conta" => filter payment_method=account.
- "tendência do gasto médio" => expense_amount + trend.
- "previsão/fechamento do mês" => expense_amount + forecast.
- "por que gastei mais/menos que o período anterior" => investigate + expense_amount + explain.
- use compare quando a pergunta pedir comparação factual entre períodos.
- se uma entidade específica estiver ambígua, preencha needs_clarification em vez de chutar.
- filtros negativos ("sem X"), what-if complexo, causalidade não suportada ou combinação fora da ontologia:
  intent=unsupported, queries=[] e unsupported_reason explícito.
- correção do usuário preserva a pergunta anterior e aplica somente a nova restrição.
- completeness_targets descreve exatamente o que a resposta precisa entregar.
- datas/períodos não aparecem no IR gerado pela LLM; o backend os anexa depois.`;

const SINGLE_QUERY_RULE = `- este rollout executa UMA query. Se houver duas análises independentes que não cabem em um único
  resultado, intent=unsupported e queries=[]; não descarte metade.`;

const MULTI_QUERY_RULE = `- você pode emitir até 4 queries com ids q1..q4 quando a pergunta pedir mais de um fato
  (ex.: ranking de categorias E total do período para calcular participação).
- use depends_on APENAS quando uma query precisar do resultado de outra; nunca crie ciclo.
- cada query precisa ser distinta: duas queries idênticas invalidam o plano.
- completeness_targets deve citar o id da query que entrega cada fato ("q1.rank", "q2.money").
- investigação de aumento de gasto: q1 compara o período com o anterior e q2 detalha por categoria.`;

/** Prompt do compilador. O rollout single-query mantém o texto original. */
function systemPrompt(maxQueries: number): string {
  return `${SYSTEM}\n${maxQueries > 1 ? MULTI_QUERY_RULE : SINGLE_QUERY_RULE}`;
}

function emptyTelemetry(source: SemanticCompilerTelemetry["source"], model: string | null = null): SemanticCompilerTelemetry {
  return { model, llm_calls: 0, tokens_in: 0, tokens_out: 0, latency_ms: 0, ok: true, error: null, source };
}


export async function compileFinancialQuery(input: CompileInput): Promise<SemanticCompileOutcome> {
  const maxQueries = Math.max(1, Math.min(MAX_IR_QUERIES, input.max_queries ?? 1));
  // Replan nunca usa Fast Path: a pergunta já falhou em completude.
  if (!input.replan) {
    const fast = fastFinancialIR(input.text, input.period, input.comparison_period);
    if (fast) return { ir: fast, telemetry: emptyTelemetry("fast_path") };
  }

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    return {
      ir: null,
      telemetry: { ...emptyTelemetry("unavailable"), ok: false, error: "llm_not_configured" },
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const user = [
      input.previous_query ? `Pergunta factual anterior:\n${input.previous_query}` : "",
      `Mensagem atual:\n${input.text}`,
      // Replan semântico: a LLM recebe IR atual, execução e lacunas — nunca
      // catálogo de tools, nunca números, nunca texto de resposta.
      input.replan
        ? [
          `IR atual:\n${JSON.stringify(input.replan.current_ir)}`,
          `Execução:\n${JSON.stringify(input.replan.execution_summary)}`,
          `Alvos de completude ainda não atendidos: ${input.replan.missing_targets.join(", ") || "nenhum"}`,
          "Emita um IR REVISADO que cubra os alvos faltantes sem mudar a pergunta do usuário.",
        ].join("\n\n")
        : "",
      "Emita somente a chamada emit_financial_query_ir.",
    ].filter(Boolean).join("\n\n");

    const response = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "system", content: systemPrompt(maxQueries) }, { role: "user", content: user }],
        tools: [compilerTool(maxQueries)],
        tool_choice: { type: "function", function: { name: "emit_financial_query_ir" } },
        temperature: 0,
      }),

      signal: controller.signal,
    });
    const text = await response.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* handled below */ }

    if (!response.ok || !body) {
      const error = `semantic_compiler_gateway_${response.status || "bad_json"}`;
      if (input.sb) {
        await recordAiUsage(input.sb, {
          workload: "AGENT_CONVERSATION", function_name: "agent-run",
          operation: "semantic_compile", user_id: input.user_id ?? null,
          run_id: input.run_id ?? null, model: input.model,
          success: false, http_status: response.status || null,
          error_code: error, latency_ms: Date.now() - started,
          reason_for_ai_call: input.reason ?? "semantic_ir_v1",
        });
      }
      return {
        ir: null,
        telemetry: {
          model: input.model, llm_calls: 1, tokens_in: 0, tokens_out: 0,
          latency_ms: Date.now() - started, ok: false, error, source: "llm",
        },
      };
    }

    const usage = readGatewayUsage(body);
    if (input.sb) {
      await recordGatewayCall(input.sb, {
        workload: "AGENT_CONVERSATION", function_name: "agent-run",
        operation: "semantic_compile", user_id: input.user_id ?? null,
        run_id: input.run_id ?? null, model: input.model,
        success: true, latency_ms: Date.now() - started,
        reason_for_ai_call: input.reason ?? "semantic_ir_v1",
        metadata: { compiler_version: "nino_semantic_ir.v2" },
      }, body);
    }

    const call = body?.choices?.[0]?.message?.tool_calls?.[0];
    if (call?.function?.name !== "emit_financial_query_ir") {
      return {
        ir: null,
        telemetry: {
          model: input.model, llm_calls: 1, tokens_in: usage.input_tokens, tokens_out: usage.output_tokens,
          latency_ms: Date.now() - started, ok: false, error: "missing_ir_tool_call", source: "llm",
        },
      };
    }

    let args: unknown;
    try { args = JSON.parse(String(call.function.arguments ?? "{}")); }
    catch {
      return {
        ir: null,
        telemetry: {
          model: input.model, llm_calls: 1, tokens_in: usage.input_tokens, tokens_out: usage.output_tokens,
          latency_ms: Date.now() - started, ok: false, error: "invalid_ir_json", source: "llm",
        },
      };
    }

    const candidate = {
      ...(args as Record<string, unknown>),
      version: "financial_query_ir.v1",
      source: "semantic_compiler",
      period: { from: input.period.from, to: input.period.to, label: input.period.label ?? "período solicitado" },
      comparison_period: input.comparison_period
        ? {
          from: input.comparison_period.from,
          to: input.comparison_period.to,
          label: input.comparison_period.label ?? "período anterior comparável",
        }
        : null,
    } as FinancialQueryIR;

    // Single-query mantém o validador v1; multi-query valida no contrato v2
    // (ids, depends_on, ciclos, duplicidade) — nunca correção silenciosa.
    const errors = maxQueries > 1
      ? validateFinancialIRv2(normalizeToV2(candidate))
      : validateFinancialIR(candidate);
    return {
      ir: errors.length ? null : withCanonicalPeriods(candidate, input.period, input.comparison_period),
      telemetry: {
        model: input.model, llm_calls: 1,
        tokens_in: usage.input_tokens, tokens_out: usage.output_tokens,
        latency_ms: Date.now() - started,
        ok: errors.length === 0,
        error: errors.length ? `ir_validation:${errors.join(",")}` : null,
        source: "llm",
      },
    };

  } catch (error) {
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "semantic_compiler_timeout"
      : "semantic_compiler_error";
    if (input.sb) {
      await recordAiUsage(input.sb, {
        workload: "AGENT_CONVERSATION", function_name: "agent-run",
        operation: "semantic_compile", user_id: input.user_id ?? null,
        run_id: input.run_id ?? null, model: input.model,
        success: false, error_code: code, latency_ms: Date.now() - started,
        reason_for_ai_call: input.reason ?? "semantic_ir_v1",
      });
    }
    return {
      ir: null,
      telemetry: {
        model: input.model, llm_calls: 1, tokens_in: 0, tokens_out: 0,
        latency_ms: Date.now() - started, ok: false, error: code, source: "llm",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
