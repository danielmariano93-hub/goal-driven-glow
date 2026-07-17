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
import { ALLOWED_MIME, MAX_BYTES, detectMime, sha256Hex, sanitize, type ExtractionResult } from "../_shared/documents/types.ts";

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
- Só devolva JSON, sem markdown, sem comentários fora do campo notes.`;

type MultimodalOutcome = {
  result: ExtractionResult;
  tokens_in: number;
  tokens_out: number;
  ms: number;
  errorTag?: string;
};

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
      return { result: { document_kind: "unknown", items: [], notes: `gateway_error:${res.status}` }, tokens_in: 0, tokens_out: 0, ms, errorTag: `gateway:${res.status}:${body.slice(0, 160)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "{}";
    const tokens_in = data?.usage?.prompt_tokens ?? 0;
    const tokens_out = data?.usage?.completion_tokens ?? 0;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { result: { document_kind: "unknown", items: [], notes: "extraction_json" }, tokens_in, tokens_out, ms, errorTag: "extraction:invalid_json" }; }
    const today = new Date().toISOString().slice(0, 10);
    return { result: sanitize(parsed, today), tokens_in, tokens_out, ms };
  } catch (e) {
    const err = e as Error;
    const tag = err.name === "AbortError" ? "timeout:aborted" : `fetch_error:${err.message?.slice(0, 160) ?? "unknown"}`;
    return { result: { document_kind: "unknown", items: [], notes: "fetch_error" }, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, errorTag: tag };
  }
}

function normalizedMerchant(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/^(on|pay|electron|pix\s+(whats(?:\s+qrcode)?|transf))\s+/i, "")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

async function findDuplicates(sb: ReturnType<typeof createClient>, user_id: string, items: { amount: number; occurred_at: string; description: string | null; payment_method?: string | null }[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const { data } = await sb.from("transactions")
      .select("id, description, payment_method")
      .eq("user_id", user_id)
      .eq("amount", it.amount)
      .eq("occurred_at", it.occurred_at)
      .limit(20);
    const match = (data ?? []).find((candidate) => normalizedMerchant(candidate.description) === normalizedMerchant(it.description)
      && (!it.payment_method || !candidate.payment_method || candidate.payment_method === it.payment_method));
    if (match?.id) map.set(i, match.id as string);
  }
  return map;
}

async function enrichItems(sb: ReturnType<typeof createClient>, userId: string, items: ExtractionResult["items"]) {
  const [{ data: categories }, { data: history }, { data: accounts }, { data: cards }] = await Promise.all([
    sb.from("categories").select("id, name, type").eq("user_id", userId),
    sb.from("transactions").select("description, category_id, type").eq("user_id", userId).not("category_id", "is", null).order("occurred_at", { ascending: false }).limit(1000),
    sb.from("accounts").select("id, name, institution").eq("user_id", userId).eq("active", true),
    sb.from("credit_cards").select("id, name").eq("user_id", userId).eq("active", true),
  ]);
  return items.map((item) => {
    const merchant = normalizedMerchant(item.description);
    const historical = (history ?? []).filter((row) => row.type === item.type && normalizedMerchant(row.description) === merchant && row.category_id);
    const counts = new Map<string, number>();
    historical.forEach((row) => counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1));
    const learnedCategory = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const hint = normalizedMerchant(item.category_hint);
    const hintedCategory = (categories ?? []).find((category) => category.type === item.type && normalizedMerchant(category.name) === hint)?.id ?? null;
    const accountHint = normalizedMerchant(item.account_hint);
    const matchedAccount = accountHint ? (accounts ?? []).find((account) => normalizedMerchant(`${account.name} ${account.institution ?? ""}`).includes(accountHint) || accountHint.includes(normalizedMerchant(account.name))) : null;
    const cardHint = normalizedMerchant(item.card_hint);
    const matchedCard = cardHint ? (cards ?? []).find((card) => normalizedMerchant(card.name).includes(cardHint) || cardHint.includes(normalizedMerchant(card.name))) : null;
    return { ...item, category_id: learnedCategory ?? hintedCategory, account_id: matchedAccount?.id ?? null, credit_card_id: matchedCard?.id ?? null, merchant_key: merchant };
  });
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
    let tokens_in = 0, tokens_out = 0, ms = 0;
    let errorTag: string | undefined;
    try {
      const out = await callMultimodal(dataUrl, doc.mime_type, doc.storage_path?.split("/").pop() ?? "documento", (guidance ?? "").slice(0, 500), ac.signal);
      extraction = out.result;
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
    const dupes = await findDuplicates(sb, userId, enriched);
    const rows = enriched.map((it, idx) => ({
      document_id: documentId,
      user_id: userId,
      idx,
      type: it.type,
      amount: it.amount,
      occurred_at: it.occurred_at,
      description: it.description,
      payment_method: it.payment_method,
      account_hint: it.account_hint,
      card_hint: it.card_hint,
      category_hint: it.category_hint,
      category_id: it.category_id,
      account_id: it.account_id,
      credit_card_id: it.credit_card_id,
      installments_total: it.installments_total,
      installment_number: it.installment_number,
      purchase_date: it.purchase_date,
      competence_date: it.competence_date,
      confidence: it.confidence,
      raw: it as unknown as Record<string, unknown>,
      status: dupes.has(idx) ? "duplicate_suspect" : "needs_review",
      duplicate_of: dupes.get(idx) ?? null,
    }));
    if (rows.length > 0) {
      const { error: itemsErr } = await sb.from("extracted_items").insert(rows);
      if (itemsErr) {
        await finish({ status: "failed", model: MODEL, tokens_in, tokens_out, extraction_ms: ms, error: encodeError(`items_insert:${itemsErr.message}`, correlationId) });
        return;
      }
    }

    await finish({
      status: "needs_review",
      document_kind: extraction.document_kind,
      model: MODEL,
      tokens_in,
      tokens_out,
      extraction_ms: ms,
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

  // === FINALIZE / RESUME ===
  if (mode === "finalize" || mode === "resume") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const guidance = String(body.guidance ?? "");

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
