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
const PROCESSING_STALE_MS = 3 * 60 * 1000;

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

Analise o documento enviado (PDF, recibo, fatura, extrato, print de compra ou lista) e devolva JSON puro no formato:
{
  "document_kind": "receipt|invoice|statement|list|non_financial|illegible",
  "items": [
    {
      "type": "expense|income",
      "description": "texto literal da linha",
      "amount": 123.45,
      "occurred_at": "YYYY-MM-DD",
      "payment_method": "account|credit_card|null",
      "account_hint": "Nubank Conta|Itaú|null",
      "card_hint": "Nubank Cartão|Inter Mastercard|null",
      "category_hint": "Alimentação|Transporte|null",
      "movement_kind": "transaction|refund|internal_transfer|investment_application|investment_redemption|informational",
      "installments_total": null,
      "installment_number": null,
      "purchase_date": null,
      "competence_date": null,
      "confidence": {"amount":0.9,"occurred_at":0.7}
    }
  ],
  "notes": "por que descartei linhas de saldo, limite ou pagamento de fatura"
}

REGRAS ESTRITAS:
- Valores em real brasileiro: aceite formatos 1.234,56 e 1234.56.
- Datas em português brasileiro dd/mm/aaaa OU ISO YYYY-MM-DD.
- A data atual é informada na mensagem do usuário. Se a linha não tiver data completa, use a data atual.
- Nunca invente ano. Data parcial (apenas hora, dia/mês ou dia da semana) usa o ano da data atual.
- Elementos da interface do celular e datas de referência do extrato não são, por si só, a data da compra.
- Nunca invente texto ilegível — melhor devolver items=[] e document_kind=illegible.
- Se for imagem não financeira (meme, foto, screenshot de conversa sem valores), devolva document_kind=non_financial e items=[].
- EXCLUA todas as linhas informativas: SALDO DO DIA, saldo atual/em conta/anterior/disponível/total, limites, cabeçalhos, período, emissão, subtotais e totais.
- RESGATE CDB é resgate de investimento, não receita. Aplicação é investimento, não despesa.
- PIX entre contas da mesma pessoa é transferência interna, não receita/despesa. Se não houver certeza, marque internal_transfer e explique em notes.
- Estorno/reembolso (incluindo descrições iniciadas por EST) é refund/income, nunca nova renda recorrente.
- Preserve a descrição literal; não use "crédito" ou "débito" como descrição.
- Além dos items, devolva no topo do JSON um bloco opcional "statement_metadata": {"opening_balance":number|null, "closing_balance":number|null, "balance_date":"YYYY-MM-DD"|null, "period_start":"YYYY-MM-DD"|null, "period_end":"YYYY-MM-DD"|null, "bank":string|null}. Extraia esses campos APENAS de linhas informativas do extrato ("Saldo do dia", "Saldo final", "Saldo anterior"). Nunca vire transação.
- Só devolva JSON, sem markdown, sem comentários fora do campo notes.`;

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
  errorTag?: string;
};

function extractStatementMetadata(parsed: unknown, fallback: string): StatementMetadata | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as Record<string, unknown>)["statement_metadata"];
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

async function callMultimodal(publicBase64Url: string, mimeType: string, filename: string, guidance: string, signal: AbortSignal): Promise<MultimodalOutcome> {
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
              { type: "text", text: `Data atual: ${new Date().toISOString().slice(0, 10)}. Orientação do usuário: ${guidance || "nenhuma"}. Extraia lançamentos do documento inteiro em JSON estrito.` },
              mimeType === "application/pdf"
                ? { type: "file", file: { filename: filename || "extrato.pdf", file_data: publicBase64Url } }
                : { type: "image_url", image_url: { url: publicBase64Url } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
      signal,
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      const body = await res.text();
      return { result: { document_kind: "unknown", items: [], notes: `gateway_error:${res.status}` }, statement: null, tokens_in: 0, tokens_out: 0, ms, errorTag: `gateway:${res.status}:${body.slice(0, 160)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "{}";
    const tokens_in = data?.usage?.prompt_tokens ?? 0;
    const tokens_out = data?.usage?.completion_tokens ?? 0;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { result: { document_kind: "unknown", items: [], notes: "extraction_json" }, statement: null, tokens_in, tokens_out, ms, errorTag: "extraction:invalid_json" }; }
    const today = new Date().toISOString().slice(0, 10);
    return { result: sanitize(parsed, today), statement: extractStatementMetadata(parsed, today), tokens_in, tokens_out, ms };
  } catch (e) {
    const err = e as Error;
    const tag = err.name === "AbortError" ? "timeout:aborted" : `fetch_error:${err.message?.slice(0, 160) ?? "unknown"}`;
    return { result: { document_kind: "unknown", items: [], notes: "fetch_error" }, statement: null, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, errorTag: tag };
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
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // 1) forte por fingerprint (chave única)
    const { data: fpMatch } = await sb.from("transactions")
      .select("id").eq("user_id", user_id).eq("dedupe_fingerprint", it.fingerprint).limit(1);
    if (fpMatch && fpMatch.length > 0) {
      map.set(i, { transaction_id: fpMatch[0].id as string, strength: "strong", reason: "fingerprint" });
      continue;
    }
    // 2) forte por bank_reference se disponível
    if (it.bank_reference) {
      const { data: brMatch } = await sb.from("transactions")
        .select("id").eq("user_id", user_id).eq("bank_reference", it.bank_reference).limit(1);
      if (brMatch && brMatch.length > 0) {
        map.set(i, { transaction_id: brMatch[0].id as string, strength: "strong", reason: "bank_reference" });
        continue;
      }
    }
    // 3) mesmo tipo/data/valor → strong se descrição normalizada casa, ambiguous senão
    const { data: candidates } = await sb.from("transactions")
      .select("id, description, raw_description")
      .eq("user_id", user_id).eq("type", it.type).eq("amount", it.amount).eq("occurred_at", it.occurred_at)
      .limit(20);
    if (!candidates || candidates.length === 0) continue;
    const target = (it.normalized_description ?? "").toLowerCase().trim();
    const strong = candidates.find((c) => {
      const n = normalizeDescription(String(c.raw_description ?? c.description ?? "")).friendly.toLowerCase().trim();
      return n && target && n === target;
    });
    // Sem identificador bancário, até uma descrição igual pode representar duas
    // compras reais no mesmo dia. Trate como ambígua e peça decisão humana.
    map.set(i, {
      transaction_id: (strong?.id ?? candidates[0].id) as string,
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
  const [{ data: categories }, { data: history }, { data: accounts }, { data: cards }] = await Promise.all([
    sb.from("categories").select("id, name, type").eq("user_id", userId),
    sb.from("transactions").select("description, raw_description, category_id, type").eq("user_id", userId).not("category_id", "is", null).order("occurred_at", { ascending: false }).limit(1000),
    sb.from("accounts").select("id, name, institution").eq("user_id", userId).eq("active", true),
    sb.from("credit_cards").select("id, name").eq("user_id", userId).eq("active", true),
  ]);
  const enriched = [];
  for (const item of items) {
    const rawDesc = String(item.description ?? "");
    const { friendly, category_hint: ruleCategory } = normalizeDescription(rawDesc);
    const normalizedKey = friendly.toLowerCase().trim();
    const bankRef = extractBankReference(rawDesc);

    // Categoria: regra > histórico > hint do modelo
    let categoryId: string | null = null;
    let categorySource: string | null = null;
    let categoryConfidence: number | null = null;
    const catKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const findCatByName = (name: string) => {
      const wanted = catKey(name);
      return (categories ?? []).find((c) =>
        (c.type === item.type || c.type === "both") &&
        (catKey(c.name) === wanted || catKey(c.name).includes(wanted) || wanted.includes(catKey(c.name)))
      )?.id ?? null;
    };
    if (ruleCategory) {
      const c = findCatByName(ruleCategory);
      if (c) { categoryId = c; categorySource = "rule"; categoryConfidence = 0.9; }
    }
    if (!categoryId) {
      const historicalHits = (history ?? []).filter((row) => row.type === item.type && normalizeDescription(String(row.raw_description ?? row.description ?? "")).friendly.toLowerCase().trim() === normalizedKey && row.category_id);
      const counts = new Map<string, number>();
      historicalHits.forEach((r) => counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) { categoryId = top[0]; categorySource = "history"; categoryConfidence = Math.min(1, 0.5 + top[1] * 0.1); }
    }
    if (!categoryId && item.category_hint) {
      const c = findCatByName(item.category_hint);
      if (c) { categoryId = c; categorySource = "hint"; categoryConfidence = 0.5; }
    }

    // Contas/cartões
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

    // Dedup by (user_id, sha256): reuse prior doc if exists.
    const { data: existing } = await sb.from("document_imports").select("id, status").eq("user_id", userId).eq("sha256", sha).neq("id", documentId).maybeSingle();
    if (existing?.id) {
      await sb.storage.from(BUCKET).remove([doc.storage_path]).catch(() => undefined);
      await sb.from("document_imports").delete().eq("id", documentId).eq("user_id", userId);
      return;
    }
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

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    let extraction: ExtractionResult;
    let statement: StatementMetadata | null = null;
    let tokens_in = 0, tokens_out = 0, ms = 0;
    let errorTag: string | undefined;
    try {
      const out = await callMultimodal(dataUrl, doc.mime_type, doc.storage_path?.split("/").pop() ?? "documento", (guidance ?? "").slice(0, 500), ac.signal);
      extraction = out.result;
      statement = out.statement;
      tokens_in = out.tokens_in;
      tokens_out = out.tokens_out;
      ms = out.ms;
      errorTag = out.errorTag;
      if (/\b(hoje|de hoje|foram hoje|s[ãa]o de hoje)\b/i.test(guidance ?? "")) {
        const today = new Date().toISOString().slice(0, 10);
        extraction = { ...extraction, items: extraction.items.map((item) => ({ ...item, occurred_at: today })) };
      }
    } finally {
      clearTimeout(timer);
    }

    if (errorTag) {
      await finish({ status: "failed", model: MODEL, tokens_in, tokens_out, extraction_ms: ms, error: encodeError(errorTag, correlationId) });
      return;
    }

    if (extraction.document_kind === "illegible" || extraction.document_kind === "non_financial") {
      await finish({
        status: "needs_review",
        document_kind: extraction.document_kind,
        model: MODEL,
        tokens_in,
        tokens_out,
        extraction_ms: ms,
        error: null,
      });
      return;
    }

    const enriched = await enrichItems(sb, userId, extraction.items);
    const dupes = await classifyDuplicates(sb, userId, enriched.map((it) => ({
      type: it.type,
      amount: Number(it.amount),
      occurred_at: it.occurred_at,
      normalized_description: it.normalized_description ?? null,
      bank_reference: it.bank_reference ?? null,
      fingerprint: it.dedupe_fingerprint,
    })));
    let categorizedAuto = 0;
    let dupStrong = 0;
    let dupAmbiguous = 0;
    // Duplicatas dentro do próprio arquivo são ambíguas, nunca descartadas de
    // forma automática: extratos podem conter duas compras legítimas idênticas.
    const seenInDocument = new Map<string, number>();
    const rows = enriched.map((it, idx) => {
      const hit = dupes.get(idx);
      const localKey = `${it.type}|${it.occurred_at}|${Number(it.amount).toFixed(2)}|${it.normalized_description ?? ""}`;
      const priorIdx = seenInDocument.get(localKey);
      seenInDocument.set(localKey, idx);
      const localDuplicate = priorIdx == null ? null : { strength: "ambiguous" as const, reason: `same_document:${priorIdx}` };
      const effectiveHit = hit ?? localDuplicate;
      if (effectiveHit?.strength === "strong") dupStrong++;
      else if (effectiveHit?.strength === "ambiguous") dupAmbiguous++;
      if (it.category_id) categorizedAuto++;
      return {
        document_id: documentId,
        user_id: userId,
        idx,
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
    if (rows.length > 0) {
      const { error: itemsErr } = await sb.from("extracted_items").insert(rows);
      if (itemsErr) {
        await finish({ status: "failed", model: MODEL, tokens_in, tokens_out, extraction_ms: ms, error: encodeError(`items_insert:${itemsErr.message}`, correlationId) });
        return;
      }
    }

    const needsReview = rows.length - dupStrong - dupAmbiguous;
    const counters = {
      total_items: rows.length,
      duplicate_strong: dupStrong,
      duplicate_ambiguous: dupAmbiguous,
      categorized_auto: categorizedAuto,
      needs_review: needsReview,
      uncategorized: rows.length - categorizedAuto,
    };

    await finish({
      status: "needs_review",
      document_kind: extraction.document_kind,
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
      counters,
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
    });
    if (insErr) return json({ error: "insert_failed", details: insErr.message }, 500);

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
      const { data: prior } = await sb.from("document_imports").select("status,user_instructions")
        .eq("id", document_id).eq("user_id", user.id).maybeSingle();
      if (!prior || prior.status !== "rolled_back") return json({ error: "rollback_required" }, 409);
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
