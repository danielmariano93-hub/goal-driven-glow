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
import { fail } from "../_shared/http.ts";

const FN = "assistant-ingest-document";
import { ALLOWED_MIME, MAX_BYTES, detectMime, sha256Hex, sanitize, normalizeAmountBR, normalizeDateBR, todaySaoPaulo, validateExtractedRow, type ExtractionResult } from "../_shared/documents/types.ts";
import { normalizeDescription, extractBankReference, computeFingerprint } from "../_shared/documents/normalize.ts";
import { bytesToDataUrl, splitPdfIntoFragments } from "../_shared/documents/pdfFragments.ts";
import { extractPdfText } from "../_shared/documents/pdfText.ts";
import { auditInvoiceCoverage, coverageMessage, parseInvoiceText, type InvoiceCoverage } from "../_shared/documents/invoiceParser.ts";
import { chunkItems, invoiceToExtraction } from "../_shared/documents/invoiceExtraction.ts";
import { resolveDocumentDate } from "../_shared/documents/dates.ts";
import { allowsBankBalance, applyLedgerInvariants, derivePeriod, isCardDocument } from "../_shared/ledger/canonical.ts";
import { applyCreditSignGuard } from "../_shared/ledger/creditSemantics.ts";

import { classifyStatementItem, inferInstallmentDetails } from "../_shared/documents/invoice.ts";
import { decideByRule } from "../_shared/categorization/pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const BUCKET = "documents";
const PROCESSING_STALE_MS = 5 * 60 * 1000;
const EXTRACTION_TIMEOUT_MS = 90 * 1000;
const DEFAULT_MAX_ITEMS_PER_DOCUMENT = 240;
const MAX_ITEMS_HARD_CAP = 800;
const BATCH_ITEMS_LIMIT = 80;
const PDF_PAGES_PER_FRAGMENT = 4;
const IMAGE_BATCHES = 1;
const BATCH_MAX_TOKENS = 3600;

async function resolveDocMaxItems(sb: ReturnType<typeof createClient>, userId: string): Promise<number> {
  try {
    const { data } = await sb.from("user_financial_settings").select("doc_max_items").eq("user_id", userId).maybeSingle();
    const n = Number((data as { doc_max_items?: number } | null)?.doc_max_items ?? DEFAULT_MAX_ITEMS_PER_DOCUMENT);
    if (!Number.isFinite(n) || n < 40) return DEFAULT_MAX_ITEMS_PER_DOCUMENT;
    return Math.min(MAX_ITEMS_HARD_CAP, Math.max(40, Math.floor(n)));
  } catch { return DEFAULT_MAX_ITEMS_PER_DOCUMENT; }
}

async function resolveConfiguredModel(sb: ReturnType<typeof createClient>, task: "vision" | "semantic_classification"): Promise<string> {
  const { data } = await sb.from("ai_model_routes")
    .select("primary_model")
    .eq("task", task)
    .eq("active", true)
    .maybeSingle();
  return String(data?.primary_model ?? DEFAULT_MODEL);
}

type SourceContext = {
  source_account_id: string | null;
  source_credit_card_id: string | null;
  source_context_method: string | null;
  source_context_confidence: number | null;
  source_context_reason: string | null;
};

async function resolveSourceContext(
  sb: ReturnType<typeof createClient>,
  userId: string,
  doc: Record<string, unknown>,
  statement: { bank: string | null } | null,
): Promise<SourceContext> {
  // 1) Usuário já selecionou: mantém.
  const preAcc = (doc.source_account_id as string | null) ?? null;
  const preCard = (doc.source_credit_card_id as string | null) ?? null;
  if (preAcc || preCard) {
    return {
      source_account_id: preAcc,
      source_credit_card_id: preCard,
      source_context_method: (doc.source_context_method as string | null) ?? "user_selected",
      source_context_confidence: Number(doc.source_context_confidence ?? 1),
      source_context_reason: (doc.source_context_reason as string | null) ?? "user_selected",
    };
  }
  const [{ data: accounts }, { data: cards }] = await Promise.all([
    sb.from("accounts").select("id, name, institution").eq("user_id", userId).eq("active", true),
    sb.from("credit_cards").select("id, name").eq("user_id", userId).eq("active", true),
  ]);
  const normText = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const documentKind = String(doc.document_kind ?? "unknown");
  // 2) Banco identificado pelo documento bate com institution/name. Extrato
  // prioriza contas; fatura prioriza cartões, evitando falsa ambiguidade Itaú.
  const bank = (statement?.bank ?? doc.statement_bank ?? null) as string | null;
  if (bank) {
    const norm = normText(bank);
    const tokenMatch = (hay: string) => hay.includes(norm) || norm.split(/\s+/).some((tok) => tok.length >= 3 && hay.includes(tok));
    if (documentKind !== "invoice") {
      const matches = (accounts ?? []).filter((a) => tokenMatch(normText(`${a.name ?? ""} ${a.institution ?? ""}`)));
      if (matches.length === 1) return { source_account_id: matches[0].id as string, source_credit_card_id: null,
        source_context_method: "statement_bank", source_context_confidence: 0.92, source_context_reason: `bank_match:${bank.slice(0, 40)}` };
    }
    if (documentKind === "invoice") {
      const matches = (cards ?? []).filter((c) => tokenMatch(normText(c.name)));
      if (matches.length === 1) return { source_account_id: null, source_credit_card_id: matches[0].id as string,
        source_context_method: "invoice_bank", source_context_confidence: 0.92, source_context_reason: `card_match:${bank.slice(0, 40)}` };
    }
  }
  // 3) Orientação do usuário na conversa, com comparação tolerante a acentos.
  const guidance = normText(doc.user_instructions ?? "");
  if (guidance) {
    const acc = (accounts ?? []).find((a) => guidance.includes(normText(a.name)) || guidance.includes(normText(a.institution)));
    if (acc) return { source_account_id: acc.id as string, source_credit_card_id: null,
      source_context_method: "guidance", source_context_confidence: 0.75, source_context_reason: "guidance_account" };
    const card = (cards ?? []).find((c) => guidance.includes(normText(c.name)));
    if (card) return { source_account_id: null, source_credit_card_id: card.id as string,
      source_context_method: "guidance", source_context_confidence: 0.75, source_context_reason: "guidance_card" };
  }
  // 4) Natureza do documento elimina ambiguidade entre conta e cartão.
  if (documentKind === "statement" && (accounts ?? []).length === 1) {
    return { source_account_id: (accounts ?? [])[0].id as string, source_credit_card_id: null,
      source_context_method: "single_statement_account", source_context_confidence: 0.7, source_context_reason: "single_account_for_statement" };
  }
  if (documentKind === "invoice" && (cards ?? []).length === 1) {
    return { source_account_id: null, source_credit_card_id: (cards ?? [])[0].id as string,
      source_context_method: "single_invoice_card", source_context_confidence: 0.7, source_context_reason: "single_card_for_invoice" };
  }
  // 5) Único ativo.
  if ((accounts ?? []).length === 1 && (cards ?? []).length === 0) {
    return { source_account_id: (accounts ?? [])[0].id as string, source_credit_card_id: null,
      source_context_method: "single_account", source_context_confidence: 0.6, source_context_reason: "only_active_account" };
  }
  return { source_account_id: null, source_credit_card_id: null,
    source_context_method: "none", source_context_confidence: 0, source_context_reason: "ambiguous" };
}


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

const SYSTEM_PROMPT = `Você é um extrator financeiro para o app MeuNino.

Analise o documento enviado (PDF, recibo, fatura, extrato, print de compra ou lista) e devolva JSON PURO, compacto, sem markdown:
{"k":"statement|receipt|invoice|list|non_financial|illegible|unknown","i":[["expense","YYYY-MM-DD",123.45,"descrição","account",null,null,"transaction",null,null,null,null,null]],"n":"nota curta","more":false,"m":{"opening_balance":null,"closing_balance":null,"balance_date":null,"period_start":null,"period_end":null,"bank":null},"f":{"total":null,"previous_balance":null,"due_date":null,"closing_date":null,"competence":null,"card_last4":null}}

Cada item em "i" é EXATAMENTE:
[tipo,data,valor,descricao,pagamento,conta,cartao,movimento,parcelas_total,parcela_numero,data_compra,competencia,categoria]

Use null para campo desconhecido. Não use objetos dentro de "i".

REGRAS ESTRITAS:
- Valores em real brasileiro: aceite formatos 1.234,56 e 1234.56.
- Datas em português brasileiro dd/mm/aaaa OU ISO YYYY-MM-DD.
- Preserve a data literal da linha. Para dd/mm sem ano, use o ano do período do extrato.
- Só use a data atual quando não existir data na linha nem período confiável no documento.
- Nunca transforme uma data documental legítima em hoje e nunca aceite data futura sem evidência.
- Elementos da interface do celular e datas de referência do extrato não são, por si só, a data da compra.
- Nunca invente texto ilegível — melhor devolver i=[] e k="illegible".
- Se for imagem não financeira (meme, foto, screenshot de conversa sem valores), devolva k="non_financial" e i=[].
- EXCLUA todas as linhas informativas: SALDO DO DIA, saldo atual/em conta/anterior/disponível/total, limites, cabeçalhos, período, emissão, subtotais e totais.
- Se precisar representar uma linha informativa no JSON intermediário, use movimento "informational"; ela será descartada antes da persistência.
- RESGATE CDB é resgate de investimento, não receita. Aplicação é investimento, não despesa.
- PIX entre contas da mesma pessoa é transferência interna, não receita/despesa. Se não houver certeza, marque internal_transfer e explique em notes.
- Estorno/reembolso (incluindo descrições iniciadas por EST) é refund/income, nunca nova renda recorrente.
- Em faturas, NÃO omita valores que reduzem o total: pagamento/antecipação da fatura usa income + card_payment; estorno, crédito ou cancelamento parcial usa income + refund. O valor deve ser sempre positivo.
- Em faturas, extraia em f.previous_balance SOMENTE o valor explicitamente rotulado como "saldo anterior", "saldo da fatura anterior" ou equivalente. Não o inclua em "i", não o trate como compra e nunca o infira pela diferença matemática.
- Preserve a descrição literal; não use "crédito", "débito", "cartão de crédito" ou "cartão" como descrição.
- O bloco "m" é metadata de extrato. Extraia APENAS de linhas informativas ("Saldo do dia", "Saldo final", "Saldo anterior"). Nunca vire transação.
- Parcelas ("03/10", "3 de 10", "3x"): preencha parcelas_total e parcela_numero com o valor da parcela desta fatura.
- Categoria só com evidência clara: Alimentação, Mercado, Moradia, Transporte, Saúde, Lazer, Educação, Assinaturas, Vestuário, Pets, Impostos e Taxas, Serviços, Presentes, Outros.
- OBRIGATÓRIO: "i" deve conter TODAS as linhas de compra/lançamento do documento. Só devolva i=[] quando o documento realmente não tiver nenhum lançamento.
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
  invoice: InvoiceMetadata | null;
  tokens_in: number;
  tokens_out: number;
  ms: number;
  has_more: boolean;
  partial: boolean;
  errorTag?: string;
};

type InvoiceMetadata = {
  total: number | null;
  previous_balance: number | null;
  due_date: string | null;
  closing_date: string | null;
  competence: string | null;
  card_last4: string | null;
};

function normalizeInvoiceDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const value = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : null;
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function extractInvoiceMetadata(parsed: unknown, _fallback: string): InvoiceMetadata | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = (parsed as Record<string, unknown>).f;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const total = normalizeAmountBR((r.total ?? "") as string | number);
  const previous_balance = normalizeAmountBR((r.previous_balance ?? "") as string | number);
  const due_date = normalizeInvoiceDate(r.due_date);
  const closing_date = normalizeInvoiceDate(r.closing_date);
  const competenceRaw = typeof r.competence === "string" ? r.competence : null;
  const competence = competenceRaw && /^\d{4}-\d{2}(?:-\d{2})?$/.test(competenceRaw)
    ? `${competenceRaw.slice(0, 7)}-01`
    : null;
  const digits = String(r.card_last4 ?? "").replace(/\D/g, "");
  const card_last4 = digits.length >= 4 ? digits.slice(-4) : null;
  return total != null || previous_balance != null || due_date || closing_date || competence || card_last4
    ? { total, previous_balance, due_date, closing_date, competence, card_last4 }
    : null;
}

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
  // Locate the items array even when the JSON is truncated/malformed BEFORE `"i":`.
  // Strategy: find the first `[` after the first `"i"` marker OR fall back to the
  // first `[[` sequence in the text (compact rows start with `[`).
  let arrayStart = -1;
  const iMarker = text.search(/"i"\s*:/);
  if (iMarker >= 0) {
    const bracket = text.indexOf("[", iMarker);
    if (bracket >= 0) arrayStart = bracket;
  }
  if (arrayStart < 0) {
    const nested = text.indexOf("[[");
    if (nested >= 0) arrayStart = nested;
  }
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
  batch: { index: number; max: number; exclude: string[]; strict?: boolean },
  model: string,
): Promise<MultimodalOutcome> {
  const start = Date.now();
  // A cláusula de "já extraídos" só existe quando há de fato itens anteriores.
  // Enviá-la vazia (ou em modo estrito) fazia o modelo escolher a saída
  // "sem novos lançamentos" e devolver i=[] mesmo em faturas cheias.
  const exclusion = !batch.strict && batch.exclude.length
    ? `\nNão repita estes lançamentos já extraídos (data|valor|descrição): ${batch.exclude.join("; ")}.\nSe TODOS os lançamentos do documento já estiverem nessa lista, devolva {"k":"statement","i":[],"n":"sem novos lançamentos","more":false}.`
    : `\nNenhum lançamento foi extraído ainda: devolva TODOS os lançamentos deste trecho, sem omitir nenhum.`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Data atual em America/Sao_Paulo: ${todaySaoPaulo()}. Orientação do usuário: ${guidance || "nenhuma"}.
Lote ${batch.index}/${batch.max}: extraia até ${BATCH_ITEMS_LIMIT} lançamentos, do mais recente ao mais antigo.${exclusion}` },
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
      return { result: { document_kind: "unknown", items: [], notes: `gateway_error:${res.status}` }, statement: null, invoice: null, tokens_in: 0, tokens_out: 0, ms, has_more: false, partial: false, errorTag: `gateway:${res.status}:${body.slice(0, 160)}` };
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
        return { result: { document_kind: "unknown", items: [], notes: "extraction_json" }, statement: null, invoice: null, tokens_in, tokens_out, ms, has_more: false, partial: false, errorTag: "extraction:invalid_json" };
      }
      parsed = recovered.parsed;
      partial = recovered.partial;
    }
    const today = todaySaoPaulo();
    return {
      result: sanitize(parsed, today),
      statement: extractStatementMetadata(parsed, today),
      invoice: extractInvoiceMetadata(parsed, today),
      tokens_in,
      tokens_out,
      ms,
      has_more: (parsed as Record<string, unknown>)?.more === true,
      partial,
    };
  } catch (e) {
    const err = e as Error;
    const tag = err.name === "AbortError" ? "timeout:aborted" : `fetch_error:${err.message?.slice(0, 160) ?? "unknown"}`;
    return { result: { document_kind: "unknown", items: [], notes: "fetch_error" }, statement: null, invoice: null, tokens_in: 0, tokens_out: 0, ms: Date.now() - start, has_more: false, partial: false, errorTag: tag };
  }
}


type DupeHit = { transaction_id: string; strength: "strong" | "ambiguous"; reason: string };

/**
 * Classifica cada item candidato contra transações existentes do usuário.
 *
 * Delega ao motor único `_shared/import/dedupe.ts` — o mesmo usado pelo lote de
 * JSON no chat, CSV/OFX e WhatsApp. Ganhos sobre a versão anterior: janela de
 * ±3 dias (compra x processamento), comerciante canônico em vez de descrição
 * literal e uma transação existente nunca absorve dois itens do documento.
 * - Strong: fingerprint, referência bancária ou data+valor+comerciante.
 * - Ambiguous: valor/tipo compatíveis dentro da janela, ou mesma data com
 *   descrição diferente (revisão manual necessária).
 */
async function classifyDuplicates(
  sb: ReturnType<typeof createClient>,
  user_id: string,
  items: Array<{ type: string; amount: number; occurred_at: string; normalized_description: string | null; bank_reference: string | null; fingerprint: string }>,
): Promise<Map<number, DupeHit>> {
  const map = new Map<number, DupeHit>();
  if (items.length === 0) return map;

  const input = items.map((it) => ({
    type: it.type,
    amount: Number(it.amount),
    occurred_at: it.occurred_at,
    description: it.normalized_description,
    raw_description: it.normalized_description,
    bank_reference: it.bank_reference,
    fingerprint: it.fingerprint,
  }));

  const existing = await fetchExistingCandidates(sb as any, user_id, input);
  const verdicts = classifyBatch(input, existing);

  verdicts.forEach((verdict, i) => {
    if (verdict.status === "new" || !verdict.duplicate_of) return;
    map.set(i, {
      transaction_id: verdict.duplicate_of,
      strength: verdict.status === "exact_duplicate" ? "strong" : "ambiguous",
      reason: verdict.reason_code ?? verdict.status,
    });
  });
  return map;
}

/**
 * Enriquecimento: descrição amigável (raw preservada), fingerprint, categoria por
 * regras determinísticas → histórico do usuário → hint do modelo. Sinaliza a fonte
 * da categoria para transparência no ReviewSheet.
 */
async function enrichItems(
  sb: ReturnType<typeof createClient>,
  userId: string,
  items: ExtractionResult["items"],
  sourceContext: { statementBank?: string | null; guidance?: string | null } = {},
  classificationModel: string = DEFAULT_MODEL,
) {
  // 1) Normalize itens primeiro (rápido, em memória) para saber quais descrições procurar no histórico.
  const normalized = items.map((item) => {
    const rawDesc = String(item.description ?? "");
    const { friendly, category_hint: ruleCategory, movement_kind: ruleMovementKind } = normalizeDescription(rawDesc);
    return {
      item,
      rawDesc,
      friendly,
      normalizedKey: friendly.toLowerCase().trim(),
      ruleCategory,
      ruleMovementKind,
      bankRef: extractBankReference(rawDesc),
    };
  });
  const uniqueDescriptions = [...new Set(normalized.map((n) => n.friendly).filter(Boolean))].slice(0, 200);
  const uniqueRawKeys = [...new Set(normalized.map((n) => n.rawDesc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean))].slice(0, 200);

  // 2) Uma única leva de queries.
  const [{ data: categories }, { data: history }, { data: accounts }, { data: cards }, aliasResp] = await Promise.all([
    sb.from("categories").select("id, name, type, user_id").or(`user_id.eq.${userId},user_id.is.null`),
    uniqueDescriptions.length > 0
      ? sb.from("transactions").select("description, raw_description, category_id, type")
          .eq("user_id", userId).not("category_id", "is", null)
          .in("description", uniqueDescriptions)
          .order("occurred_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Array<{ description: string; raw_description: string | null; category_id: string; type: string }> }),
    sb.from("accounts").select("id, name, institution").eq("user_id", userId).eq("active", true),
    sb.from("credit_cards").select("id, name").eq("user_id", userId).eq("active", true),
    uniqueRawKeys.length > 0
      ? sb.from("merchant_aliases").select("alias_key, friendly_name, category_id").eq("user_id", userId).in("alias_key", uniqueRawKeys)
      : Promise.resolve({ data: [] as Array<{ alias_key: string; friendly_name: string | null; category_id: string | null }> }),
  ]);
  const aliasByKey = new Map<string, { friendly_name: string | null; category_id: string | null }>();
  for (const a of (aliasResp.data ?? [])) aliasByKey.set(a.alias_key, { friendly_name: a.friendly_name, category_id: a.category_id });


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
    const { item, rawDesc, friendly, normalizedKey, ruleCategory, ruleMovementKind, bankRef } = n;
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

    // Aliases do usuário têm precedência máxima (aprendizado explícito).
    const aliasKey = rawDesc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
    const aliasHit = aliasByKey.get(aliasKey);
    let aliasFriendly: string | null = null;
    if (aliasHit) {
      if (aliasHit.friendly_name) aliasFriendly = aliasHit.friendly_name;
      if (aliasHit.category_id) { categoryId = aliasHit.category_id; categorySource = "alias"; categoryConfidence = 0.98; }
    }

    if (!categoryId && ruleCategory) {
      const c = findCatByName(ruleCategory);
      if (c) { categoryId = c; categorySource = "rule"; categoryConfidence = 0.9; }
    }
    if (!categoryId) {
      const decision = decideByRule(friendly || rawDesc, (categories ?? [])
        .filter((c) => c.type === item.type || c.type === "both")
        .map((c) => ({ id: c.id, name: c.name })));
      if (decision?.category_id) {
        categoryId = decision.category_id;
        categorySource = "rule";
        categoryConfidence = decision.category_confidence;
      }
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

    const normalizeBankText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const accountContext = normalizeBankText([item.account_hint, sourceContext.statementBank, sourceContext.guidance].filter(Boolean).join(" "));
    const accountCandidates = (accounts ?? []).filter((a) => {
      const haystack = normalizeBankText(`${a.name} ${a.institution ?? ""}`);
      return accountContext && haystack.split(/\s+/).some((token) => token.length >= 4 && accountContext.includes(token));
    });
    const matchedAccount = accountCandidates.length === 1
      ? accountCandidates[0]
      : ((accounts ?? []).length === 1 && item.payment_method === "account" ? (accounts ?? [])[0] : null);
    const cardHint = (item.card_hint ?? "").toLowerCase();
    const matchedCard = cardHint ? (cards ?? []).find((c) => c.name.toLowerCase().includes(cardHint) || cardHint.includes(c.name.toLowerCase())) : null;

    const account_id = matchedAccount?.id ?? null;
    const credit_card_id = matchedCard?.id ?? null;

    // Sinal antes de qualquer persistência: estorno/cancelamento/devolução nunca
    // entra como despesa (senão infla fatura, ritmo e obrigação do cartão).
    const guarded = applyCreditSignGuard({
      type: item.type === "income" ? "income" : "expense",
      amount: Number(item.amount ?? 0),
      description: [rawDesc, friendly].filter(Boolean).join(" "),
      movement_kind: item.movement_kind ?? null,
    });

    const fingerprint = await computeFingerprint({
      user_id: userId,
      type: guarded.type,
      occurred_at: item.occurred_at,
      amount: guarded.amount,
      account_id,
      credit_card_id,
      bank_reference: bankRef,
      normalized_description: friendly,
    });

    // movement_kind: se o extractor não classificou (default "transaction"), aplique o hint determinístico.
    const currentKind = (guarded.movement_kind ?? "transaction").toString();
    const effectiveKind = currentKind === "transaction" && ruleMovementKind ? ruleMovementKind : currentKind;

    enriched.push({
      ...item,
      type: guarded.type,
      amount: guarded.amount,
      raw_description: rawDesc,
      normalized_description: friendly,
      description: aliasFriendly || friendly || rawDesc,
      bank_reference: bankRef,
      dedupe_fingerprint: fingerprint,
      category_id: categoryId,
      category_source: categorySource,
      category_confidence: categoryConfidence,
      account_id,
      credit_card_id,
      movement_kind: effectiveKind,
      credit_guard_reasons: guarded.credit_guard_reasons.length > 0 ? guarded.credit_guard_reasons : undefined,
    });


  }

  // Último recurso em uma única chamada: categoriza apenas o que regras,
  // aliases, histórico e hint não resolveram. A resposta só pode escolher uma
  // categoria existente e precisa trazer confiança >= 0,70.
  const unresolved = enriched
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.category_id)
    .slice(0, 80);
  if (unresolved.length > 0 && LOVABLE_API_KEY) {
    try {
      const candidates = (categories ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type }));
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: classificationModel,
          response_format: { type: "json_object" },
          max_tokens: 1400,
          messages: [
            {
              role: "system",
              content: "Classifique lançamentos financeiros brasileiros. Use somente category_id fornecido. Responda JSON puro {\"items\":[{\"index\":0,\"category_id\":\"uuid\",\"confidence\":0.0}]}. Se não houver evidência suficiente, use category_id null. Nunca invente UUID.",
            },
            {
              role: "user",
              content: JSON.stringify({
                categories: candidates,
                items: unresolved.map(({ item, index }) => ({
                  index,
                  type: item.type,
                  description: item.raw_description ?? item.description,
                })),
              }),
            },
          ],
        }),
      });
      if (response.ok) {
        const payload = await response.json();
        const parsed = JSON.parse(payload?.choices?.[0]?.message?.content ?? "{}") as {
          items?: Array<{ index?: number; category_id?: string | null; confidence?: number }>;
        };
        const validIds = new Set(candidates.map((candidate) => candidate.id));
        for (const suggestion of parsed.items ?? []) {
          const index = Number(suggestion.index);
          const confidence = Number(suggestion.confidence ?? 0);
          if (!Number.isInteger(index) || !validIds.has(String(suggestion.category_id)) || confidence < 0.7) continue;
          const target = enriched[index];
          if (!target || target.category_id) continue;
          target.category_id = String(suggestion.category_id);
          target.category_source = "llm";
          target.category_confidence = Math.min(0.9, confidence);
        }
      }
    } catch (error) {
      console.warn("[assistant-ingest-document] category_batch_failed", String(error).slice(0, 160));
    }
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
  if (errorTag.startsWith("timeout")) return "A leitura ficou grande demais e demorou mais que o esperado. Tente novamente por partes.";
  if (errorTag.startsWith("gateway")) return "O serviço de leitura instabilizou. Tente novamente em instantes.";
  if (errorTag.startsWith("fetch_error")) return "Falha de rede ao ler o documento. Tente novamente.";
  if (errorTag.startsWith("extraction")) return "A extração ficou grande demais para concluir de uma vez. Tente novamente por partes.";
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

const TERMINAL_STATUSES = new Set(["needs_review", "partial", "confirmed", "partially_confirmed", "canceled"]);
const TRANSIENT_ERROR_PREFIXES = ["gateway:", "fetch_error", "timeout:", "download:", "items_insert:", "extraction:"];

function isTransientErrorTag(tag: string | null): boolean {
  if (!tag) return false;
  return TRANSIENT_ERROR_PREFIXES.some((p) => tag.startsWith(p));
}

/** Idempotently emit a processing event and, when the document originated from
 *  WhatsApp, queue an outbound message once per (document_id, event_type).
 *  Any failure is swallowed — status notifications must never block ingestion. */
async function notifyDocumentTransition(
  sb: ReturnType<typeof createClient>,
  doc: { id: string; user_id: string; source?: string | null; conversation_id?: string | null },
  eventType: string,
  waMessage?: string | null,
  eventExtras: Record<string, unknown> = {},
) {
  try {
    const { data: prior } = await sb.from("document_processing_events")
      .select("id").eq("document_id", doc.id).eq("event_type", eventType).limit(1).maybeSingle();
    if (prior) return; // dedup by (document_id, event_type)
    const { correlation_id, ...eventColumns } = eventExtras;
    await sb.from("document_processing_events").insert({
      document_id: doc.id, user_id: doc.user_id, event_type: eventType,
      user_message: waMessage ?? null,
      metadata: { correlation_id: correlation_id ?? null },
      ...eventColumns,
    });
    if (doc.source === "whatsapp" && waMessage && doc.conversation_id) {
      const { data: conv } = await sb.from("conversations").select("phone_e164").eq("id", doc.conversation_id).maybeSingle();
      const phone = (conv as { phone_e164?: string } | null)?.phone_e164;
      if (phone) {
        await sb.from("outbound_messages").insert({
          user_id: doc.user_id, to_phone: phone, kind: "document_status", body: waMessage,
          channel: "whatsapp", context_type: "document_import", context_id: doc.id,
          metadata: { event_type: eventType, origin: "document_processing" },
          idempotency_key: `document:${doc.id}:${eventType}`,
        });
      }
    }
  } catch { /* swallow */ }
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
  const failureCount = Number(doc.counters?.failure_count ?? doc.attempt_count ?? 0);
  const attemptCount = Number(doc.attempt_count ?? 0);
  // Terminal after 3 attempts — panel must offer explicit "reprocessar" that resets attempt_count.
  if (attemptCount >= 3 && doc.status === "failed") return { acquired: false, doc };
  const canResume = doc.status === "uploaded"
    || (doc.status === "processing" && stale)
    || (doc.status === "failed" && isTransientErrorTag(prevErrTag) && failureCount < 3 && attemptCount < 3);

  if (!canResume) return { acquired: false, doc };

  // Clear orphaned draft items only when there are no usable checkpoints to preserve.
  if (doc.status !== "uploaded") {
    const { count } = await sb.from("extracted_items")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId)
      .eq("user_id", userId)
      .in("status", ["needs_review", "duplicate_suspect"]);
    if ((count ?? 0) === 0) {
      await sb.from("extracted_items").delete().eq("document_id", documentId).eq("user_id", userId).in("status", ["needs_review", "duplicate_suspect"]);
    }
  }

  const { data: updated, error: upErr } = await sb.from("document_imports")
    .update({ status: "processing", error: null, attempt_count: attemptCount + 1 })
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
  const [visionModel, classificationModel] = await Promise.all([
    resolveConfiguredModel(sb, "vision"),
    resolveConfiguredModel(sb, "semantic_classification"),
  ]);
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
    await notifyDocumentTransition(sb, { id: documentId, user_id: userId, source: doc.source, conversation_id: doc.conversation_id }, "processing_started", null);
    const previousFailureCount = Number(doc.counters?.failure_count ?? 0);
    const failureCounters = (base: Record<string, unknown> = {}) => ({ ...base, failure_count: previousFailureCount + 1 });

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

    // Leitura determinística primeiro: a camada de texto do PDF traz TODAS as
    // linhas e os subtotais oficiais. O modelo de visão continua como fallback
    // (PDF escaneado) e segue responsável pela categorização em enrichItems.
    let deterministicOutcomes: MultimodalOutcome[] | null = null;
    let deterministicCoverage: InvoiceCoverage | null = null;
    let officialSummaryPatch: Record<string, unknown> | null = null;
    if (doc.mime_type === "application/pdf") {
      const pdfText = await extractPdfText(bytes);
      if (pdfText.hasTextLayer) {
        const parsedInvoice = parseInvoiceText(pdfText.text);
        if (parsedInvoice.detected) {
          const today = todaySaoPaulo();
          const { result } = invoiceToExtraction(parsedInvoice, today);
          deterministicCoverage = auditInvoiceCoverage(parsedInvoice.summary, parsedInvoice.lines);
          const sum = parsedInvoice.summary;
          officialSummaryPatch = {
            invoice_total: sum.total,
            invoice_previous_balance: sum.previous_balance,
            invoice_due_date: sum.due_date,
            invoice_closing_date: sum.closing_date,
            invoice_competence_month: sum.competence,
            invoice_card_last4: sum.card_last4,
            invoice_payments_total: sum.payments_total,
            invoice_current_charges_total: sum.current_charges_total,
            invoice_domestic_total: sum.domestic_total,
            invoice_international_total: sum.international_total,
            invoice_taxes_total: sum.taxes_total,
            invoice_credits_total: sum.credits_total,
            invoice_financed_balance: sum.financed_balance,
            invoice_summary_source: "parser",
            invoice_coverage: deterministicCoverage,
            statement_bank: sum.bank,
          };
          const chunks = chunkItems(result.items, BATCH_ITEMS_LIMIT);
          deterministicOutcomes = chunks.map((chunk, i) => ({
            result: { document_kind: "invoice" as const, items: chunk, notes: i === 0 ? result.notes : null },
            statement: null,
            invoice: {
              total: sum.total,
              previous_balance: sum.previous_balance,
              due_date: sum.due_date,
              closing_date: sum.closing_date,
              competence: sum.competence,
              card_last4: sum.card_last4,
            },
            tokens_in: 0,
            tokens_out: 0,
            ms: 0,
            has_more: false,
            partial: false,
          }));
          console.log(`[assistant-ingest] deterministic_invoice document=${documentId} lines=${result.items.length} gap=${deterministicCoverage.gap_section ?? "none"}`);
        }
      }
    }

    const fragments = deterministicOutcomes
      ? deterministicOutcomes.map((_, i) => ({
          index: i + 1, total: deterministicOutcomes!.length, page_start: 1, page_end: 1, bytes: new Uint8Array(),
        }))
      : doc.mime_type === "application/pdf"
        ? await splitPdfIntoFragments(bytes, PDF_PAGES_PER_FRAGMENT)
        : [{ index: 1, total: 1, page_start: 1, page_end: 1, bytes }];
    if (fragments.length === 0) {
      await finish({ status: "failed", error: encodeError("extraction:empty_pdf", correlationId) });
      return;
    }

    // Configurável por usuário (default 240, hard cap 800).
    const MAX_ITEMS_PER_DOCUMENT = await resolveDocMaxItems(sb, userId);

    // Persiste/idempotência de fragmentos. Fragmentos completed nunca são refeitos.
    const fragmentRows = fragments.map((f) => ({
      document_id: documentId,
      user_id: userId,
      fragment_index: f.index,
      total_fragments: f.total,
      page_start: f.page_start,
      page_end: f.page_end,
      status: "pending" as const,
    }));
    await sb.from("document_fragments").upsert(fragmentRows, { onConflict: "document_id,fragment_index", ignoreDuplicates: true }).then(() => {}, () => {});
    const { data: fragmentState } = await sb.from("document_fragments")
      .select("fragment_index,status,attempts").eq("document_id", documentId).eq("user_id", userId);
    const fragmentByIdx = new Map<number, { status: string; attempts: number }>();
    for (const r of fragmentState ?? []) {
      fragmentByIdx.set(Number(r.fragment_index), { status: String(r.status), attempts: Number(r.attempts ?? 0) });
    }

    // Contexto inicial respeita seleção explícita/guidance; após o metadata do
    // extrato ele é recalculado para considerar o banco realmente detectado.
    let srcCtx = await resolveSourceContext(sb, userId, doc, null);
    await sb.from("document_imports").update(srcCtx).eq("id", documentId).eq("user_id", userId).then(() => {}, () => {});
    if (officialSummaryPatch) {
      await sb.from("document_imports").update({ ...officialSummaryPatch, document_kind: "invoice" })
        .eq("id", documentId).eq("user_id", userId).then(() => {}, () => {});
    }


    let documentKind: ExtractionResult["document_kind"] = deterministicOutcomes ? "invoice" : "unknown";
    let statement: StatementMetadata | null = null;
    let invoice: InvoiceMetadata | null = null;
    let tokens_in = 0, tokens_out = 0, ms = 0;
    let lastErrorTag: string | undefined;
    const notes: string[] = [];
    const counters = emptyCounters();
    const seenSignatures = new Set<string>();
    const seenInDocument = new Map<string, number>();
    let idxOffset = 0;
    const maxBatches = fragments.length;

    const { data: existingItems } = await sb.from("extracted_items")
      .select("idx,type,amount,occurred_at,description,normalized_description,status,category_id")
      .eq("document_id", documentId)
      .eq("user_id", userId)
      .in("status", ["needs_review", "duplicate_suspect"])
      .order("idx");
    for (const existing of existingItems ?? []) {
      const sig = `${existing.occurred_at}|${Number(existing.amount).toFixed(2)}|${String(existing.description ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`.slice(0, 180);
      seenSignatures.add(sig);
      const localKey = `${existing.type}|${existing.occurred_at}|${Number(existing.amount).toFixed(2)}|${existing.normalized_description ?? existing.description ?? ""}`;
      seenInDocument.set(localKey, Number(existing.idx ?? 0));
      idxOffset = Math.max(idxOffset, Number(existing.idx ?? -1) + 1);
      counters.total_items++;
      if (existing.status === "duplicate_suspect") counters.duplicate_ambiguous++;
      if (existing.category_id) counters.categorized_auto++;
    }
    counters.uncategorized = counters.total_items - counters.categorized_auto;
    counters.needs_review = counters.total_items - counters.duplicate_strong - counters.duplicate_ambiguous;

    for (let batchIndex = 1; batchIndex <= maxBatches; batchIndex++) {
      const fragment = fragments[batchIndex - 1];
      const fState = fragmentByIdx.get(batchIndex) ?? { status: "pending", attempts: 0 };
      // Skip fragmentos já concluídos ou skipped.
      if (fState.status === "completed" || fState.status === "skipped") continue;
      // Cap de itens: marca restantes como skipped.
      if (counters.total_items >= MAX_ITEMS_PER_DOCUMENT) {
        await sb.from("document_fragments").update({ status: "skipped", error_code: "max_items_reached" })
          .eq("document_id", documentId).eq("fragment_index", batchIndex).then(() => {}, () => {});
        continue;
      }
      // Attempt cap por fragmento (3 tentativas).
      if (fState.attempts >= 3 && fState.status === "failed") continue;
      const fragmentStart = Date.now();
      // These counters belong to the fragment, not to the optional insertion
      // branch below. Keeping them in fragment scope is important because an
      // empty/fully-deduplicated fragment is still finalized and persisted.
      let batchDupStrong = 0;
      let batchDupAmbiguous = 0;
      await sb.from("document_fragments").update({
        status: "processing", attempts: fState.attempts + 1, heartbeat_at: new Date().toISOString(),
      }).eq("document_id", documentId).eq("fragment_index", batchIndex).then(() => {}, () => {});
      await heartbeat();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), EXTRACTION_TIMEOUT_MS);
      const beat = setInterval(() => {
        void heartbeat();
        void sb.from("document_fragments").update({ heartbeat_at: new Date().toISOString() })
          .eq("document_id", documentId).eq("fragment_index", batchIndex);
      }, 20_000);
      let out: MultimodalOutcome;
      try {
        if (deterministicOutcomes) {
          out = deterministicOutcomes[batchIndex - 1];
        } else {
        const dataUrl = bytesToDataUrl(fragment.bytes, doc.mime_type);
        const filename = doc.storage_path?.split("/").pop() ?? "documento";
        const guide = (guidance ?? "").slice(0, 500);
        out = await callMultimodal(
          dataUrl, doc.mime_type, filename, guide, ac.signal,
          { index: batchIndex, max: maxBatches, exclude: [...seenSignatures].slice(-90) },
          visionModel,
        );
        // Retry estrito: documento financeiro que volta sem nenhum item e sem
        // erro quase sempre significa que o modelo pegou o atalho "sem novos
        // lançamentos". Uma segunda passada sem essa cláusula recupera o lote.
        const emptyFinancial = !out.errorTag
          && out.result.items.length === 0
          && !["non_financial", "illegible"].includes(String(out.result.document_kind));
        if (emptyFinancial) {
          console.log(`[assistant-ingest] strict_retry document=${documentId} fragment=${batchIndex}`);
          const retry = await callMultimodal(
            dataUrl, doc.mime_type, filename, guide, ac.signal,
            { index: batchIndex, max: maxBatches, exclude: [], strict: true },
            visionModel,
          );
          if (retry.result.items.length > 0) {
            out = {
              ...retry,
              tokens_in: out.tokens_in + retry.tokens_in,
              tokens_out: out.tokens_out + retry.tokens_out,
              ms: out.ms + retry.ms,
            };
          }
        }
        }
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
      // O tipo do documento precisa ser conhecido ANTES de resolver o destino:
      // fatura resolve cartão, extrato resolve conta. Sem isso, "Itaú" casava
      // com a conta corrente e a fatura virava despesa de caixa.
      if (out.result.document_kind !== "unknown") documentKind = out.result.document_kind;
      if (out.invoice) {
        invoice = invoice
          ? {
              total: invoice.total ?? out.invoice.total,
              previous_balance: invoice.previous_balance ?? out.invoice.previous_balance,
              due_date: invoice.due_date ?? out.invoice.due_date,
              closing_date: invoice.closing_date ?? out.invoice.closing_date,
              competence: invoice.competence ?? out.invoice.competence,
              card_last4: invoice.card_last4 ?? out.invoice.card_last4,
            }
          : out.invoice;
        await sb.from("document_imports").update({
          invoice_total: invoice.total,
          invoice_previous_balance: invoice.previous_balance,
          invoice_due_date: invoice.due_date,
          invoice_closing_date: invoice.closing_date,
          invoice_competence_month: invoice.competence,
          invoice_card_last4: invoice.card_last4,
        }).eq("id", documentId).eq("user_id", userId).then(() => {}, () => {});
      }
      if (out.statement && !statement) {
        statement = out.statement;
        const bankDoc = allowsBankBalance(documentKind);
        const statementPatch = {
          statement_bank: statement.bank,
          // Saldo informado só existe em documento bancário compatível.
          statement_opening_balance: bankDoc ? statement.opening_balance : null,
          statement_closing_balance: bankDoc ? statement.closing_balance : null,
          statement_balance_date: bankDoc ? statement.balance_date : null,
          statement_period_start: statement.period_start,
          statement_period_end: statement.period_end,
          period_start: statement.period_start,
          period_end: statement.period_end,
        };
        await sb.from("document_imports").update(statementPatch).eq("id", documentId).eq("user_id", userId).then(() => {}, () => {});
        const afterMetadata = await resolveSourceContext(
          sb, userId, { ...doc, ...statementPatch, document_kind: documentKind }, statement,
        );
        const better = (afterMetadata.source_context_confidence ?? 0) > (srcCtx.source_context_confidence ?? 0);
        // Em fatura, um contexto que aponta para conta corrente é sempre inválido.
        const currentIsWrongLedger = isCardDocument(documentKind) && !!srcCtx.source_account_id;
        if (better || currentIsWrongLedger) {
          srcCtx = isCardDocument(documentKind)
            ? { ...afterMetadata, source_account_id: null }
            : afterMetadata;
          await sb.from("document_imports").update(srcCtx).eq("id", documentId).eq("user_id", userId).then(() => {}, () => {});
        }
      }


      const periodStart = out.statement?.period_start ?? statement?.period_start ?? doc.statement_period_start ?? doc.period_start ?? null;
      const periodEnd = out.statement?.period_end ?? statement?.period_end ?? doc.statement_period_end ?? doc.period_end ?? null;
      let extraction = {
        ...out.result,
        items: out.result.items.map((item) => ({
          ...item,
          occurred_at: resolveDocumentDate(item.occurred_at, { statement_period_start: periodStart, statement_period_end: periodEnd, today: todaySaoPaulo() }).date,
          purchase_date: item.purchase_date ? resolveDocumentDate(item.purchase_date, { statement_period_start: periodStart, statement_period_end: periodEnd, today: todaySaoPaulo() }).date : null,
          competence_date: item.competence_date ? resolveDocumentDate(item.competence_date, { statement_period_start: periodStart, statement_period_end: periodEnd, today: todaySaoPaulo() }).date : null,
        })),
      };
      if (/\b(hoje|de hoje|foram hoje|s[ãa]o de hoje)\b/i.test(guidance ?? "")) {
        const today = todaySaoPaulo();
        extraction = { ...extraction, items: extraction.items.map((item) => ({ ...item, occurred_at: today })) };
      }

      if (out.errorTag) {
        lastErrorTag = out.errorTag;
        await sb.from("document_fragments").update({
          status: "failed", error_code: out.errorTag.slice(0, 80), extraction_ms: Date.now() - fragmentStart,
          tokens_in: out.tokens_in, tokens_out: out.tokens_out,
        }).eq("document_id", documentId).eq("fragment_index", batchIndex).then(() => {}, () => {});
        if (counters.total_items > 0) break;
        await finish({ status: "failed", model: visionModel, tokens_in, tokens_out, extraction_ms: ms, counters: failureCounters(counters), error: encodeError(out.errorTag, correlationId) });
        return;
      }


      if ((extraction.document_kind === "illegible" || extraction.document_kind === "non_financial") && counters.total_items === 0 && extraction.items.length === 0) {
        await finish({
          status: "needs_review",
          document_kind: extraction.document_kind,
          model: visionModel,
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
        const enriched = await enrichItems(sb, userId, freshItems, {
          statementBank: out.statement?.bank ?? statement?.bank ?? doc.statement_bank ?? null,
          guidance,
        }, classificationModel);
        const dupes = await classifyDuplicates(sb, userId, enriched.map((it) => ({
          type: it.type,
          amount: Number(it.amount),
          occurred_at: it.occurred_at,
          normalized_description: it.normalized_description ?? null,
          bank_reference: it.bank_reference ?? null,
          fingerprint: it.dedupe_fingerprint,
        })));

        let batchCategorized = 0;
        const isStatement = documentKind === "statement";
        const rows = await Promise.all(enriched.map(async (it, idx) => {
          const globalIdx = idxOffset + idx;
          const hit = dupes.get(idx);
          const localKey = `${it.type}|${it.occurred_at}|${Number(it.amount).toFixed(2)}|${it.normalized_description ?? ""}`;
          const priorIdx = seenInDocument.get(localKey);
          seenInDocument.set(localKey, globalIdx);
          // Em extratos bancários, linhas idênticas (mesma data/valor/descrição) são
          // legítimas (ex.: duas cobranças Uber iguais no mesmo dia). NÃO marcamos
          // como suspeita local — o ordinal garante fingerprint único.
          const localDuplicate = (!isStatement && priorIdx != null)
            ? { strength: "ambiguous" as const, reason: `same_document:${priorIdx}` }
            : null;
          const effectiveHit = hit ?? localDuplicate;
          if (effectiveHit?.strength === "strong") batchDupStrong++;
          else if (effectiveHit?.strength === "ambiguous") batchDupAmbiguous++;
          if (it.category_id) batchCategorized++;

          // Recomputa fingerprint com ordinal para preservar multiplicidade dentro do doc.
          // Sem isso, duas linhas idênticas colidem no fingerprint e podem ser tratadas
          // como o mesmo lançamento na próxima etapa (constraints, aprendizado etc.).
          const fingerprintWithOrdinal = await computeFingerprint({
            user_id: userId,
            type: it.type,
            occurred_at: it.occurred_at,
            amount: Number(it.amount),
            account_id: it.account_id,
            credit_card_id: it.credit_card_id,
            bank_reference: it.bank_reference,
            normalized_description: it.normalized_description,
            ordinal: globalIdx,
          });

          // Invariante contábil: em fatura, o item pertence ao cartão e nunca
          // à conta corrente (não reduz caixa na importação).
          const installments = inferInstallmentDetails(
            it.raw_description ?? it.description,
            it.installment_number,
            it.installments_total,
          );
          const statementItemKind = documentKind === "invoice"
            ? classifyStatementItem({
                description: it.raw_description ?? it.description,
                type: it.type,
                movement_kind: it.movement_kind,
                installment_number: installments.current,
                installments_total: installments.total,
              })
            : null;
          return applyLedgerInvariants(documentKind, {
            document_id: documentId,
            user_id: userId,
            idx: globalIdx,
            type: it.type,
            amount: it.amount,
            occurred_at: it.occurred_at,
            description: it.description,
            raw_description: it.raw_description,
            bank_description: it.raw_description ?? it.description,
            friendly_description: it.description,
            normalized_description: it.normalized_description,
            bank_reference: it.bank_reference,
            dedupe_fingerprint: fingerprintWithOrdinal,
            payment_method: it.account_id ? "account" : it.credit_card_id ? "credit_card" : it.payment_method,
            account_hint: it.account_hint,
            card_hint: it.card_hint,
            category_hint: it.category_hint,
            category_id: it.category_id,
            category_source: it.category_source,
            category_confidence: it.category_confidence,
            movement_kind: it.movement_kind ?? "transaction",
            // Contexto de origem propaga: só preenche se o item não tem já um match forte por hint
            account_id: it.credit_card_id ? null : (it.account_id ?? srcCtx.source_account_id ?? null),
            credit_card_id: it.account_id ? null : (it.credit_card_id ?? srcCtx.source_credit_card_id ?? null),
            installments_total: installments.total,
            installment_number: installments.current,
            installment_inferred: installments.inferred,
            statement_item_kind: statementItemKind,
            statement_section: (it as { statement_section?: string | null }).statement_section ?? null,
            is_future_installment: (it as { is_future_installment?: boolean }).is_future_installment ?? false,
            purchase_date: it.purchase_date,
            competence_date: documentKind === "invoice"
              ? (
                  invoice?.competence
                  ?? (invoice?.due_date ? `${invoice.due_date.slice(0, 7)}-01` : null)
                  ?? it.competence_date
                )
              : it.competence_date,
            confidence: it.confidence,
            raw: it as unknown as Record<string, unknown>,
            status: effectiveHit ? "duplicate_suspect" : "needs_review",
            duplicate_of: hit?.transaction_id ?? null,
            duplicate_reason: effectiveHit ? `${effectiveHit.strength}:${effectiveHit.reason}` : null,
          });

        }));


        // Quarantine: validate each row against DB whitelists BEFORE insert.
        // Valid → needs_review/duplicate_suspect. Invalid → NEVER hits extracted_items;
        // instead we log to `document_item_rejections` with a sanitized reason.
        const validRows: typeof rows = [];
        const rejections: Array<{ idx: number; code: string; field: string; excerpt: string; fields: Record<string, unknown> }> = [];
        for (const r of rows) {
          const v = validateExtractedRow(r);
          if (v.ok) validRows.push(v.row);
          else rejections.push({
            idx: Number(r.idx ?? -1),
            code: v.reason,
            field: v.field,
            excerpt: String(r.description ?? "").slice(0, 120),
            fields: {
              type: r.type ?? null,
              amount: typeof r.amount === "number" ? r.amount : null,
              occurred_at: r.occurred_at ?? null,
              movement_kind: r.movement_kind ?? null,
              payment_method: r.payment_method ?? null,
              installments_total: r.installments_total ?? null,
              installment_number: r.installment_number ?? null,
            },
          });
        }

        let persisted = 0;
        let insertErrorTag: string | null = null;
        if (validRows.length > 0) {
          const { error: itemsErr } = await sb.from("extracted_items").insert(validRows);
          if (!itemsErr) {
            persisted = validRows.length;
          } else {
            // Degrade to per-row insert to salvage what we can.
            for (const r of validRows) {
              const { error: perErr } = await sb.from("extracted_items").insert([r]);
              if (!perErr) persisted++;
              else rejections.push({
                idx: Number(r.idx ?? -1),
                code: "insert_error",
                field: "row",
                excerpt: String(r.description ?? "").slice(0, 120),
                fields: { message: String(perErr.message ?? "").slice(0, 80) },
              });
            }
            if (persisted === 0) insertErrorTag = `items_insert:${itemsErr.message}`.slice(0, 180);
          }
        }
        if (rejections.length > 0) {
          await sb.from("document_item_rejections").insert(rejections.map((r) => ({
            document_id: documentId,
            user_id: userId,
            item_index: r.idx,
            reason_code: r.code,
            reason_field: r.field,
            reason_message: `${r.code}:${r.field}`.slice(0, 200),
            offending_fields: r.fields,
            description_excerpt: r.excerpt,
          }))).then(() => {}, () => {});
        }

        if (persisted === 0 && rejections.length === 0 && insertErrorTag) {
          await finish({ status: "failed", model: visionModel, tokens_in, tokens_out, extraction_ms: ms, counters: failureCounters(counters), error: encodeError(insertErrorTag, correlationId) });
          return;
        }
        if (rejections.length > 0) counters.partial = true;

        idxOffset += rows.length;
        counters.total_items += persisted;
        counters.duplicate_strong += batchDupStrong;
        counters.duplicate_ambiguous += batchDupAmbiguous;
        counters.categorized_auto += batchCategorized;
        counters.uncategorized += Math.max(0, persisted - batchCategorized);
        counters.needs_review = Math.max(0, counters.total_items - counters.duplicate_strong - counters.duplicate_ambiguous);
        // Progress event
        await sb.from("document_processing_events").insert({
          document_id: documentId,
          user_id: userId,
          event_type: rejections.length > 0 ? "items_quarantined" : "fragment_completed",
          stage: `batch_${batchIndex}`,
          progress_current: batchIndex,
          progress_total: maxBatches,
          items_found: rows.length,
          items_valid: persisted,
          items_rejected: rejections.length,
          metadata: { batch: batchIndex },
        }).then(() => {}, () => {});

        await finish({
          status: "processing",
          document_kind: documentKind,
          model: visionModel,
          tokens_in,
          tokens_out,
          extraction_ms: ms,
          counters,
          error: null,
        });
      }

      // Fragmento processado (com ou sem itens): marca completed com métricas.
      await sb.from("document_fragments").update({
        status: "completed",
        items_found: (out.result.items ?? []).length,
        duplicates_found: batchDupStrong + batchDupAmbiguous,
        extraction_ms: Date.now() - fragmentStart,
        tokens_in: out.tokens_in,
        tokens_out: out.tokens_out,
        partial: out.partial,
        heartbeat_at: new Date().toISOString(),
      }).eq("document_id", documentId).eq("fragment_index", batchIndex).then(() => {}, () => {});
    }


    if (deterministicCoverage) {
      const gapMessage = coverageMessage(deterministicCoverage);
      if (gapMessage) {
        notes.push(gapMessage);
        counters.partial = true;
      }
      await sb.from("document_imports")
        .update({ invoice_coverage: deterministicCoverage })
        .eq("id", documentId).eq("user_id", userId).then(() => {}, () => {});
    }

    const finalStatus = counters.total_items === 0
      ? (lastErrorTag ? "failed" : "needs_review")
      : (counters.partial ? "partial" : "needs_review");

    // Período: metadata quando existe, senão inferido pelas datas dos itens
    // (evita o "Período — a —" na revisão).
    const { data: persistedDates } = await sb.from("extracted_items")
      .select("occurred_at").eq("document_id", documentId).eq("user_id", userId).limit(1000);
    const period = derivePeriod({
      metadata_start: statement?.period_start ?? null,
      metadata_end: statement?.period_end ?? null,
      dates: (persistedDates ?? []).map((r: { occurred_at: string | null }) => r.occurred_at),
    });
    const bankDoc = allowsBankBalance(documentKind);

    await finish({
      status: finalStatus,
      document_kind: documentKind,
      model: visionModel,
      tokens_in,
      tokens_out,
      extraction_ms: ms,
      user_instructions: (guidance ?? "").slice(0, 2000) || null,
      statement_opening_balance: bankDoc ? (statement?.opening_balance ?? null) : null,
      statement_closing_balance: bankDoc ? (statement?.closing_balance ?? null) : null,
      statement_balance_date: bankDoc ? (statement?.balance_date ?? null) : null,
      period_start: period.start,
      period_end: period.end,
      statement_period_start: period.start,
      statement_period_end: period.end,
      statement_bank: statement?.bank ?? null,

      counters: { ...counters, notes: notes.slice(0, 6), stopped_after_error: lastErrorTag ?? null },
      error: finalStatus === "failed" && lastErrorTag ? encodeError(lastErrorTag, correlationId) : null,
    });

    // Emit user-facing transition notifications idempotently
    const docCtx = { id: documentId, user_id: userId, source: doc.source, conversation_id: doc.conversation_id };
    if (finalStatus === "needs_review") {
      await notifyDocumentTransition(sb, docCtx, "review_ready",
        `Terminei de ler seu documento e encontrei ${counters.total_items} lançamento(s). Abra o app para revisar antes de registrar. ✅`);
      await notifyDocumentTransition(sb, docCtx, "processing_completed", null);
    } else if (finalStatus === "partial") {
      await notifyDocumentTransition(sb, docCtx, "partial_result_available",
        `Consegui ler parte do documento (${counters.total_items} lançamento(s)). Abra o app para revisar o que já capturei. Alguns itens ficaram fora e você pode reenviar por partes se quiser.`);
    } else if (finalStatus === "failed") {
      await notifyDocumentTransition(sb, docCtx, "processing_failed",
        "Tive dificuldade para concluir a leitura desse documento. Você pode reenviar ou tentar por partes.",
        { error_code: lastErrorTag ?? "unknown" });
    }
  } catch (e) {
    console.error(`[assistant-ingest cid=${correlationId}] processDocument crashed`, e);
    const safeError = `fetch_error:${(e as Error).message?.slice(0, 160) ?? "unknown"}`;
    // A late failure must not hide items that were already durably extracted.
    // Expose them for review instead of forcing the user to upload the same
    // document again (which also creates duplicate candidates).
    const { count: persistedCount } = await sb.from("extracted_items")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId)
      .eq("user_id", userId)
      .in("status", ["needs_review", "duplicate_suspect"]);
    const recoverable = Number(persistedCount ?? 0) > 0;
    await finish({
      status: recoverable ? "partial" : "failed",
      error: encodeError(safeError, correlationId),
      counters: { recovered_items: Number(persistedCount ?? 0), partial: recoverable },
    });
    try {
      const { data: doc2 } = await sb.from("document_imports").select("id,user_id,source,conversation_id").eq("id", documentId).maybeSingle();
      if (doc2) await notifyDocumentTransition(
        sb,
        doc2 as { id: string; user_id: string; source: string | null; conversation_id: string | null },
        recoverable ? "partial_result_available" : "processing_failed",
        recoverable
          ? `A leitura parou antes do fim, mas preservei ${Number(persistedCount ?? 0)} lançamento(s). Você já pode revisar o que foi encontrado.`
          : "Tive dificuldade para concluir a leitura desse documento. Você pode reenviar ou tentar por partes.",
        { error_code: safeError.split(":")[0], correlation_id: correlationId },
      );
    } catch { /* ignore */ }
  }
}

async function respondWithStatus(sb: ReturnType<typeof createClient>, documentId: string, userId: string, extra: Record<string, unknown> = {}, status = 200) {
  const { data: doc } = await sb.from("document_imports").select("*").eq("id", documentId).eq("user_id", userId).maybeSingle();
  if (!doc) return fail("not_found", { status: 404, functionName: FN });
  const { tag, correlation_id } = parseErrorTag(doc.error);
  const { data: items } = (doc.status === "needs_review" || doc.status === "partial")
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
  if (req.method !== "POST") return fail("method_not_allowed", { status: 405, functionName: FN });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("invalid_json", { status: 400, functionName: FN }); }
  const mode = String(body.mode ?? "");

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // === INTERNAL: server-triggered ingestion for WhatsApp inbound media ===
  // Bypasses user JWT via a service-role bearer. Never expose this mode from clients.
  if (mode === "process-inbound-media") {
    const auth = req.headers.get("Authorization") ?? "";
    if (auth.replace(/^Bearer\s+/i, "") !== SERVICE_ROLE) return fail("forbidden", { status: 403, functionName: FN });
    const document_id = String(body.document_id ?? "");
    const user_id = String(body.user_id ?? "");
    const guidance = String(body.guidance ?? "").slice(0, 500);
    if (!document_id || !user_id) return fail("missing_fields", { status: 400, functionName: FN });
    const { acquired, doc } = await acquireProcessingLock(sb, document_id, user_id);
    if (!doc) return fail("not_found", { status: 404, functionName: FN });
    if (!acquired) return json({ ok: true, status: doc.status, document_id }, 200);
    const correlationId = makeCorrelationId();
    console.log(`[assistant-ingest cid=${correlationId}] whatsapp-media document=${document_id} user=${user_id}`);
    const work = processDocument(document_id, user_id, guidance, correlationId);
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") EdgeRuntime.waitUntil(work);
    else work.catch((err) => console.error(`[assistant-ingest cid=${correlationId}] bg`, err));
    return json({ ok: true, status: "processing", document_id, correlation_id: correlationId }, 202);
  }

  const user = await getUser(req);
  if (!user) return fail("unauthorized", { status: 401, functionName: FN });

  // === CREATE UPLOAD ===
  if (mode === "create-upload") {
    const filename = String(body.filename ?? "upload");
    const mime_type = String(body.mime_type ?? "");
    const size_bytes = Number(body.size_bytes ?? 0);
    const conversation_id = (body.conversation_id as string | undefined) ?? null;

    if (!ALLOWED_MIME.has(mime_type)) return fail("mime_not_allowed", { status: 400, functionName: FN, details: { allowed: [...ALLOWED_MIME]} });
    if (!Number.isFinite(size_bytes) || size_bytes <= 0 || size_bytes > MAX_BYTES) return fail("size_out_of_range", { status: 400, functionName: FN, details: { max: MAX_BYTES} });

    const doc_id = crypto.randomUUID();
    const ext = mime_type === "application/pdf" ? "pdf" : mime_type === "image/png" ? "png" : mime_type === "image/webp" ? "webp" : "jpg";
    const storage_path = `${user.id}/${doc_id}.${ext}`;

    const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUploadUrl(storage_path);
    if (signErr || !signed) return fail("signed_url_failed", { status: 500, functionName: FN, details: { details: signErr?.message} });

    // Contexto de origem opcional. Usuário e cartão são mutuamente exclusivos.
    const bodySrcAcc = typeof body.source_account_id === "string" && body.source_account_id ? String(body.source_account_id) : null;
    const bodySrcCard = typeof body.source_credit_card_id === "string" && body.source_credit_card_id ? String(body.source_credit_card_id) : null;
    if (bodySrcAcc && bodySrcCard) return fail("conflicting_source", { status: 400, functionName: FN });

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
      source_account_id: bodySrcAcc,
      source_credit_card_id: bodySrcCard,
      source_context_method: bodySrcAcc || bodySrcCard ? "user_selected" : null,
      source_context_confidence: bodySrcAcc || bodySrcCard ? 1 : null,
      source_context_reason: bodySrcAcc || bodySrcCard ? "user_selected_on_upload" : null,
    });
    if (insErr) return fail("insert_failed", { status: 500, functionName: FN, details: { details: insErr.message} });


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
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const { data: doc } = await sb.from("document_imports")
      .select("id, storage_path, user_id")
      .eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return fail("not_found", { status: 404, functionName: FN });
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
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const correlationId = makeCorrelationId();
    const { data: doc } = await sb.from("document_imports")
      .select("id, status").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return fail("not_found", { status: 404, functionName: FN });
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
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    let guidance = String(body.guidance ?? "");
    if (mode === "reprocess") {
      const { data: prior } = await sb.from("document_imports").select("status,user_instructions,error")
        .eq("id", document_id).eq("user_id", user.id).maybeSingle();
      const priorTag = parseErrorTag((prior as { error?: string } | null)?.error).tag;
      const retryableFailure = prior?.status === "failed" && isTransientErrorTag(priorTag);
      if (!prior || (prior.status !== "rolled_back" && !retryableFailure)) {
        return fail("reprocess_not_allowed", { status: 409, functionName: FN, details: { user_message: "Só é possível reprocessar uma importação desfeita ou uma falha temporária."} });
      }
      guidance = guidance || String(prior.user_instructions ?? "");
      await sb.from("extracted_items").delete().eq("document_id", document_id).eq("user_id", user.id)
        .in("status", ["rolled_back","ignored","rejected","failed","duplicate_suspect","needs_review"]);
      await sb.from("document_imports").update({ status: "uploaded", error: null }).eq("id", document_id).eq("user_id", user.id);
    }

    const { acquired, doc } = await acquireProcessingLock(sb, document_id, user.id);
    if (!doc) return fail("not_found", { status: 404, functionName: FN });

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
    if (!document_id) return fail("missing_document_id", { status: 400, functionName: FN });
    const { data: doc } = await sb.from("document_imports").select("*").eq("id", document_id).eq("user_id", user.id).maybeSingle();
    if (!doc) return fail("not_found", { status: 404, functionName: FN });
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

  return fail("unknown_mode", { status: 400, functionName: FN });
});
