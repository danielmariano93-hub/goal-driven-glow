// NarrativeComposer (`nino_narrative.v1`)
//
// Transforma EVIDÊNCIA CANÔNICA em leitura humana. A camada de linguagem só
// reescreve — ela não vê o banco, não recebe ferramentas e não pode citar
// número fora do pacote. Guarda reprovada → corpo determinístico do motor.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recordGatewayCall } from "../../aiUsageLedger.ts";
import { MODEL_TIERS } from "../../intelligence/modelGateway.ts";
import { guardNarrative, type GuardResult } from "./NarrativeGuard.ts";
import type { NarrativeEvidencePack } from "./NarrativeEvidencePack.ts";
import type { ToneRules } from "./TonePolicy.ts";
import { chooseVariation, type VariationChoice } from "./NarrativeVariation.ts";

export const NARRATIVE_VERSION = "nino_narrative.v1";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const NARRATIVE_MODEL = MODEL_TIERS.tier2_analysis.primary;

function money(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function factLine(label: string, kind: string, value: number | null, text: string | null): string {
  if (value == null) return `- ${label}: ${text ?? "—"}`;
  if (kind === "money") return `- ${label}: ${money(value)}`;
  if (kind === "percentage") return `- ${label}: ${value}%`;
  return `- ${label}: ${value}`;
}

/** Prompt determinístico — testável sem rede. */
export function buildNarrativePrompt(args: {
  pack: NarrativeEvidencePack;
  rules: ToneRules;
  variation: VariationChoice;
  channel: "app" | "whatsapp" | "report";
}): { system: string; user: string } {
  const { pack, rules, variation, channel } = args;
  const system = [
    "Você é o Nino, assessor financeiro pessoal brasileiro. Escreve em português do Brasil.",
    "Sua função aqui é TRADUZIR evidência financeira já calculada em uma leitura humana.",
    "REGRAS INVIOLÁVEIS:",
    "- Não calcule, não some, não estime e não projete nada.",
    "- Só cite valores, percentuais e datas que estejam na lista de evidência.",
    "- Não afirme causa, risco ou projeção que não esteja nas afirmações permitidas.",
    "- Nunca julgue moralmente o gasto do usuário e nunca use tom de cobrança.",
    "- Nunca mencione modelo, provedor de IA ou nome interno de motor.",
    `- No máximo ${rules.maxSentences} frases e ${rules.maxNumbers} números no texto inteiro.`,
    "- Conclusão antes do número. Uma pergunta no final, no máximo.",
    channel === "whatsapp"
      ? "- Canal WhatsApp: frases curtas, quebras de linha, no máximo um emoji."
      : "- Canal app: texto corrido curto, sem emoji.",
    `TOM (${rules.tone}): ${rules.guidance}`,
    `FORMA: ${variation.structure_guidance} Sugestão de abertura: "${variation.opening}"`,
    "Responda SOMENTE com o texto final da mensagem, sem título, sem aspas e sem explicações.",
  ].join("\n");

  const lines: string[] = [
    `TIPO: ${pack.kind} (severidade ${pack.severity})`,
    pack.period ? `PERÍODO: ${pack.period.label} (${pack.period.from} a ${pack.period.to})` : "PERÍODO: não declarado",
    "",
    "LEITURA DETERMINÍSTICA DO MOTOR (fonte de verdade, reescreva com naturalidade):",
    pack.deterministic_body || pack.deterministic_title,
    "",
    "FATOS CANÔNICOS:",
  ];
  if (pack.primary_fact) {
    lines.push(factLine(`principal (${pack.primary_fact.label})`, pack.primary_fact.kind, pack.primary_fact.value, pack.primary_fact.text));
  }
  for (const fact of pack.supporting_facts.slice(0, 5)) {
    lines.push(factLine(fact.label, fact.kind, fact.value, fact.text));
  }
  const entities = [
    pack.entities.categories.length ? `categorias: ${pack.entities.categories.join(", ")}` : "",
    pack.entities.merchants.length ? `estabelecimentos: ${pack.entities.merchants.join(", ")}` : "",
    pack.entities.goals.length ? `metas: ${pack.entities.goals.join(", ")}` : "",
    pack.entities.cards.length ? `cartões: ${pack.entities.cards.join(", ")}` : "",
  ].filter(Boolean);
  if (entities.length) lines.push("", `ENTIDADES CITÁVEIS: ${entities.join(" | ")}`);
  lines.push(
    "",
    `NÚMEROS PERMITIDOS: ${pack.allowed_numbers.map((n) => n.toString()).join(", ") || "nenhum"}`,
    `AFIRMAÇÕES PERMITIDAS: ${pack.allowed_claims.join(", ")}`,
    `PROIBIDO: ${pack.prohibited_claims.join("; ")}`,
  );
  if (pack.user_context.length) {
    lines.push("", `CONTEXTO QUE O USUÁRIO JÁ DECLAROU (reconheça, não repita como novidade): ${pack.user_context.join(" | ")}`);
  }
  lines.push("", `PERGUNTA SUGERIDA (adapte, mantenha específica): ${pack.question_hint ?? rules.question}`);
  return { system, user: lines.join("\n") };
}

export type NarrativeResult = {
  version: typeof NARRATIVE_VERSION;
  mode: "narrative" | "deterministic";
  body: string;
  model: string | null;
  latency_ms: number | null;
  guard: GuardResult | null;
  fallback_reason: string | null;
  variation: VariationChoice | null;
  narrative_body: string | null;
};

export function deterministicResult(pack: NarrativeEvidencePack, reason: string): NarrativeResult {
  return {
    version: NARRATIVE_VERSION,
    mode: "deterministic",
    body: pack.deterministic_body || pack.deterministic_title,
    model: null,
    latency_ms: null,
    guard: null,
    fallback_reason: reason,
    variation: null,
    narrative_body: null,
  };
}

/** Formatação escaneável do WhatsApp: título em negrito e pergunta destacada. */
export function formatNarrativeForWhatsapp(title: string, body: string): string {
  const t = String(title ?? "").trim();
  const paragraphs = String(body ?? "").trim().split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const out = paragraphs.map((p) => (p.endsWith("?") ? `*${p}*` : p));
  return [t ? `*${t}*` : "", ...out].filter(Boolean).join("\n\n");
}

export async function composeNarrative(args: {
  sb: SupabaseClient;
  userId: string;
  pack: NarrativeEvidencePack;
  rules: ToneRules;
  channel: "app" | "whatsapp" | "report";
  subjectKey: string;
  recentSameSubject?: number;
  forbiddenTerms?: string[];
  functionName?: string;
}): Promise<NarrativeResult> {
  const { pack, rules } = args;
  if (!Deno.env.get("LOVABLE_API_KEY")) return deterministicResult(pack, "ai_not_configured");
  if (!pack.deterministic_body && !pack.deterministic_title) return deterministicResult(pack, "no_deterministic_body");

  const variation = chooseVariation({
    userId: args.userId, subjectKey: args.subjectKey, tone: rules.tone,
    recentSameSubject: args.recentSameSubject,
  });
  const prompt = buildNarrativePrompt({ pack, rules, variation, channel: args.channel });
  const started = Date.now();
  let json: any = null;
  let httpStatus: number | null = null;
  try {
    const resp = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": Deno.env.get("LOVABLE_API_KEY")!,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      body: JSON.stringify({
        model: NARRATIVE_MODEL,
        temperature: 0.5,
        max_tokens: 700,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });
    httpStatus = resp.status;
    const text = await resp.text();
    if (!resp.ok) {
      await recordGatewayCall(args.sb, {
        workload: "PROACTIVE",
        function_name: args.functionName ?? "communication-dispatcher",
        operation: "narrative_compose",
        user_id: args.userId,
        model: NARRATIVE_MODEL,
        operation_type: "chat",
        success: false,
        http_status: resp.status,
        error_code: `gateway_${resp.status}`,
        latency_ms: Date.now() - started,
        reason_for_ai_call: "narrative_framing",
        metadata: { kind: pack.kind, channel: args.channel },
      }, null);
      return deterministicResult(pack, `gateway_${resp.status}`);
    }
    json = JSON.parse(text);
  } catch (error) {
    return deterministicResult(pack, `gateway_error:${String(error).slice(0, 60)}`);
  }
  const latency = Date.now() - started;
  await recordGatewayCall(args.sb, {
    workload: "PROACTIVE",
    function_name: args.functionName ?? "communication-dispatcher",
    operation: "narrative_compose",
    user_id: args.userId,
    model: NARRATIVE_MODEL,
    operation_type: "chat",
    success: true,
    http_status: httpStatus,
    latency_ms: latency,
    reason_for_ai_call: "narrative_framing",
    metadata: { kind: pack.kind, channel: args.channel, tone: rules.tone },
  }, json);

  const raw = String(json?.choices?.[0]?.message?.content ?? "").trim().replace(/^["'“]|["'”]$/g, "");
  const guard = guardNarrative({ text: raw, pack, rules, forbiddenTerms: args.forbiddenTerms });
  if (!guard.ok) {
    return {
      ...deterministicResult(pack, `guard:${guard.violations.join(",")}`),
      model: NARRATIVE_MODEL,
      latency_ms: latency,
      guard,
      variation,
      narrative_body: raw.slice(0, 1200) || null,
    };
  }
  return {
    version: NARRATIVE_VERSION,
    mode: "narrative",
    body: raw,
    model: NARRATIVE_MODEL,
    latency_ms: latency,
    guard,
    fallback_reason: null,
    variation,
    narrative_body: raw,
  };
}
