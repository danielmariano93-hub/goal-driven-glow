// Edge Function: assistant-ingest-document
// Modes:
//   POST { mode:'create-upload', filename, mime_type, size_bytes, conversation_id? }
//     -> { document_id, upload_url, storage_path }
//   POST { mode:'finalize', document_id }
//     -> { ok, status, items? }
//   POST { mode:'status', document_id }
//     -> { document_id, status, items?, error? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ALLOWED_MIME, MAX_BYTES, detectMime, sha256Hex, sanitize, type ExtractionResult } from "../_shared/documents/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const MODEL = "google/gemini-2.5-flash";
const BUCKET = "documents";

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

async function callMultimodal(publicBase64Url: string, mimeType: string, filename: string, guidance: string, signal: AbortSignal): Promise<{ result: ExtractionResult; tokens_in: number; tokens_out: number; ms: number; error?: string }> {
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
      return { result: { document_kind: "unknown", items: [], notes: `gateway_error:${res.status}` }, tokens_in: 0, tokens_out: 0, ms, error: `gateway:${res.status}:${body.slice(0,200)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "{}";
    const tokens_in = data?.usage?.prompt_tokens ?? 0;
    const tokens_out = data?.usage?.completion_tokens ?? 0;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    const today = new Date().toISOString().slice(0, 10);
    return { result: sanitize(parsed, today), tokens_in, tokens_out, ms };
  } catch (e) {
    return {
      result: { document_kind: "unknown", items: [], notes: "fetch_error" },
      tokens_in: 0, tokens_out: 0, ms: Date.now() - start, error: (e as Error).message,
    };
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

    // Create signed upload URL
    const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUploadUrl(storage_path);
    if (signErr || !signed) return json({ error: "signed_url_failed", details: signErr?.message }, 500);

    // Placeholder sha256 — final value computed at finalize
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

    return json({ ok: true, document_id: doc_id, upload_url: signed.signedUrl, storage_path, token: signed.token });
  }

  // === FINALIZE ===
  if (mode === "finalize") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const { data: doc, error } = await sb.from("document_imports").select("*").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (error || !doc) return json({ error: "not_found" }, 404);

    if (doc.status === "confirmed" || doc.status === "partially_confirmed" || doc.status === "canceled") {
      return json({ ok: true, status: doc.status, document_id });
    }

    // Download file, validate magic bytes/size, compute sha256, dedupe
    const { data: fileBlob, error: dlErr } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr || !fileBlob) {
      await sb.from("document_imports").update({ status: "failed", error: `download:${dlErr?.message ?? "no_blob"}` }).eq("id", document_id);
      return json({ error: "download_failed", details: dlErr?.message }, 500);
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    if (bytes.length > MAX_BYTES) {
      await sb.from("document_imports").update({ status: "failed", error: "size_exceeds" }).eq("id", document_id);
      return json({ error: "size_exceeds" }, 400);
    }
    const magic = detectMime(bytes);
    if (!magic || magic !== doc.mime_type) {
      await sb.from("document_imports").update({ status: "failed", error: `mime_mismatch:${magic ?? "unknown"}` }).eq("id", document_id);
      return json({ error: "mime_mismatch", got: magic }, 400);
    }
    const sha = await sha256Hex(bytes);

    // Deduplicate by (user_id, sha256): if a prior doc has the same hash, return it and delete this upload
    const { data: existing } = await sb.from("document_imports").select("id, status").eq("user_id", user.id).eq("sha256", sha).neq("id", document_id).maybeSingle();
    if (existing?.id) {
      await sb.storage.from(BUCKET).remove([doc.storage_path]);
      await sb.from("document_imports").delete().eq("id", document_id);
      return json({ ok: true, deduped: true, document_id: existing.id, status: existing.status });
    }

    await sb.from("document_imports").update({ status: "processing", sha256: sha }).eq("id", document_id);

    // Call multimodal model with base64 data URL (bucket is private).
    // Chunked base64 to avoid Maximum call stack size exceeded on 5-10MB images.
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]);
    }
    const b64 = btoa(bin);
    const dataUrl = `data:${doc.mime_type};base64,${b64}`;

    let extraction: ExtractionResult = { document_kind: "unknown", items: [], notes: null };
    let modelOk = true;
    let tokens_in = 0, tokens_out = 0, ms = 0, gwErr: string | undefined;
    if (!LOVABLE_API_KEY) {
      modelOk = false;
      gwErr = "no_api_key";
    } else {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 45_000);
      try {
        const guidance = String(body.guidance ?? "").slice(0, 500);
        const out = await callMultimodal(dataUrl, doc.mime_type, doc.storage_path?.split("/").pop() ?? "documento", guidance, ac.signal);
        extraction = out.result;
        if (/\b(hoje|de hoje|foram hoje|s[ãa]o de hoje)\b/i.test(guidance)) {
          const today = new Date().toISOString().slice(0, 10);
          extraction = { ...extraction, items: extraction.items.map((item) => ({ ...item, occurred_at: today })) };
        }
        tokens_in = out.tokens_in;
        tokens_out = out.tokens_out;
        ms = out.ms;
        if (out.error) { modelOk = false; gwErr = out.error; }
      } finally {
        clearTimeout(t);
      }
    }

    if (!modelOk || extraction.document_kind === "illegible" || extraction.document_kind === "non_financial") {
      const failStatus = !modelOk ? "failed" : "needs_review";
      await sb.from("document_imports").update({
        status: failStatus,
        document_kind: extraction.document_kind,
        model: MODEL,
        tokens_in, tokens_out,
        extraction_ms: ms,
        error: gwErr ?? null,
      }).eq("id", document_id);
      return json({
        ok: true,
        status: failStatus,
        document_id,
        document_kind: extraction.document_kind,
        items: [],
        error: gwErr ?? null,
      });
    }

    // Aplica memória pessoal de categorias e tenta reconhecer conta/cartão sem esconder a revisão.
    const enriched = await enrichItems(sb, user.id, extraction.items);
    const dupes = await findDuplicates(sb, user.id, enriched);
    const rows = enriched.map((it, idx) => ({
      document_id,
      user_id: user.id,
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
        await sb.from("document_imports").update({ status: "failed", error: `items:${itemsErr.message}` }).eq("id", document_id);
        return json({ error: "items_insert_failed", details: itemsErr.message }, 500);
      }
    }

    await sb.from("document_imports").update({
      status: "needs_review",
      document_kind: extraction.document_kind,
      model: MODEL,
      tokens_in, tokens_out,
      extraction_ms: ms,
    }).eq("id", document_id);

    return json({
      ok: true,
      status: "needs_review",
      document_id,
      document_kind: extraction.document_kind,
      items_count: rows.length,
    });
  }

  // === STATUS ===
  if (mode === "status") {
    const document_id = String(body.document_id ?? "");
    if (!document_id) return json({ error: "missing_document_id" }, 400);
    const { data: doc } = await sb.from("document_imports").select("*").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return json({ error: "not_found" }, 404);
    const { data: items } = await sb.from("extracted_items").select("*").eq("document_id", document_id).eq("user_id", user.id).order("idx");
    return json({ ok: true, document: doc, items: items ?? [] });
  }

  return json({ error: "unknown_mode" }, 400);
});
