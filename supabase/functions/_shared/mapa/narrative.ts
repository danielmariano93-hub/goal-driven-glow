// E12 — redação do Mapa. A IA só REESCREVE o texto determinístico, com os fatos e números do MapaEvidencePack.
// Falha de rede, resposta fora do esquema ou reprovação na guarda ⇒ texto determinístico (nunca sai texto reprovado).
// deno-lint-ignore-file no-explicit-any
import { recordGatewayCall } from "../aiUsageLedger.ts";
import { aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiProvider } from "../ai-runtime.ts";
import { MODEL_TIERS } from "../intelligence/modelGateway.ts";
import { LLM_MODES, MAPA_PROMPT_VERSION, type MapaEvidencePack } from "../finance-core/mapaEvidencePack.ts";
import { guardMapaText, type MapaGuardResult } from "./narrativeGuard.ts";

const MODEL = MODEL_TIERS.tier2_analysis.primary;

export interface MapaNarrative {
  title: string;
  body: string;
  question: string | null;
  source: "llm" | "template";
  fallback_reason: string | null;
}

export interface CompleteFn { (prompt: { system: string; user: string }): Promise<{ text: string; model?: string; latency_ms?: number }> }

/** Prompt determinístico (testável sem rede). */
export function buildMapaPrompt(pack: MapaEvidencePack): { system: string; user: string } {
  const system = [
    "Você é o Nino, assessor financeiro pessoal brasileiro. Escreve em português do Brasil, com calma e simplicidade.",
    "QUEM FALA: o Nino fala COM a pessoa. Trate-a por 'você'. NUNCA escreva como se fosse a pessoa ('meu resultado', 'tive', 'consigo', 'minha reserva'). NUNCA fale de si mesmo ('eu vejo', 'vou conferir', 'continuarei'). Convites usam 'você' ou 'vamos'.",
    "SUA TAREFA: reescrever a LEITURA DETERMINÍSTICA com outras palavras, MANTENDO exatamente os mesmos fatos e a mesma ação. Não acrescente nenhuma interpretação.",
    "REGRAS INVIOLÁVEIS:",
    "- Só cite números que estejam em NÚMEROS PERMITIDOS, escritos como nos FATOS (sem arredondar meses, sem converter).",
    "- Não conclua nada que não esteja escrito: nada de 'indica', 'significa', 'mostra que', 'tranquilidade', 'segurança financeira', 'está tudo bem/mal'. Não explique causas e não fale de emoções.",
    "- Sem diagnóstico, sem julgamento, sem promessa, sem nota ou pontuação, sem 'indicador', 'fórmula', 'modelo' ou 'IA'.",
    "- Se o MODO for recomendacao_estrutural, a dificuldade está na renda e nas contas grandes: NÃO diga para gastar ou cortar menos.",
    "- No máximo 3 frases; cada frase com até 15 palavras. No máximo 2 números no texto todo.",
    "- Termine com UMA pergunta curta que convide para a ação recomendada (campo question).",
    'Responda SOMENTE com um objeto JSON, sem markdown: {"title": "...", "body": "...", "question": "..."}',
  ].join("\n");
  const facts = pack.facts.map((f) => `- ${f.label} (${f.window_label}): ${f.text}`);
  const user = [
    `MODO: ${pack.mode}`,
    pack.recommendation ? `AÇÃO RECOMENDADA: ${pack.recommendation.action_label} (${pack.recommendation.kind})` : "AÇÃO RECOMENDADA: nenhuma",
    "",
    "FATOS:",
    ...(facts.length ? facts : ["- sem fatos"]),
    "",
    "LEITURA DETERMINÍSTICA (fonte de verdade; reescreva com naturalidade, sem acrescentar fatos):",
    `${pack.deterministic.title}. ${pack.deterministic.body}${pack.deterministic.question ? ` ${pack.deterministic.question}` : ""}`,
    "",
    `NÚMEROS PERMITIDOS: ${pack.allowed_numbers.join(", ") || "nenhum"}`,
    `AFIRMAÇÕES PERMITIDAS: ${pack.allowed_claims.join(", ")}`,
    `PROIBIDO: ${pack.prohibited_claims.join("; ")}`,
  ].join("\n");
  return { system, user };
}

/** Extrai {title, body, question} do JSON do modelo (aceita cerca ```json). Fora do esquema ⇒ null. */
export function parseMapaNarrativeJson(raw: string): { title: string; body: string; question: string | null } | null {
  const cleaned = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let obj: any;
  try { obj = JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/); // modelo que fala antes/depois do JSON
    try { obj = m ? JSON.parse(m[0]) : null; } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const body = typeof obj.body === "string" ? obj.body.trim() : "";
  const q = typeof obj.question === "string" ? obj.question.trim() : "";
  if (!title || title.length > 80 || !body || body.length > 500 || q.length > 120) return null;
  return { title, body, question: q || null };
}

export function templateNarrative(pack: MapaEvidencePack, reason: string): MapaNarrative {
  return { ...pack.deterministic, source: "template", fallback_reason: reason };
}

/** Compõe o texto com a IA e valida. `complete` é injetável (testes, avaliação offline). */
export async function composeMapaNarrative(pack: MapaEvidencePack, complete: CompleteFn): Promise<{ narrative: MapaNarrative; guard: MapaGuardResult | null; model: string | null; latency_ms: number | null; raw?: string }> {
  if (!LLM_MODES.has(pack.mode)) return { narrative: templateNarrative(pack, "template_only_mode"), guard: null, model: null, latency_ms: null };
  let out: { text: string; model?: string; latency_ms?: number };
  try { out = await complete(buildMapaPrompt(pack)); } catch (error) {
    return { narrative: templateNarrative(pack, `gateway_error:${String(error).slice(0, 60)}`), guard: null, model: null, latency_ms: null };
  }
  const parsed = parseMapaNarrativeJson(out.text);
  if (!parsed) return { narrative: templateNarrative(pack, "schema"), guard: null, model: out.model ?? null, latency_ms: out.latency_ms ?? null, raw: out.text.slice(0, 400) };
  const guard = guardMapaText({ title: parsed.title, body: parsed.body, question: parsed.question, pack });
  if (!guard.ok) return { narrative: templateNarrative(pack, `guard:${guard.violations.join(",")}`), guard, model: out.model ?? null, latency_ms: out.latency_ms ?? null, raw: `${parsed.title} | ${parsed.body} | ${parsed.question ?? ""}`.slice(0, 400) };
  return { narrative: { ...parsed, source: "llm", fallback_reason: null }, guard, model: out.model ?? null, latency_ms: out.latency_ms ?? null };
}

/**
 * Chamada real ao provedor configurado. `record` liga a telemetria em llm_calls (padrão). null = IA não configurada.
 * A avaliação offline usa `record: false` (não polui o uso de produção) e o mesmo caminho do app, para medir o que o usuário recebe.
 */
export function providerComplete(sb: any, userId: string | null, opts: { operation?: string; record?: boolean; maxTokens?: number } = {}): CompleteFn | null {
  const provider = resolveAiProvider();
  if (!provider) return null;
  const operation = opts.operation ?? "mapa_narrative";
  return async (prompt) => {
    const started = Date.now();
    const resp = await fetch(aiEndpoint(provider, "chat/completions"), {
      method: "POST",
      headers: aiJsonHeaders(provider),
      body: JSON.stringify({
        model: normalizeAiModel(MODEL, provider), temperature: 0.3, max_tokens: opts.maxTokens ?? 700,
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      }),
    });
    const text = await resp.text();
    const latency = Date.now() - started;
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* corpo não JSON */ }
    if (opts.record !== false) {
      await recordGatewayCall(sb, {
        workload: "INSIGHTS", function_name: "nino-insights", operation, user_id: userId,
        model: normalizeAiModel(MODEL, provider), provider: provider.provider, operation_type: "chat", success: resp.ok,
        http_status: resp.status, ...(resp.ok ? {} : { error_code: `gateway_${resp.status}` }), latency_ms: latency,
        reason_for_ai_call: operation, metadata: { prompt_version: MAPA_PROMPT_VERSION },
      }, json);
    }
    if (!resp.ok) throw new Error(`gateway_${resp.status}:${text.slice(0, 120)}`);
    return { text: String(json?.choices?.[0]?.message?.content ?? ""), model: MODEL, latency_ms: latency };
  };
}

export interface JudgeVerdict { faithful: boolean; invented: string[]; clear: boolean; calm: boolean; actionable: boolean; note: string }

/** Juiz (mesmo provedor, outro papel): confere se o texto diz SÓ o que os fatos sustentam. Complementa a guarda determinística. */
export function buildJudgePrompt(pack: MapaEvidencePack, text: { title: string; body: string; question: string | null }): { system: string; user: string } {
  const system = [
    "Você é um revisor rigoroso de textos de um app de finanças pessoais em português do Brasil.",
    "Receberá FATOS (a única verdade permitida) e um TEXTO. Avalie o TEXTO com estes critérios:",
    "- faithful: true só se TUDO que o texto afirma está nos FATOS ou na leitura determinística; qualquer afirmação nova sobre causa, intenção, emoção, futuro, o que a pessoa 'deve' fazer fora da ação recomendada, ou comparação não sustentada = false.",
    "- invented: lista curta de trechos que não têm base nos fatos (vazia se faithful).",
    "- clear: true se uma pessoa sem conhecimento financeiro entende o texto de primeira, sem jargão.",
    "- calm: true se o tom é calmo, sem alarmismo, sem julgamento moral e sem cobrança.",
    "- actionable: true se, havendo ação recomendada, o texto deixa claro qual é o próximo passo (se não há ação, true).",
    "- note: uma frase com o principal problema, ou 'ok'.",
    'Responda SOMENTE com JSON: {"faithful":bool,"invented":[...],"clear":bool,"calm":bool,"actionable":bool,"note":"..."}',
  ].join("\n");
  const user = [
    `MODO: ${pack.mode}`,
    pack.recommendation ? `AÇÃO RECOMENDADA: ${pack.recommendation.action_label} (${pack.recommendation.kind})` : "AÇÃO RECOMENDADA: nenhuma",
    "FATOS:", ...(pack.facts.length ? pack.facts.map((f) => `- ${f.label} (${f.window_label}): ${f.text}`) : ["- sem fatos"]),
    `LEITURA DETERMINÍSTICA: ${pack.deterministic.title}. ${pack.deterministic.body}${pack.deterministic.question ? ` ${pack.deterministic.question}` : ""}`,
    "", `TEXTO A AVALIAR: ${text.title}. ${text.body}${text.question ? ` ${text.question}` : ""}`,
  ].join("\n");
  return { system, user };
}

export function parseJudge(raw: string): JudgeVerdict | null {
  try {
    const t = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const o = JSON.parse(t.startsWith("{") ? t : (t.match(/\{[\s\S]*\}/)?.[0] ?? "null"));
    if (typeof o?.faithful !== "boolean" || typeof o?.clear !== "boolean" || typeof o?.calm !== "boolean") return null;
    return { faithful: o.faithful, invented: Array.isArray(o.invented) ? o.invented.map(String).slice(0, 5) : [], clear: o.clear, calm: o.calm, actionable: o.actionable !== false, note: String(o.note ?? "").slice(0, 200) };
  } catch { return null; }
}

/** Narrativa com cache por hash da evidência (llm vale até a evidência mudar; template vale por algumas horas). */
export async function explainMapa(sb: any, userId: string, pack: MapaEvidencePack): Promise<MapaNarrative> {
  try {
    const { data } = await sb.from("map_narratives").select("title,body,question,source,created_at")
      .eq("user_id", userId).eq("evidence_hash", pack.hash).eq("prompt_version", MAPA_PROMPT_VERSION).maybeSingle();
    if (data && (data.source === "llm" || Date.now() - Date.parse(data.created_at) < 6 * 3_600_000)) {
      return { title: data.title, body: data.body, question: data.question ?? null, source: data.source, fallback_reason: null };
    }
  } catch (error) { console.warn("mapa:narrative_cache_read", String(error).slice(0, 120)); }

  const complete = providerComplete(sb, userId);
  const result = complete ? (await composeMapaNarrative(pack, complete)).narrative : templateNarrative(pack, "ai_not_configured");
  try {
    await sb.from("map_narratives").upsert({
      user_id: userId, evidence_hash: pack.hash, prompt_version: MAPA_PROMPT_VERSION,
      title: result.title, body: result.body, question: result.question, source: result.source, created_at: new Date().toISOString(),
    }, { onConflict: "user_id,evidence_hash,prompt_version" });
  } catch (error) { console.warn("mapa:narrative_cache_write", String(error).slice(0, 120)); }
  return result;
}

/** Avaliação offline: passa cada pacote por `complete` e mede fidelidade e taxa de fallback. Rodar com um modelo real antes de mudar prompt/modelo. */
export async function runMapaNarrativeEval(packs: MapaEvidencePack[], complete: CompleteFn): Promise<{
  n: number; llm: number; fallback: number; fallback_rate: number; violations: Record<string, number>;
}> {
  const violations: Record<string, number> = {};
  let llm = 0;
  for (const pack of packs) {
    const r = await composeMapaNarrative(pack, complete);
    if (r.narrative.source === "llm") llm += 1;
    for (const v of r.guard?.violations ?? []) violations[v] = (violations[v] ?? 0) + 1;
  }
  return { n: packs.length, llm, fallback: packs.length - llm, fallback_rate: packs.length ? (packs.length - llm) / packs.length : 0, violations };
}
