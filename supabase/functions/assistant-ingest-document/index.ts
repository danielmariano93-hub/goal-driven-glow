// Edge Function: assistant-ingest-document
// Modes:
//   POST { mode:'create-upload', filename, mime_type, size_bytes, conversation_id? }
//     -> { document_id, upload_url, storage_path, token }
//   POST { mode:'finalize', document_id, guidance? }
//     -> 202 { status:'processing' | terminal, document_id, correlation_id?, user_message? }
//   POST { mode:'resume', document_id }
//     -> same shape as finalize
//   POST { mode:'status', document_id }
//     -> { document_id, status, items?, error?, correlation_id?, user_message? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ALLOWED_MIME, MAX_BYTES, detectMime, sha256Hex, sanitize, normalizeAmountBR, normalizeDateBR, type ExtractionResult } from "../_shared/documents/types.ts";
import { normalizeDescription, extractBankReference, computeFingerprint } from "../_shared/documents/normalize.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const MODEL = "google/gemini-2.5-flash";
const BUCKET = "documents";
const PROCESSING_STALE_MS = 5 * 60 * 1000;
const EXTRACTION_TIMEOUT_MS = 90 * 1000;
const MAX_ITEMS_PER_DOCUMENT = 240;
const BATCH_ITEMS_LIMIT = 50;
const PDF_BATCHES = 5;
const IMAGE_BATCHES = 1;
const BATCH_MAX_TOKENS = 3600;

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error) return null;
  return data.user;
}

const SYSTEM_PROMPT = `Você é um extrator financeiro para o app NoControle.ia.

Analise o documento enviado (PDF, recibo, fatura, extrato, print de compra ou lista) e devolva JSON PURO, compacto, sem markdown:
{"k":"statement|receipt|invoice|list|non_financial|illegible|unknown","i":[["expense","YYYY-MM-DD",123.45,"descrição","account",null,null,"transaction",null,null,null,null,null]],"n":"nota curta","more":false,"m":{"opening_balance":null,"closing_balance":null,"balance_date":null,"period_start":null,"period_end":null,"bank":null}}

Cada item em "i" é EXATAMENTE:
[tipo,data,valor,descricao,pagamento,conta,cartao,movimento,parcelas_total,parcela_numero,data_compra,competencia,categoria]

Use null para campo desconhecido. Não use objetos dentro de "i".

REGRAS ESTRITAS:
- Valores em real brasileiro: aceite formatos 1.234,56 e 1234.56.
- Datas em português brasileiro dd/mm/aaaa OU ISO YYYY-MM-DD.
- A data atual é informada na mensagem do usuário. Se a linha não tiver data completa, use a data atual.
- Nunca invente ano. Data parcial (apenas hora, dia/mês ou dia da semana) usa o ano da data atual.
- Elementos da interface do celular e datas de referência do extrato não são, por si só, a data da compra.
- Nunca invente texto ilegível — melhor devolver i=[] e k="illegible".
- Se for imagem não financeira (meme, foto, screenshot de conversa sem valores), devolva k="non_financial" e i=[].
- EXCLUA todas as linhas informativas: SALDO DO DIA, saldo atual/em conta/anterior/disponível/total, limites, cabeçalhos, período, emissão, subtotais e totais.
- RESGATE CDB é resgate de investimento, não receita. Aplicação é investimento, não despesa.
- PIX entre contas da mesma pessoa é transferência interna, não receita/despesa. Se não houver certeza, marque internal_transfer e explique em notes.
- Estorno/reembolso (incluindo descrições iniciadas por EST) é refund/income, nunca nova renda recorrente.
- Preserve a descrição literal; não use "crédito", "débito", "cartão de crédito" ou "cartão" como descrição.
- O bloco "m" é metadata de extrato. Extraia APENAS de linhas informativas ("Saldo do dia", "Saldo final", "Saldo anterior"). Nunca vire transação.
- LIMITE RÍGIDO: devolva no máximo ${BATCH_ITEMS_LIMIT} lançamentos neste lote. Se houver mais lançamentos depois deste lote, use "more":true.
- Cada "description" deve ter no máximo 80 caracteres. Corte descrições longas mantendo o núcleo (nome do estabelecimento).
- Ordene sempre do mais recente para o mais antigo.
- Só devolva JSON, sem markdown, sem comentários fora do campo "n".`;

type StatementMetadata = {
  opening_balance: number | null;
  closing_balance: number | null;
  balance_date: string | null;
  period_start: string | null;
  period_end: string | null;
  bank: string | null;
};

type MultimodalOutcome = {
  result: ExtractionResult;
  statement: StatementMetadata | null;
  tokens_in: number;
  tokens_out: number;
  ms: number;
  has_more: boolean;
  partial: boolean;
  errorTag?: string;
};

function extractStatementMetadata(parsed: unknown, fallback: string): StatementMetadata | null {
  if (!parsed || typeof parsed !== "object") return null;
  const source = parsed as Record<string, unknown>;
  const raw = source["statement_metadata"] ?? source["m"];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const opening = normalizeAmountBR((r.opening_balance ?? null) as string | number | null ?? "");
  const closing = normalizeAmountBR((r.closing_balance ?? null) as string | number | null ?? "");
  const balDate = typeof r.balance_date === "string" ? normalizeDateBR(r.balance_date, fallback) : null;
  const periodStart = typeof r.period_start === "string" ? normalizeDateBR(r.period_start, fallback) : null;
  const periodEnd = typeof r.period_end === "string" ? normalizeDateBR(r.period_end, fallback) : null;
  const bank = typeof r.bank === "string" ? r.bank.slice(0, 80) : null;
  const anySet = opening != null || closing != null || balDate || periodStart || periodEnd || bank;
  if (!anySet) return null;
  return { opening_balance: opening, closing_balance: closing, balance_date: balDate, period_start: periodStart, period_end: periodEnd, bank };
}

function recoverCompactJson(text: string): { parsed: unknown; partial: boolean } | null {
  const arrayMarker = text.search(/"i"\s*:/);
  if (arrayMarker < 0) return null;
  const arrayStart = text.indexOf("[", arrayMarker);
  if (arrayStart < 0) return null;

  const rows: unknown[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let rowStart = -1;
  for (let i = arrayStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[") {
      if (depth === 0) rowStart = i;
      depth++;
      continue;
    }
    if (ch === "]") {
      if (depth > 0) depth--;
      if (depth === 0 && rowStart >= 0) {
        const rawRow = text.slice(rowStart, i + 1);
        try { rows.push(JSON.parse(rawRow)); } catch { /* ignore broken row */ }
        rowStart = -1;
        continue;
      }
      if (depth === 0 && rowStart < 0) break;
    }
  }
  if (rows.length === 0) return null;

  const kindMatch = text.match(/"k"\s*:\s*"([^"]+)"/);
  const noteMatch = text.match(/"n"\s*:\s*"([^"]*)"/);
  return {
    parsed: {
      k: kindMatch?.[1] ?? "statement",
      i: rows,
      n: noteMatch?.[1] ? `${noteMatch[1]} Extração parcial recuperada.` : "Extração parcial recuperada.",
    },
    partial: true,
  };
}

async function callMultimodal(
  publicBase64Url: string,
  mimeType: string,
  filename: string,
  guidance: string,
  signal: AbortSignal,
  batch: { index: number; max: number; exclude: string[] },
): Promise<MultimodalOutcome> {
  const start = Date.now();
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Data atual: ${new Date().toISOString().slice(0, 10)}. Orientação do usuário: ${guidance || "nenhuma"}.
Lote ${batch.index}/${batch.max}: extraia até ${BATCH_ITEMS_LIMIT} lançamentos ainda não extraídos, do mais recente ao mais antigo.
Não repita estes lançamentos já extraídos (data|valor|descrição): ${batch.exclude.length ? batch.exclude.join("; ") : "nenhum"}.
Se este for o lote 1, comece pelos lançamentos mais recentes do documento. Se for lote >1, continue com lançamentos mais antigos ou diferentes dos já listados.
Se não houver novos lançamentos, devolva {"k":"statement","i":[],"n":"sem novos lançamentos","more":false}.` },
              mimeType === "application/pdf"
                ? { type: "file", file: { filename: filename || "extrato.pdf", file_data: publicBase64Url } }
                : { type: "image_url", image_url: { url: publicBase64Url } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: BATCH_MAX_TOKENS,
      }),
      signal,
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      const body = await res.text();
      return { result: { document_kind: "unknown", items: [], notes: `gateway_error:${res.status}` }, statement: null, tokens_in: 0, tokens_out: 0, ms, has_more: false, partial: false, errorTag: `gateway:${res.status}:${body.slice(0, 160)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "{}";
    const tokens_in = data?.usage?.prompt_tokens ?? 0;
    const tokens_out = data?.usage?.completion_tokens ?? 0;
    let parsed: unknown;
    let partial = false;
    try {
      parsed = JSON.parse(text);
    } catch {
      const recovered = recoverCompactJson(text);
      if (!recovered) {
        return { result: { document_kind: "unknown", items: [], notes: "extraction_json" }, statement: null, tokens_in, tokens_out, ms, has_more: false, partial: false, errorTag: "extraction:invalid_json" };
      }
      parsed = recovered.parsed;
      partial = recovered.partial;
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      result: sanitize(parsed, today),
      statement: extractStatementMetadata(parsed, today),
      tokens_in,
      tokens_out,
      ms,
      has_more: (parsed as Record<string, unknown>)?.more === true,
      partial,
    };
  } catch (e) {
    const err = e as Error;
    const tag = err.name === "AbortError" ? "timeout:aborted" : `fetch_error:${err.message?.slice(0, 160) ?? "unknown"}`;
    return { result: { document_kind: "unknown", items: [], notes: "fetch_error" }, statement: null, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, has_more: false, partial: false, errorTag: tag };
  }
}


type DupeHit = { transaction_id: string; strength: "strong" | "ambiguous"; reason: string };

/**
 * Classifica cada item candidato contra transações existentes do usuário.
 * - Strong: mesmo fingerprint OU (mesmo tipo/data/valor E descrição normalizada casa OU mesma referência bancária).
 * - Ambiguous: mesmo tipo/data/valor mas descrição diferente (revisão manual necessária).
 */
async function classifyDuplicates(
  sb: ReturnType<typeof createClient>,
  user_id: string,
  items: Array<{ type: string; amount: number; occurred_at: string; normalized_description: string | null; bank_reference: string | null; fingerprint: string }>,
): Promise<Map<number, DupeHit>> {
  const map = new Map<number, DupeHit>();
  if (items.length === 0) return map;

  const fingerprints = [...new Set(items.map((it) => it.fingerprint).filter(Boolean))];
  const bankRefs = [...new Set(items.map((it) => it.bank_reference).filter((v): v is string => !!v))];
  const dates = [...new Set(items.map((it) => it.occurred_at))];
  const amounts = [...new Set(items.map((it) => it.amount))];

  const [fpRes, brRes, tdaRes] = await Promise.all([
    fingerprints.length > 0
      ? sb.from("transactions").select("id, dedupe_fingerprint").eq("user_id", user_id).in("dedupe_fingerprint", fingerprints)
      : Promise.resolve({ data: [] as Array<{ id: string; dedupe_fingerprint: string }> }),
    bankRefs.length > 0
      ? sb.from("transactions").select("id, bank_reference").eq("user_id", user_id).in("bank_reference", bankRefs)
      : Promise.resolve({ data: [] as Array<{ id: string; bank_reference: string }> }),
    // Sobre-conjunto candidato: mesmas datas e mesmos valores. Filtra em memória depois.
    sb.from("transactions").select("id, type, amount, occurred_at, description, raw_description")
      .eq("user_id", user_id).in("occurred_at", dates).in("amount", amounts).limit(500),
  ]);

  const fpIndex = new Map<string, string>();
  for (const row of (fpRes.data ?? [])) fpIndex.set(row.dedupe_fingerprint as string, row.id as string);
  const brIndex = new Map<string, string>();
  for (const row of (brRes.data ?? [])) brIndex.set(row.bank_reference as string, row.id as string);
  const tdaCandidates = (tdaRes.data ?? []) as Array<{ id: string; type: string; amount: number; occurred_at: string; description: string; raw_description: string | null }>;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const fpHit = fpIndex.get(it.fingerprint);
    if (fpHit) { map.set(i, { transaction_id: fpHit, strength: "strong", reason: "fingerprint" }); continue; }
    if (it.bank_reference) {
      const brHit = brIndex.get(it.bank_reference);
      if (brHit) { map.set(i, { transaction_id: brHit, strength: "strong", reason: "bank_reference" }); continue; }
    }
    const candidates = tdaCandidates.filter((c) => c.type === it.type && Number(c.amount) === Number(it.amount) && c.occurred_at === it.occurred_at);
    if (candidates.length === 0) continue;
    const target = (it.normalized_description ?? "").toLowerCase().trim();
    const strong = candidates.find((c) => {
      const n = normalizeDescription(String(c.raw_description ?? c.description ?? "")).friendly.toLowerCase().trim();
      return n && target && n === target;
    });
    map.set(i, {
      transaction_id: (strong?.id ?? candidates[0].id),
      strength: "ambiguous",
      reason: strong ? "type+date+amount+desc" : "type+date+amount",
    });
  }
  return map;
}

/**
 * Enriquecimento: descrição amigável (raw preservada), fingerprint, categoria por
 * regras determinísticas → histórico do usuário → hint do modelo. Sinaliza a fonte
 * da categoria para transparência no ReviewSheet.
 */
async function enrichItems(sb: ReturnType<typeof createClient>, userId: string, items: ExtractionResult["items"]) {
  // 1) Normalize itens primeiro (rápido, em memória) para saber quais descrições procurar no histórico.
  const normalized = items.map((item) => {
    const rawDesc = String(item.description ?? "");
    const { friendly, category_hint: ruleCategory } = normalizeDescription(rawDesc);
    return {
      item,
      rawDesc,
      friendly,
      normalizedKey: friendly.toLowerCase().trim(),
      ruleCategory,
      bankRef: extractBankReference(rawDesc),
    };
  });
  const uniqueDescriptions = [...new Set(normalized.map((n) => n.friendly).filter(Boolean))].slice(0, 200);

  // 2) Uma única leva de queries.
  const [{ data: categories }, { data: history }, { data: accounts }, { data: cards }] = await Promise.all([
    sb.from("categories").select("id, name, type").eq("user_id", userId),
    uniqueDescriptions.length > 0
      ? sb.from("transactions").select("description, raw_description, category_id, type")
          .eq("user_id", userId).not("category_id", "is", null)
          .in("description", uniqueDescriptions)
          .order("occurred_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Array<{ description: string; raw_description: string | null; category_id: string; type: string }> }),
    sb.from("accounts").select("id, name, institution").eq("user_id", userId).eq("active", true),
    sb.from("credit_cards").select("id, name").eq("user_id", userId).eq("active", true),
  ]);

  // 3) Índice de histórico por chave normalizada — normaliza cada linha do histórico UMA vez.
  const historyByKey = new Map<string, Map<string, number>>(); // key -> categoryId -> count
  for (const row of (history ?? [])) {
    const key = normalizeDescription(String(row.raw_description ?? row.description ?? "")).friendly.toLowerCase().trim();
    if (!key || !row.category_id) continue;
    const type = row.type;
    const compositeKey = `${type}|${key}`;
    let bucket = historyByKey.get(compositeKey);
    if (!bucket) { bucket = new Map(); historyByKey.set(compositeKey, bucket); }
    bucket.set(row.category_id, (bucket.get(row.category_id) ?? 0) + 1);
  }

  const catKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const enriched = [];
  for (const n of normalized) {
    const { item, rawDesc, friendly, normalizedKey, ruleCategory, bankRef } = n;
    const findCatByName = (name: string) => {
      const wanted = catKey(name);
      return (categories ?? []).find((c) =>
        (c.type === item.type || c.type === "both") &&
        (catKey(c.name) === wanted || catKey(c.name).includes(wanted) || wanted.includes(catKey(c.name)))
      )?.id ?? null;
    };

    let categoryId: string | null = null;
    let categorySource: string | null = null;
    let categoryConfidence: number | null = null;

    if (ruleCategory) {
      const c = findCatByName(ruleCategory);
      if (c) { categoryId = c; categorySource = "rule"; categoryConfidence = 0.9; }
    }
    if (!categoryId) {
      const bucket = historyByKey.get(`${item.type}|${normalizedKey}`);
      if (bucket) {
        const top = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top) { categoryId = top[0]; categorySource = "history"; categoryConfidence = Math.min(1, 0.5 + top[1] * 0.1); }
      }
    }
    if (!categoryId && item.category_hint) {
      const c = findCatByName(item.category_hint);
      if (c) { categoryId = c; categorySource = "hint"; categoryConfidence = 0.5; }
    }

    const accountHint = (item.account_hint ?? "").toLowerCase();
    const matchedAccount = accountHint ? (accounts ?? []).find((a) => `${a.name} ${a.institution ?? ""}`.toLowerCase().includes(accountHint) || accountHint.includes(a.name.toLowerCase())) : null;
    const cardHint = (item.card_hint ?? "").toLowerCase();
    const matchedCard = cardHint ? (cards ?? []).find((c) => c.name.toLowerCase().includes(cardHint) || cardHint.includes(c.name.toLowerCase())) : null;

    const account_id = matchedAccount?.id ?? null;
    const credit_card_id = matchedCard?.id ?? null;
    const fingerprint = await computeFingerprint({
      user_id: userId,
      type: item.type,
      occurred_at: item.occurred_at,
      amount: item.amount,
      account_id,
      credit_card_id,
      bank_reference: bankRef,
      normalized_description: friendly,
    });

    enriched.push({
      ...item,
      raw_description: rawDesc,
      normalized_description: friendly,
      description: friendly || rawDesc,
      bank_reference: bankRef,
      dedupe_fingerprint: fingerprint,
      category_id: categoryId,
      category_source: categorySource,
      category_confidence: categoryConfidence,
      account_id,
      credit_card_id,
    });
  }
  return enriched;
}

function userMessageFor(errorTag: string | null | undefined): string {
  if (!errorTag) return "Não consegui processar o documento agora. Tente novamente em instantes.";
  if (errorTag.startsWith("pdf_encrypted")) return "Esse PDF está protegido por senha. Remova a senha e envie novamente.";
  if (errorTag.startsWith("mime_mismatch")) return "O arquivo não é um PDF/imagem válido. Envie novamente.";
  if (errorTag.startsWith("size_exceeds")) return "Arquivo maior que o permitido (20 MB).";
  if (errorTag.startsWith("upload_missing")) return "Não achei o arquivo enviado. Reenvie, por favor.";
  if (errorTag.startsWith("download")) return "Tive dificuldade para ler o arquivo. Tente novamente.";
  if (errorTag.startsWith("timeout")) return "A extração demorou mais que o esperado. Tente novamente em instantes.";
  if (errorTag.startsWith("gateway")) return "O serviço de leitura instabilizou. Tente novamente em instantes.";
  if (errorTag.startsWith("fetch_error")) return "Falha de rede ao ler o documento. Tente novamente.";
  if (errorTag.startsWith("extraction")) return "O documento veio confuso. Envie uma versão mais nítida ou tente novamente.";
  if (errorTag.startsWith("items_insert")) return "Consegui ler, mas falhei ao gravar o rascunho. Tente novamente.";
  return "Não consegui processar o documento agora.";
}

function makeCorrelationId() {
  return crypto.randomUUID();
}

function encodeError(tag: string, correlationId: string) {
  // "tag|cid=<uuid>" — keeps existing prefix matchers working.
  return `${tag}|cid=${correlationId}`;
}

function parseErrorTag(err: string | null | undefined): { tag: string | null; correlation_id: string | null } {
  if (!err) return { tag: null, correlation_id: null };
  const m = err.match(/^(.*?)\|cid=([0-9a-f-]+)$/i);
  if (m) return { tag: m[1], correlation_id: m[2] };
  return { tag: err, correlation_id: null };
}

function itemSignature(item: ExtractionResult["items"][number]) {
  return `${item.occurred_at}|${Number(item.amount).toFixed(2)}|${item.description.toLowerCase().replace(/\s+/g, " ").trim()}`.slice(0, 180);
}

function emptyCounters() {
  return {
    total_items: 0,
    duplicate_strong: 0,
    duplicate_ambiguous: 0,
    categorized_auto: 0,
    needs_review: 0,
    uncategorized: 0,
    batches_completed: 0,
    partial: false,
  };
}

function pdfHasPasswordEncryption(bytes: Uint8Array): boolean {
  // Look for "/Encrypt" in the first 8KB and last 8KB of the PDF.
  const decoder = new TextDecoder("latin1");
  const headSlice = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  if (headSlice.includes("/Encrypt")) return true;
  if (bytes.length > 8192) {
    const tailSlice = decoder.decode(bytes.subarray(Math.max(0, bytes.length - 8192)));
    if (tailSlice.includes("/Encrypt")) return true;
  }
  return false;
}

const TERMINAL_STATUSES = new Set(["needs_review", "confirmed", "partially_confirmed", "canceled"]);
const TRANSIENT_ERROR_PREFIXES = ["gateway:", "fetch_error", "timeout:", "download:", "items_insert:", "extraction:"];

function isTransientErrorTag(tag: string | null): boolean {
  if (!tag) return false;
  return TRANSIENT_ERROR_PREFIXES.some((p) => tag.startsWith(p));
}

/**
 * Atomically transitions the document to `processing`. Returns true if this call
 * won the race and must run the heavy work; false if another worker already
 * owns it or the document is in a terminal state.
 */
async function acquireProcessingLock(sb: ReturnType<typeof createClient>, documentId: string, userId: string): Promise<{ acquired: boolean; doc: any | null }> {
  const { data: doc } = await sb.from("document_imports").select("*").eq("id", documentId).eq("user_id", userId).maybeSingle();
  if (!doc) return { acquired: false, doc: null };
  if (TERMINAL_STATUSES.has(doc.status)) return { acquired: false, doc };

  const now = Date.now();
  const updatedAt = doc.updated_at ? new Date(doc.updated_at).getTime() : 0;
  const stale = now - updatedAt > PROCESSING_STALE_MS;

  const prevErrTag = parseErrorTag(doc.error).tag;
  const canResume = doc.status === "uploaded"
    || (doc.status === "processing" && stale)
    || (doc.status === "failed" && isTransientErrorTag(prevErrTag));

  if (!canResume) return { acquired: false, doc };

  // Clear any orphaned draft items from a previous failed attempt.
  if (doc.status !== "uploaded") {
    await sb.from("extracted_items").delete().eq("document_id", documentId).eq("user_id", userId).in("status", ["needs_review", "duplicate_suspect"]);
  }

  const { data: updated, error: upErr } = await sb.from("document_imports")
    .update({ status: "processing", error: null })
    .eq("id", documentId)
    .eq("user_id", userId)
    .eq("status", doc.status) // optimistic lock on previous status
    .select("*")
    .maybeSingle();
  if (upErr || !updated) return { acquired: false, doc };
  return { acquired: true, doc: updated };
}

async function processDocument(documentId: string, userId: string, guidance: string, correlationId: string) {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const finish = async (patch: Record<string, unknown>) => {
    await sb.from("document_imports").update(patch).eq("id", documentId).eq("user_id", userId);
  };
  const heartbeat = async () => {
    await sb.from("document_imports").update({ updated_at: new Date().toISOString() })
      .eq("id", documentId).eq("user_id", userId).eq("status", "processing");
  };

  try {
    const { data: doc } = await sb.from("document_imports").select("*").eq("id", documentId).eq("user_id", userId).maybeSingle();
    if (!doc) return;

    const { data: fileBlob, error: dlErr } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr || !fileBlob) {
      await finish({ status: "failed", error: encodeError(`upload_missing:${dlErr?.message ?? "no_blob"}`, correlationId) });
      return;
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    if (bytes.length > MAX_BYTES) {
      await finish({ status: "failed", error: encodeError("size_exceeds:", correlationId) });
      return;
    }
    const magic = detectMime(bytes);
    if (!magic || magic !== doc.mime_type) {
      await finish({ status: "failed", error: encodeError(`mime_mismatch:${magic ?? "unknown"}`, correlationId) });
      return;
    }
    if (doc.mime_type === "application/pdf" && pdfHasPasswordEncryption(bytes)) {
      await finish({ status: "failed", error: encodeError("pdf_encrypted:", correlationId) });
      return;
    }
    const sha = await sha256Hex(bytes);

    // Não apague um novo job só porque o mesmo PDF já foi enviado. A versão
    // anterior pode ter falhado (caso real: timeout) e o cliente continuaria
    // consultando um document_id removido para sempre. A deduplicação correta é
    // feita por lançamento na revisão, preservando reenvio e reparação auditável.
    if (doc.sha256 !== sha) {
      await sb.from("document_imports").update({ sha256: sha }).eq("id", documentId).eq("user_id", userId);
    }

    if (!LOVABLE_API_KEY) {
      await finish({ status: "failed", error: encodeError("gateway:no_api_key", correlationId) });
      return;
    }

    // Base64 in chunks (avoid stack overflow on large binaries).
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]);
    }
    const b64 = btoa(bin);
    const dataUrl = `data:${doc.mime_type};base64,${b64}`;

    let documentKind: ExtractionResult["document_kind"] = "unknown";
    let statement: StatementMetadata | null = null;
    let tokens_in = 0, tokens_out = 0, ms = 0;
    let lastErrorTag: string | undefined;
    const notes: string[] = [];
    const counters = emptyCounters();
    const seenSignatures = new Set<string>();
    const seenInDocument = new Map<string, number>();
    let idxOffset = 0;
    const maxBatches = doc.mime_type === "application/pdf" ? PDF_BATCHES : IMAGE_BATCHES;

    for (let batchIndex = 1; batchIndex <= maxBatches && counters.total_items < MAX_ITEMS_PER_DOCUMENT; batchIndex++) {
      await heartbeat();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), EXTRACTION_TIMEOUT_MS);
      const beat = setInterval(() => { void heartbeat(); }, 20_000);
      let out: MultimodalOutcome;
      try {
        out = await callMultimodal(
          dataUrl,
          doc.mime_type,
          doc.storage_path?.split("/").pop() ?? "documento",
          (guidance ?? "").slice(0, 500),
          ac.signal,
          { index: batchIndex, max: maxBatches, exclude: [...seenSignatures].slice(-90) },
        );
      } finally {
        clearTimeout(timer);
        clearInterval(beat);
      }
      await heartbeat();

      tokens_in += out.tokens_in;
      tokens_out += out.tokens_out;
      ms += out.ms;
      counters.batches_completed = batchIndex;
      counters.partial = counters.partial || out.partial;
      if (out.result.notes) notes.push(`Lote ${batchIndex}: ${out.result.notes}`);
      if (out.statement && !statement) statement = out.statement;
      if (out.result.document_kind !== "unknown") documentKind = out.result.document_kind;

      let extraction = out.result;
      if (/\b(hoje|de hoje|foram hoje|s[ãa]o de hoje)\b/i.test(guidance ?? "")) {
        const today = new Date().toISOString().slice(0, 10);
        extraction = { ...extraction, items: extraction.items.map((item) => ({ ...item, occurred_at: today })) };
      }

      if (out.errorTag) {
        lastErrorTag = out.errorTag;
        if (counters.total_items > 0) break;
        await finish({ status: "failed", model: MODEL, tokens_in, tokens_out, extraction_ms: ms, counters, error: encodeError(out.errorTag, correlationId) });
        return;
      }

      if ((extraction.document_kind === "illegible" || extraction.document_kind === "non_financial") && counters.total_items === 0 && extraction.items.length === 0) {
        await finish({
          status: "needs_review",
          document_kind: extraction.document_kind,
          model: MODEL,
          tokens_in,
          tokens_out,
          extraction_ms: ms,
          counters,
          error: null,
        });
        return;
      }

      const remaining = MAX_ITEMS_PER_DOCUMENT - counters.total_items;
      const freshItems = extraction.items
        .filter((item) => {
          const sig = itemSignature(item);
          if (seenSignatures.has(sig)) return false;
          seenSignatures.add(sig);
          return true;
        })
        .slice(0, Math.min(BATCH_ITEMS_LIMIT, remaining));

      if (freshItems.length > 0) {
        const enriched = await enrichItems(sb, userId, freshItems);
        const dupes = await classifyDuplicates(sb, userId, enriched.map((it) => ({
          type: it.type,
          amount: Number(it.amount),
          occurred_at: it.occurred_at,
          normalized_description: it.normalized_description ?? null,
          bank_reference: it.bank_reference ?? null,
          fingerprint: it.dedupe_fingerprint,
        })));

        let batchCategorized = 0;
        let batchDupStrong = 0;
        let batchDupAmbiguous = 0;
        const rows = enriched.map((it, idx) => {
          const globalIdx = idxOffset + idx;
          const hit = dupes.get(idx);
          const localKey = `${it.type}|${it.occurred_at}|${Number(it.amount).toFixed(2)}|${it.normalized_description ?? ""}`;
          const priorIdx = seenInDocument.get(localKey);
          seenInDocument.set(localKey, globalIdx);
          const localDuplicate = priorIdx == null ? null : { strength: "ambiguous" as const, reason: `same_document:${priorIdx}` };
          const effectiveHit = hit ?? localDuplicate;
          if (effectiveHit?.strength === "strong") batchDupStrong++;
          else if (effectiveHit?.strength === "ambiguous") batchDupAmbiguous++;
          if (it.category_id) batchCategorized++;
          return {
            document_id: documentId,
            user_id: userId,
            idx: globalIdx,
            type: it.type,
            amount: it.amount,
            occurred_at: it.occurred_at,
            description: it.description,
            raw_description: it.raw_description,
            normalized_description: it.normalized_description,
            bank_reference: it.bank_reference,
            dedupe_fingerprint: it.dedupe_fingerprint,
            payment_method: it.payment_method,
            account_hint: it.account_hint,
            card_hint: it.card_hint,
            category_hint: it.category_hint,
            category_id: it.category_id,
            category_source: it.category_source,
            category_confidence: it.category_confidence,
            movement_kind: it.movement_kind ?? "transaction",
            account_id: it.account_id,
            credit_card_id: it.credit_card_id,
            installments_total: it.installments_total,
            installment_number: it.installment_number,
            purchase_date: it.purchase_date,
            competence_date: it.competence_date,
            confidence: it.confidence,
            raw: it as unknown as Record<string, unknown>,
            status: effectiveHit ? "duplicate_suspect" : "needs_review",
            duplicate_of: hit?.transaction_id ?? null,
            duplicate_reason: effectiveHit ? `${effectiveHit.strength}:${effectiveHit.reason}` : null,
          };
        });

        const { error: itemsErr } = await sb.from("extracted_items").insert(rows);
        if (itemsErr) {
          await finish({ status: "failed", model: MODEL, tokens_in, tokens_out, extraction_ms: ms, counters, error: encodeError(`items_insert:${itemsErr.message}`, correlationId) });
          return;
        }

        idxOffset += rows.length;
        counters.total_items += rows.length;
        counters.duplicate_strong += batchDupStrong;
        counters.duplicate_ambiguous += batchDupAmbiguous;
        counters.categorized_auto += batchCategorized;
        counters.uncategorized += rows.length - batchCategorized;
        counters.needs_review = counters.total_items - counters.duplicate_strong - counters.duplicate_ambiguous;

        await finish({
          status: "processing",
          document_kind: documentKind,
          model: MODEL,
          tokens_in,
          tokens_out,
          extraction_ms: ms,
          counters,
          error: null,
        });
      }

      if (!out.has_more && freshItems.length < BATCH_ITEMS_LIMIT) break;
      if (freshItems.length === 0 && batchIndex > 1) break;
    }

    await finish({
      status: "needs_review",
      document_kind: documentKind,
      model: MODEL,
      tokens_in,
      tokens_out,
      extraction_ms: ms,
      user_instructions: (guidance ?? "").slice(0, 2000) || null,
      statement_opening_balance: statement?.opening_balance ?? null,
      statement_closing_balance: statement?.closing_balance ?? null,
      statement_balance_date: statement?.balance_date ?? null,
      period_start: statement?.period_start ?? null,
      period_end: statement?.period_end ?? null,
      statement_bank: statement?.bank ?? null,
      counters: { ...counters, notes: notes.slice(0, 6), stopped_after_error: lastErrorTag ?? null },
      error: null,
    });
  } catch (e) {
    console.error(`[assistant-ingest cid=${correlationId}] processDocument crashed`, e);
    await finish({ status: "failed", error: encodeError(`fetch_error:${(e as Error).message?.slice(0, 160) ?? "unknown"}`, correlationId) });
  }
}

async function respondWithStatus(sb: ReturnType<typeof createClient>, documentId: string, userId: string, extra: Record<string, unknown> = {}, status = 200) {
  const { data: doc } = await sb.from("document_imports").select("*").eq("id", documentId).eq("user_id", userId).maybeSingle();
  if (!doc) return json({ error: "not_found" }, 404);
  const { tag, correlation_id } = parseErrorTag(doc.error);
  const { data: items } = doc.status === "needs_review"
    ? await sb.from("extracted_items").select("id").eq("document_id", documentId).eq("user_id", userId)
    : { data: [] as { id: string }[] };
  return json({
    ok: true,
    status: doc.status,
    document_id: documentId,
    document_kind: doc.document_kind ?? null,
    items_count: (items ?? []).length,
    error: tag,
    correlation_id,
    user_message: tag ? userMessageFor(tag) : null,
    ...extra,
  }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const mode = String(body.mode ?? "");

  // === CREATE UPLOAD ===
  if (mode === "create-upload") {
    const filename = String(body.filename ?? "upload");
    const mime_type = String(body.mime_type ?? "");
    const size_bytes = Number(body.size_bytes ?? 0);
    const conversation_id = (body.conversation_id as string | undefined) ?? null;

    if (!ALLOWED_MIME.has(mime_type)) return json({ error: "mime_not_allowed", allowed: [...ALLOWED_MIME] }, 400);
    if (!Number.isFinite(size_bytes) || size_bytes <= 0 || size_bytes > MAX_BYTES) return json({ error: "size_out_of_range", max: MAX_BYTES }, 400);

    const doc_id = crypto.randomUUID();
    const ext = mime_type === "application/pdf" ? "pdf" : mime_type === "image/png" ? "png" : mime_type === "image/webp" ? "webp" : "jpg";
    const storage_path = `${user.id}/${doc_id}.${ext}`;

    const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUploadUrl(storage_path);
    if (signErr || !signed) return json({ error: "signed_url_failed", details: signErr?.message }, 500);

    const { error: insErr } = await sb.from("document_imports").insert({
      id: doc_id,
      user_id: user.id,
      source: "app",
      storage_path,
      mime_type,
      size_bytes,
      sha256: `pending:${doc_id}`,
      status: "uploaded",
      conversation_id,
      user_instructions: String(body.guidance ?? "").trim().slice(0, 2000) || null,
    });
    if (insErr) return json({ error: "insert_failed", details: insErr.message }, 500);

    // O envio de documento também é uma mensagem da conversa. Persista após o
    // job existir, para que fechar/reabrir o painel nunca apague essa interação.
    if (conversation_id) {
      const guidance = String(body.guidance ?? "").trim();
      const persistedText = `${guidance || "Analise este documento financeiro."}\n📎 ${filename}`.slice(0, 2000);
      const { data: persisted } = await sb.from("conversation_messages").insert({
        conversation_id,
        user_id: user.id,
        direction: "inbound",
        body_masked: persistedText,
      }).select("id").maybeSingle();
      if (persisted?.id) {
        await sb.from("document_imports").update({ message_id: persisted.id })
          .eq("id", doc_id).eq("user_id", user.id);
      }
      await sb.from("conversations").update({ last_message_at: new Date().toISOString() })
        .eq("id", conversation_id).eq("user_id", user.id);
    }

    return json({ ok: true, document_id: doc_id, upload_url: signed.signedUrl, storage_path, token: signed.token, filename });
  }

  // === VERIFY UPLOAD ===
  // Server-side check that the signed upload actually persisted the object.
  // No side effects: purely diagnostic.
  if (mode === "verify-upload") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const { data: doc } = await sb.from("document_imports")
      .select("id, storage_path, user_id")
      .eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return json({ error: "not_found" }, 404);
    const dir = doc.storage_path.split("/").slice(0, -1).join("/");
    const name = doc.storage_path.split("/").pop() ?? "";
    const { data: list, error: listErr } = await sb.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
    if (listErr) return json({ ok: true, exists: false, size: 0, error: listErr.message });
    const found = (list ?? []).find((entry) => entry.name === name);
    // metadata.size is available on Supabase Storage list responses.
    // deno-lint-ignore no-explicit-any
    const size = Number((found as any)?.metadata?.size ?? 0);
    return json({ ok: true, exists: !!found && size > 0, size });
  }

  // === MARK UPLOAD MISSING ===
  // Client failed to persist the object even after fallback; record it so the
  // document doesn't stay orphaned in `uploaded`. Never triggers IA.
  if (mode === "mark-upload-missing") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const correlationId = makeCorrelationId();
    const { data: doc } = await sb.from("document_imports")
      .select("id, status").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return json({ error: "not_found" }, 404);
    if (TERMINAL_STATUSES.has(doc.status)) {
      return respondWithStatus(sb, document_id, user.id, {}, 200);
    }
    await sb.from("document_imports")
      .update({ status: "failed", error: encodeError("upload_missing:client_reported", correlationId) })
      .eq("id", document_id).eq("user_id", user.id);
    return json({
      ok: true,
      status: "failed",
      document_id,
      error: "upload_missing",
      correlation_id: correlationId,
      user_message: "Não consegui salvar o arquivo. Verifique sua conexão e tente novamente.",
    }, 200);
  }

  // === FINALIZE / RESUME / REPROCESS AFTER AUDITED ROLLBACK ===
  if (mode === "finalize" || mode === "resume" || mode === "reprocess") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    let guidance = String(body.guidance ?? "");
    if (mode === "reprocess") {
      const { data: prior } = await sb.from("document_imports").select("status,user_instructions,error")
        .eq("id", document_id).eq("user_id", user.id).maybeSingle();
      const priorTag = parseErrorTag((prior as { error?: string } | null)?.error).tag;
      const retryableFailure = prior?.status === "failed" && isTransientErrorTag(priorTag);
      if (!prior || (prior.status !== "rolled_back" && !retryableFailure)) {
        return json({ error: "reprocess_not_allowed", user_message: "Só é possível reprocessar uma importação desfeita ou uma falha temporária." }, 409);
      }
      guidance = guidance || String(prior.user_instructions ?? "");
      await sb.from("extracted_items").delete().eq("document_id", document_id).eq("user_id", user.id)
        .in("status", ["rolled_back","ignored","rejected","failed","duplicate_suspect","needs_review"]);
      await sb.from("document_imports").update({ status: "uploaded", error: null }).eq("id", document_id).eq("user_id", user.id);
    }

    const { acquired, doc } = await acquireProcessingLock(sb, document_id, user.id);
    if (!doc) return json({ error: "not_found" }, 404);

    if (!acquired) {
      // Already terminal, or another worker owns it. Just report current state.
      return respondWithStatus(sb, document_id, user.id, {}, 200);
    }

    const correlationId = makeCorrelationId();
    console.log(`[assistant-ingest cid=${correlationId}] dispatch document=${document_id} user=${user.id} mode=${mode}`);
    const work = processDocument(document_id, user.id, guidance, correlationId);
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      EdgeRuntime.waitUntil(work);
    } else {
      // Fallback (tests / local): fire-and-forget with catch to avoid unhandled rejection.
      work.catch((err) => console.error(`[assistant-ingest cid=${correlationId}] background`, err));
    }

    return json({
      ok: true,
      status: "processing",
      document_id,
      correlation_id: correlationId,
      user_message: "Estou lendo esse documento. Já te aviso.",
    }, 202);
  }

  // === STATUS ===
  if (mode === "status") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const { data: doc } = await sb.from("document_imports").select("*").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return json({ error: "not_found" }, 404);
    const { data: items } = await sb.from("extracted_items").select("*").eq("document_id", document_id).eq("user_id", user.id).order("idx");
    const { tag, correlation_id } = parseErrorTag(doc.error);
    return json({
      ok: true,
      document: doc,
      status: doc.status,
      document_id,
      document_kind: doc.document_kind ?? null,
      items: items ?? [],
      items_count: (items ?? []).length,
      error: tag,
      correlation_id,
      user_message: tag ? userMessageFor(tag) : null,
    });
  }

  return json({ error: "unknown_mode" }, 400);
});
