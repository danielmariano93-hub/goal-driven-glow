// Nino Runtime V3 — conversational composer (reactive chat voice).
//
// Execution already happened: engines produced evidence and a deterministic
// body. This layer only WRITES — it turns that body into a reply that sounds
// like a personal advisor who remembers the conversation. It never sees the
// database, never calls tools and may not cite a number, date or amount that
// is not in the evidence or in what the user said. Any guard violation, model
// failure or timeout returns the deterministic body unchanged.
//
// The same call can surface durable personal context the user volunteered
// ("vou viajar em dezembro"). Those notes are relationship memory, never
// financial truth, and are persisted only when the rollout allows it.
// deno-lint-ignore-file no-explicit-any

import { callStructuredFunction } from "../../ai-structured.ts";
import { resolveAiProvider, type AiProviderConfig } from "../../ai-runtime.ts";
import { BANNED_WORDS } from "../../copy/ninoVoice.ts";
import { citedNumbers, matchesEvidence } from "../narrative/NarrativeGuard.ts";

export const COMPOSER_VERSION = "nino_conversational_composer.v1";
export const COMPOSER_DEADLINE_MS = 10_000;

export type ComposeKind = "conversation" | "answer" | "advisory" | "decision" | "compound";

export type ComposeHistoryTurn = { role: "user" | "assistant"; content: string };

export type RelationshipNote = {
  key: string;
  note: string;
  kind: "life_event" | "plan" | "concern" | "preference" | "family" | "work";
  horizon: string | null;
};

export type ComposeInput = {
  kind: ComposeKind;
  channel: "app" | "whatsapp" | "simulator";
  user_text: string;
  history: ComposeHistoryTurn[];
  /** Durable preferences + relationship memory (non-financial). */
  relationship_context: string | null;
  /** Engine-rendered text. Source of truth and fallback. */
  deterministic_body: string;
  /** Raw engine results / computed facts used as citable evidence. */
  evidence: unknown[];
  /** Whether the reply may carry a single next-step offer. */
  allow_offer: boolean;
  capture_memory: boolean;
  today: string;
  model?: string | null;
  provider_override?: AiProviderConfig | null;
};

export type ComposeTelemetry = {
  model: string | null;
  provider: string | null;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
};

export type ComposeResult = {
  version: typeof COMPOSER_VERSION;
  mode: "composed" | "deterministic";
  text: string;
  reason: string | null;
  violations: string[];
  notes: RelationshipNote[];
  telemetry: ComposeTelemetry;
};

const NOTE_KINDS = ["life_event", "plan", "concern", "preference", "family", "work"] as const;

function envValue(name: string): string | undefined {
  const denoEnv = (globalThis as any)?.Deno?.env;
  if (denoEnv && typeof denoEnv.get === "function") return denoEnv.get(name) ?? undefined;
  const processEnv = (globalThis as any)?.process?.env;
  return processEnv ? processEnv[name] : undefined;
}

export function composerModel(explicit?: string | null): string {
  return String(
    explicit
      ?? envValue("NINO_COMPOSER_MODEL")
      ?? envValue("NINO_AI_MODEL")
      ?? "openai/gpt-oss-120b",
  ).trim();
}

/**
 * Voice quality first, availability second: the primary composer model, then
 * an independent model family. Rate limits are per model, so a 429 on the primary (shared
 * with deep semantic review) moves to a different quota instead of dropping
 * straight to the deterministic body.
 */
export function composerModelChain(explicit?: string | null): string[] {
  const chain = [
    composerModel(explicit),
    // Different model family with its own quota and 10/10 strict-schema
    // reliability in the 2026-09-29 benchmark (gpt-oss-20b: 6/10).
    String(envValue("NINO_COMPOSER_FALLBACK_MODEL") ?? envValue("NINO_SEMANTIC_REVIEW_MODEL") ?? "qwen/qwen3.8-27b").trim(),
  ].filter(Boolean);
  return [...new Set(chain)];
}

function capacityFailure(code: string | null | undefined): boolean {
  return /structured_call_gateway_(?:429|413|5\d\d)|structured_call_network/.test(String(code ?? ""));
}

function composerTool() {
  return {
    name: "emit_nino_reply",
    description: "Emit the final user-facing reply and durable personal notes the user volunteered.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reply", "remember"],
      properties: {
        reply: { type: "string" },
        remember: {
          type: "array",
          maxItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "note", "kind", "horizon"],
            properties: {
              key: { type: "string" },
              note: { type: "string" },
              kind: { type: "string", enum: [...NOTE_KINDS] },
              horizon: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
        },
      },
    },
  } as const;
}

const KIND_GUIDANCE: Record<ComposeKind, string> = {
  conversation: "Turno de conversa sem pedido de dado. Responda como uma pessoa ao que ele ACABOU de dizer: comente o conteúdo concreto da mensagem (o plano, o sentimento, a novidade, o agradecimento) com uma frase específica antes de qualquer oferta. Nunca responda só com uma pergunta ou só com uma oferta genérica. Se fizer sentido, conecte com o que você já sabe dele. Não traga números novos.",
  answer: "O usuário pediu um dado. Responda a pergunta logo na primeira frase com o número principal, depois dê UMA leitura útil (o que chama atenção, comparação ou padrão presente nos fatos).",
  advisory: "O usuário quer orientação/simulação. Explique o resultado da simulação em linguagem simples, diga o que isso significa na prática e sugira um próximo passo concreto baseado nos fatos.",
  decision: "O usuário está pesando uma decisão. Raciocine como um assessor: pese as alternativas com princípios financeiros sólidos (reserva de emergência, custo de dívida costuma superar rendimento de aplicação conservadora, liquidez, metas), usando SOMENTE os números dos fatos. Dê uma recomendação clara condicionada ao quadro dele e diga qual informação mudaria a recomendação.",
  compound: "O usuário fez mais de um pedido na mesma mensagem. Responda cada parte na ordem, conectando-as numa conversa só (por exemplo: o dado e, em seguida, o conselho que decorre dele).",
};

export function buildComposerPrompt(input: ComposeInput): { system: string; user: string } {
  const whatsapp = input.channel !== "app";
  const system = [
    "Você é o Nino, assessor financeiro pessoal brasileiro. Fala português do Brasil, de forma próxima, clara e respeitosa — como um amigo que entende muito de dinheiro, nunca como um relatório.",
    "Você está escrevendo a PRÓXIMA mensagem de uma conversa em andamento. Leia o histórico e dê continuidade natural: não se reapresente, não cumprimente de novo se a conversa já começou, retome o que foi dito quando for relevante.",
    "REGRAS INVIOLÁVEIS:",
    "- Cite SOMENTE números, valores, percentuais e datas que aparecem em FATOS ou na mensagem do usuário. Não calcule, não some, não estime, não arredonde para valores diferentes (pode escrever R$ 1,2 mil para R$ 1.234,00).",
    "- Se FATOS trazem uma resposta numérica, ela tem que aparecer na sua resposta.",
    "- Nunca faça contas (somar, subtrair, dividir, porcentagem). Se quiser falar de uma sobra, diferença ou total, use só as contas que já vêm prontas em FATOS; se não houver, fale de forma qualitativa, sem número.",
    "- Não invente fatos pessoais, taxas de juros, rendimentos de mercado ou datas.",
    "- Nunca julgue moralmente o usuário, nunca dê bronca, nunca use tom de cobrança.",
    "- Nunca mencione modelo, IA, sistema, ferramenta, motor, banco de dados ou qualquer detalhe interno.",
    "- Não diga que registrou, alterou ou agendou nada: você só conversa sobre o que já está nos fatos.",
    input.allow_offer
      ? "- No máximo UMA pergunta ou oferta de próximo passo, no final, específica ao assunto. Oferta sempre no formato \"Quer que eu …?\" (ex.: \"Quer que eu compare com o mês passado?\"), para que um \"sim\" do usuário seja entendido."
      : "- Não termine com oferta de próximo passo; no máximo uma pergunta se for realmente necessária.",
    whatsapp
      ? "- Canal WhatsApp: mensagens curtas, parágrafos de 1-2 frases separados por linha em branco, no máximo um emoji e só se couber no tom. Pode usar *negrito* no número principal."
      : "- Canal app: texto curto e corrido, sem emoji.",
    "- Tamanho: o suficiente para ser útil e humano; normalmente 2 a 5 frases. Listas só quando o dado for uma lista.",
    "- Reconheça sentimentos quando o usuário expressar (preocupação, alívio, surpresa) antes de ir aos números.",
    "- Use o que você lembra do usuário (MEMÓRIA DE RELACIONAMENTO) só quando for natural e relevante, sem soar invasivo.",
    `TIPO DE TURNO: ${KIND_GUIDANCE[input.kind]}`,
    input.capture_memory
      ? [
        "CAMPO remember: registre no máximo 2 fatos pessoais DURÁVEIS que o usuário contou NESTA mensagem (planos, eventos de vida, família, trabalho, preocupações recorrentes, preferências de como quer ser ajudado).",
        "Escreva cada nota em 3ª pessoa, curta (ex.: \"Planeja viajar para o Nordeste em dezembro\"). key = slug curto sem acento (ex.: viagem_dezembro). horizon = AAAA-MM quando houver data, senão null.",
        "NUNCA registre valores, saldos, gastos ou qualquer número financeiro, nem dados de saúde, religião, política ou orientação sexual. Se não houver nada durável, remember=[].",
      ].join("\n")
      : "CAMPO remember: sempre [].",
    "Saída: somente emit_nino_reply.",
  ].join("\n");

  const history = input.history.slice(-8).map((turn) =>
    `${turn.role === "user" ? "Usuário" : "Nino"}: ${String(turn.content ?? "").replace(/\s+/g, " ").trim().slice(0, 600)}`
  ).join("\n");
  const evidence = safeEvidenceJson(input.evidence, 6_000);
  const user = [
    `HOJE: ${input.today}`,
    input.relationship_context ? `MEMÓRIA DE RELACIONAMENTO (não é fato financeiro): ${input.relationship_context.slice(0, 2_500)}` : "MEMÓRIA DE RELACIONAMENTO: nenhuma.",
    history ? `HISTÓRICO RECENTE:\n${history}` : "HISTÓRICO RECENTE: início da conversa.",
    `MENSAGEM ATUAL DO USUÁRIO: ${input.user_text}`,
    "",
    input.kind === "conversation"
      ? `RASCUNHO DE RESPOSTA (pode reescrever livremente, mantendo o sentido): ${input.deterministic_body}`
      : `FATOS (fonte de verdade calculada; reescreva com naturalidade sem perder o número principal):\n${input.deterministic_body}`,
    evidence ? `DADOS ESTRUTURADOS DE APOIO (mesma verdade, não cite nomes de campos):\n${evidence}` : "",
  ].filter(Boolean).join("\n");
  return { system, user };
}

function safeEvidenceJson(evidence: unknown[], max: number): string {
  if (!evidence?.length) return "";
  try {
    const text = JSON.stringify(evidence, (key, value) => {
      if (/^(id|user_id|goal_id|category_id|account_id|reconciliation_id|provenance|query_fingerprint|formula_version)$/.test(key)) return undefined;
      return value;
    });
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return "";
  }
}

/** Every number the reply may legitimately cite. */
export function allowedNumbersFrom(texts: string[], evidence: unknown[]): number[] {
  const out = new Set<number>();
  const addText = (text: string) => {
    for (const cited of citedNumbers(text)) out.add(Math.abs(cited.value));
    for (const m of String(text ?? "").matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g)) {
      const value = Number(`${m[1].replace(/\./g, "")}${m[2] ? `.${m[2]}` : ""}`);
      if (Number.isFinite(value)) out.add(Math.abs(value));
    }
  };
  for (const text of texts) addText(text);
  const walk = (value: unknown, depth: number) => {
    if (depth > 8 || value == null) return;
    if (typeof value === "number" && Number.isFinite(value)) {
      out.add(Math.abs(value));
      out.add(Math.abs(Math.round(value * 100) / 100));
      return;
    }
    if (typeof value === "string") {
      if (value.length < 200) addText(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 60)) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const child of Object.values(value as Record<string, unknown>)) walk(child, depth + 1);
    }
  };
  walk(evidence, 0);
  return [...out];
}

function firstMoney(text: string): number | null {
  const money = citedNumbers(text).find((n) => n.kind === "money");
  return money ? Math.abs(money.value) : null;
}

function citedDateKeys(text: string): string[] {
  return Array.from(String(text ?? "").matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g))
    .map((m) => `${Number(m[1])}/${Number(m[2])}`);
}

function allowedDateKeys(texts: string[], evidence: unknown[]): Set<string> {
  const keys = new Set<string>();
  const add = (text: string) => {
    for (const k of citedDateKeys(text)) keys.add(k);
    for (const m of String(text ?? "").matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) keys.add(`${Number(m[3])}/${Number(m[2])}`);
  };
  for (const text of texts) add(text);
  try { add(JSON.stringify(evidence ?? [])); } catch { /* ignore */ }
  return keys;
}

const PROVIDER_OR_INTERNAL = [
  /\bgpt\b/i, /\bopenai\b/i, /\bgroq\b/i, /\bllm\b/i, /modelo de linguagem/i, /\bprompt\b/i,
  /intelig[êe]ncia artificial/i, /\bsou uma ia\b/i, /\bengine\b/i, /\bmotor\b/i, /\bferramenta\b/i,
  /\bbanco de dados\b/i, /\bjson\b/i, /\bruntime\b/i,
];
const MORAL = [/\bvocê (gastou|torrou) demais\b/i, /\birresponsáve/i, /\bfalta de (disciplina|controle)\b/i, /\bdevia ter\b/i];
const FALSE_ACTION = [/\b(registrei|anotei|lancei|agendei|salvei|cadastrei|alterei|exclu[íi])\b/i];

export function guardComposedReply(args: {
  text: string;
  input: ComposeInput;
}): { ok: boolean; violations: string[] } {
  const text = String(args.text ?? "").trim();
  const input = args.input;
  const violations: string[] = [];
  const push = (v: string) => { if (!violations.includes(v)) violations.push(v); };
  if (!text) return { ok: false, violations: ["empty_text"] };
  if (text.length > 1_600) push("too_long");
  if (!/[.!?…)\]*"'”]$/.test(text) && !/[.!?]\s*[\p{Extended_Pictographic}️]+$/u.test(text)
    && !/\p{Extended_Pictographic}️?$/u.test(text)) {
    push("truncated_text");
  }

  const sourceTexts = [input.deterministic_body, input.user_text];
  if (input.kind === "conversation") {
    for (const turn of input.history.slice(-8)) sourceTexts.push(String(turn.content ?? ""));
  }
  const allowed = allowedNumbersFrom(sourceTexts, input.evidence);
  for (const cited of citedNumbers(text)) {
    if (!matchesEvidence(cited.value, allowed)) push(`number_not_in_evidence:${cited.raw}`);
  }
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:reais|mil reais)\b/gi)) {
    const value = Number(`${m[1].replace(/\./g, "")}${m[2] ? `.${m[2]}` : ""}`);
    if (Number.isFinite(value) && !matchesEvidence(value, allowed)) push(`number_not_in_evidence:${m[0]}`);
  }
  const dates = allowedDateKeys(sourceTexts, input.evidence);
  for (const key of citedDateKeys(text)) {
    if (!dates.has(key)) push(`date_not_in_evidence:${key}`);
  }

  if (input.kind === "answer") {
    // A factual answer must keep the number that answers the question.
    const headline = firstMoney(input.deterministic_body);
    if (headline != null && !citedNumbers(text).some((n) => n.kind === "money" && matchesEvidence(n.value, [headline]))) {
      push("headline_number_missing");
    }
  } else if (input.kind !== "conversation") {
    // Advice, simulations, decisions and compound turns may lead with the most
    // relevant result (e.g. the saving, not the baseline), but must still be
    // anchored in at least one computed amount when the facts carry money.
    const bodyMoney = citedNumbers(input.deterministic_body).filter((n) => n.kind === "money").map((n) => Math.abs(n.value));
    if (bodyMoney.length && !citedNumbers(text).some((n) => n.kind === "money" && matchesEvidence(n.value, bodyMoney))) {
      push("headline_number_missing");
    }
  }

  const lower = text.toLowerCase();
  for (const word of BANNED_WORDS) if (lower.includes(word.toLowerCase())) push(`banned_word:${word}`);
  if (PROVIDER_OR_INTERNAL.some((p) => p.test(text))) push("internal_or_provider_mentioned");
  if (MORAL.some((p) => p.test(text))) push("moral_judgement");
  if (FALSE_ACTION.some((p) => p.test(text)) && !FALSE_ACTION.some((p) => p.test(input.deterministic_body))) {
    push("claims_unperformed_action");
  }
  if ((text.match(/\?/g) ?? []).length > 2) push("too_many_questions");
  return { ok: violations.length === 0, violations };
}

const SENSITIVE_NOTE = /(sa[úu]de|doen[çc]a|diagn[óo]stic|rem[ée]dio|religi|pol[íi]tic|orienta[çc][ãa]o sexual|\bcpf\b|senha)/i;

export function sanitizeRelationshipNotes(raw: unknown): RelationshipNote[] {
  if (!Array.isArray(raw)) return [];
  const out: RelationshipNote[] = [];
  for (const item of raw.slice(0, 2)) {
    if (!item || typeof item !== "object") continue;
    const note = String((item as any).note ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const kind = String((item as any).kind ?? "");
    const key = String((item as any).key ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
    if (!note || !key || !(NOTE_KINDS as readonly string[]).includes(kind)) continue;
    // Relationship memory never carries financial truth or sensitive data.
    if (/r\$|\d{2,}(?:[.,]\d+)?\s*(?:reais|mil)?/i.test(note)) continue;
    if (SENSITIVE_NOTE.test(note)) continue;
    const horizonRaw = (item as any).horizon;
    const horizon = typeof horizonRaw === "string" && /^\d{4}-\d{2}$/.test(horizonRaw.trim()) ? horizonRaw.trim() : null;
    out.push({ key, note, kind: kind as RelationshipNote["kind"], horizon });
  }
  return out;
}

function deterministic(
  input: ComposeInput,
  reason: string,
  telemetry: ComposeTelemetry,
  violations: string[] = [],
  notes: RelationshipNote[] = [],
): ComposeResult {
  return {
    version: COMPOSER_VERSION,
    mode: "deterministic",
    text: input.deterministic_body,
    reason,
    violations,
    notes,
    telemetry,
  };
}

export async function composeConversationalReply(input: ComposeInput): Promise<ComposeResult> {
  const model = composerModel(input.model);
  const empty: ComposeTelemetry = {
    model, provider: null, llm_calls: 0, tokens_in: 0, tokens_out: 0, latency_ms: 0, ok: false, error: null,
  };
  if (!String(input.deterministic_body ?? "").trim()) return deterministic(input, "empty_body", empty);
  const provider = input.provider_override ?? resolveAiProvider();
  if (!provider) return deterministic(input, "ai_not_configured", empty);

  const prompt = buildComposerPrompt(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPOSER_DEADLINE_MS);
  let result: Awaited<ReturnType<typeof callStructuredFunction>> | null = null;
  let calls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const startedAt = Date.now();
  try {
    for (const candidate of composerModelChain(input.model)) {
      calls += 1;
      result = await callStructuredFunction({
        provider,
        model: candidate,
        system: prompt.system,
        user: prompt.user,
        tool: composerTool(),
        signal: controller.signal,
        temperature: 0.6,
        reasoning_effort: input.kind === "decision" ? "medium" : "low",
        max_attempts: 1,
      });
      tokensIn += result.input_tokens;
      tokensOut += result.output_tokens;
      if (result.ok || !capacityFailure(result.error_code) || controller.signal.aborted) break;
    }
  } catch (error) {
    clearTimeout(timer);
    return deterministic(input, `composer_exception:${String((error as Error)?.message ?? error).slice(0, 80)}`, {
      ...empty, llm_calls: Math.max(1, calls), error: "composer_exception",
    });
  }
  clearTimeout(timer);
  if (!result) return deterministic(input, "composer_not_called", empty);

  const telemetry: ComposeTelemetry = {
    model: result.model,
    provider: result.provider,
    llm_calls: Math.max(1, calls),
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: Date.now() - startedAt,
    ok: result.ok,
    error: result.ok ? null : result.error_code,
  };
  if (!result.ok) return deterministic(input, String(result.error_code ?? "composer_failed"), telemetry);

  let parsed: any = null;
  try { parsed = JSON.parse(result.arguments); } catch { /* handled below */ }
  const text = String(parsed?.reply ?? "").trim().replace(/^["“]|["”]$/g, "");
  const notes = input.capture_memory ? sanitizeRelationshipNotes(parsed?.remember) : [];
  const guard = guardComposedReply({ text, input });
  if (!guard.ok) {
    return deterministic(input, `guard:${guard.violations.slice(0, 4).join(",")}`.slice(0, 220), {
      ...telemetry, ok: false, error: "composer_guard_rejected",
    }, guard.violations, notes);
  }
  return {
    version: COMPOSER_VERSION,
    mode: "composed",
    text,
    reason: null,
    violations: [],
    notes,
    telemetry,
  };
}
