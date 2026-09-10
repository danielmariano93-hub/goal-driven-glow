// HumanUnderstanding (`nino_language.v1`)
//
// COMPREENDER ANTES DE EXECUTAR.
//
// Causa-raiz do incidente "Ansioso → Atento": mensagem humana curta era
// resolvida por uma tabela de sinônimos e por regex. Nenhuma inteligência
// tentava entender a pessoa; o produto decidia por ela.
//
// Regras de projeto (não negociáveis):
// - esta camada devolve ESTRUTURA (qual sentimento, é correção, é conversa),
//   nunca número, nunca valor financeiro, nunca texto final de resposta;
// - palavra exata do catálogo NÃO chega aqui (o determinístico já resolveu);
// - falha, timeout ou modelo indisponível cai no determinístico atual
//   (fail-open apenas para leitura de intenção — nunca para número).
// deno-lint-ignore-file no-explicit-any
import {
  candidateFeelingTerm, EMOTION_CATALOG, parseEmotionCorrection, parseEmotionFromText,
  resolveEmotionTerm,
} from "../../intelligence/emotionParse.ts";
import { readGatewayUsage, recordAiUsage, recordGatewayCall } from "../../aiUsageLedger.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type HumanReading = {
  version: "nino_language.v1";
  kind: "emotion_checkin" | "emotion_correction" | "small_talk" | "unknown";
  /** termo literal que a pessoa usou ("ansioso", "apatia") */
  emotion_term: string | null;
  /** chave canônica quando o termo existe no catálogo */
  emotion_key: string | null;
  /** true quando a pessoa está substituindo o registro anterior */
  correction: boolean;
  /** true quando o termo não existe no catálogo e deve virar sentimento pessoal */
  custom_candidate: boolean;
  confidence: number;
  source: "deterministic" | "llm" | "unavailable";
  llm_calls: number;
  latency_ms: number;
  error: string | null;
};

const FINANCIAL_RX =
  /\b(gast|gastei|despesa|receita|renda|saldo|categoria|cart[aã]o|fatura|conta|d[ií]vida|meta|patrim[oô]nio|investimento|lan[cç]amento|parcela|quanto|r\$|\d)\w*/i;

/** Mensagem humana curta, não financeira: sentimento, correção ou conversa. */
export function isShortHumanMessage(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (FINANCIAL_RX.test(raw)) return false;
  return raw.split(/\s+/).length <= 8;
}

function deterministicReading(text: string): HumanReading | null {
  const correction = parseEmotionCorrection(text);
  if (correction?.option) {
    return {
      version: "nino_language.v1", kind: "emotion_correction",
      emotion_term: correction.toTerm, emotion_key: correction.option.key,
      correction: true, custom_candidate: false, confidence: 1,
      source: "deterministic", llm_calls: 0, latency_ms: 0, error: null,
    };
  }
  const direct = resolveEmotionTerm(text) ?? parseEmotionFromText(text);
  if (direct && !correction) {
    return {
      version: "nino_language.v1", kind: "emotion_checkin",
      emotion_term: direct.key, emotion_key: direct.key,
      correction: false, custom_candidate: false, confidence: 1,
      source: "deterministic", llm_calls: 0, latency_ms: 0, error: null,
    };
  }
  return null;
}

const READING_TOOL = {
  type: "function",
  function: {
    name: "emit_human_reading",
    description: "Interpreta uma mensagem humana curta em pt-BR. Não calcula nada e não escreve resposta.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["emotion_checkin", "emotion_correction", "small_talk", "unknown"],
        },
        emotion_term: {
          type: "string",
          description: "A palavra que a pessoa usou para o sentimento, exatamente como ela disse. Nunca substitua por sinônimo.",
        },
        correction: {
          type: "boolean",
          description: "true quando a pessoa está corrigindo o sentimento registrado antes.",
        },
        confidence: { type: "number" },
      },
      required: ["kind", "correction", "confidence"],
      additionalProperties: false,
    },
  },
};

function systemPrompt(): string {
  return [
    "Você interpreta mensagens humanas curtas em português do Brasil dentro de um app financeiro.",
    "Sua única saída é estrutura via emit_human_reading. Você NÃO responde a pessoa, NÃO calcula e NÃO cita dinheiro.",
    "REGRA ABSOLUTA: preserve a palavra do sentimento como a pessoa disse. 'ansioso' é ansioso, nunca 'atento'.",
    `Sentimentos que o app já conhece: ${EMOTION_CATALOG.map((e) => e.key).join(", ")}.`,
    "Se a pessoa usar uma palavra fora dessa lista, devolva a palavra dela mesmo assim.",
    "kind=emotion_correction quando ela substitui o sentimento anterior ('não foi atento, foi ansioso', 'quis dizer ansioso').",
    "kind=small_talk para saudação e agradecimento. kind=unknown quando não houver sentimento nem correção.",
  ].join("\n");
}

/**
 * Compreensão da mensagem curta. Determinístico primeiro (instantâneo);
 * modelo só quando o determinístico não tem certeza.
 */
export async function understandHumanMessage(input: {
  text: string;
  model: string;
  sb?: any;
  user_id?: string | null;
  run_id?: string | null;
}): Promise<HumanReading> {
  const text = String(input.text ?? "").trim();
  const fast = deterministicReading(text);
  if (fast) return fast;

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    return {
      version: "nino_language.v1", kind: "unknown", emotion_term: null, emotion_key: null,
      correction: false, custom_candidate: false, confidence: 0,
      source: "unavailable", llm_calls: 0, latency_ms: 0, error: "llm_not_configured",
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: `Mensagem:\n${text}\n\nEmita somente emit_human_reading.` },
        ],
        tools: [READING_TOOL],
        tool_choice: { type: "function", function: { name: "emit_human_reading" } },
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    const latency = Date.now() - started;

    if (!response.ok || !body) {
      if (input.sb) {
        await recordAiUsage(input.sb, {
          workload: "AGENT_CONVERSATION", function_name: "agent-run",
          operation: "human_understanding", user_id: input.user_id ?? null,
          run_id: input.run_id ?? null, model: input.model, success: false,
          http_status: response.status || null, error_code: "human_understanding_gateway",
          latency_ms: latency, reason_for_ai_call: "nino_language_v1",
        });
      }
      return {
        version: "nino_language.v1", kind: "unknown", emotion_term: null, emotion_key: null,
        correction: false, custom_candidate: false, confidence: 0,
        source: "llm", llm_calls: 1, latency_ms: latency, error: "gateway_error",
      };
    }

    if (input.sb) {
      const usage = readGatewayUsage(body);
      await recordGatewayCall(input.sb, {
        workload: "AGENT_CONVERSATION", function_name: "agent-run",
        operation: "human_understanding", user_id: input.user_id ?? null,
        run_id: input.run_id ?? null, model: input.model, success: true,
        latency_ms: latency, reason_for_ai_call: "nino_language_v1",
        metadata: { version: "nino_language.v1", tokens_out: usage.output_tokens },
      }, body);
    }

    const call = body?.choices?.[0]?.message?.tool_calls?.[0];
    if (call?.function?.name !== "emit_human_reading") {
      return {
        version: "nino_language.v1", kind: "unknown", emotion_term: null, emotion_key: null,
        correction: false, custom_candidate: false, confidence: 0,
        source: "llm", llm_calls: 1, latency_ms: latency, error: "missing_tool_call",
      };
    }
    let parsed: any = {};
    try { parsed = JSON.parse(call.function.arguments ?? "{}"); } catch { parsed = {}; }

    const term = typeof parsed.emotion_term === "string" ? parsed.emotion_term.trim() : "";
    const option = term ? resolveEmotionTerm(term) : null;
    const kind: HumanReading["kind"] = ["emotion_checkin", "emotion_correction", "small_talk", "unknown"]
      .includes(parsed.kind) ? parsed.kind : "unknown";

    return {
      version: "nino_language.v1",
      kind,
      emotion_term: term || null,
      emotion_key: option?.key ?? null,
      correction: Boolean(parsed.correction) || kind === "emotion_correction",
      // Sentimento fora do catálogo continua sendo o sentimento dela.
      custom_candidate: Boolean(term) && !option && Boolean(candidateFeelingTerm(term)),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7))),
      source: "llm", llm_calls: 1, latency_ms: latency, error: null,
    };
  } catch (e) {
    return {
      version: "nino_language.v1", kind: "unknown", emotion_term: null, emotion_key: null,
      correction: false, custom_candidate: false, confidence: 0,
      source: "llm", llm_calls: 1, latency_ms: Date.now() - started,
      error: e instanceof Error ? e.message.slice(0, 120) : "human_understanding_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
