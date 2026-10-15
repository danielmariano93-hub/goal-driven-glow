// split_receipt_reader.v1 — lê o comprovante de pagamento (imagem/PDF) que o participante mandou no WhatsApp.
// Só LÊ e compara; nunca dá baixa. O organizador continua confirmando. Falha de leitura nunca derruba o fluxo:
// sem leitura, o comprovante segue arquivado e o relato do participante vale como antes.

export type ReceiptRead = {
  is_payment_receipt: boolean;
  amount: number | null;
  paid_at: string | null; // YYYY-MM-DD
  payer: string | null;
  payee: string | null;
  institution: string | null;
  confidence: "alta" | "media" | "baixa";
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Aceita o JSON do modelo (às vezes embrulhado em texto/markdown) e normaliza. */
export function parseReceiptJson(text: string): ReceiptRead | null {
  const match = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: any;
  try { raw = JSON.parse(match[0]); } catch { return null; }
  const amountNum = typeof raw.amount === "number" ? raw.amount : Number(String(raw.amount ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  const amount = Number.isFinite(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) / 100 : null;
  const dateRaw = String(raw.paid_at ?? raw.date ?? "").trim();
  let paid_at: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) paid_at = dateRaw.slice(0, 10);
  else {
    const br = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) paid_at = `${br[3]}-${br[2]}-${br[1]}`;
  }
  const str = (v: unknown) => { const t = String(v ?? "").trim(); return t ? t.slice(0, 80) : null; };
  const conf = String(raw.confidence ?? "").toLowerCase();
  return {
    is_payment_receipt: raw.is_payment_receipt !== false && (amount !== null || raw.is_payment_receipt === true),
    amount, paid_at,
    payer: str(raw.payer), payee: str(raw.payee), institution: str(raw.institution),
    confidence: conf.startsWith("alt") || conf === "high" ? "alta" : conf.startsWith("bai") || conf === "low" ? "baixa" : "media",
  };
}

export type ReceiptVerdict = "matches" | "amount_differs" | "no_amount" | "not_a_receipt";

export function compareReceipt(read: ReceiptRead | null, remaining: number): ReceiptVerdict | null {
  if (!read) return null;
  if (!read.is_payment_receipt && read.confidence !== "baixa") return "not_a_receipt";
  if (read.amount === null) return "no_amount";
  return Math.abs(read.amount - remaining) <= 0.05 ? "matches" : "amount_differs";
}

/** Frase curta com o que foi lido, para o organizador e para o participante. */
export function describeReceipt(read: ReceiptRead): string {
  const parts = [
    read.amount !== null ? BRL.format(read.amount) : null,
    read.paid_at ? `em ${fmtDate(read.paid_at)}` : null,
    read.payee ? `para ${read.payee}` : null,
    read.institution ? `(${read.institution})` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

const PROMPT = `Você lê comprovantes de pagamento brasileiros (Pix, TED, boleto). Responda APENAS um JSON:
{"is_payment_receipt":boolean,"amount":number|null,"paid_at":"YYYY-MM-DD"|null,"payer":string|null,"payee":string|null,"institution":string|null,"confidence":"alta"|"media"|"baixa"}
amount é o valor pago (número, ponto decimal). Não invente: use null quando não estiver legível. Se a imagem não for um comprovante, is_payment_receipt=false.`;

/** Leitura com visão. Devolve null quando a IA está indisponível ou a leitura falha. */
export async function readPaymentReceipt(
  sb: any,
  file: { bytes: Uint8Array; mime_type: string; filename?: string },
): Promise<ReceiptRead | null> {
  try {
    const [{ resolveAiProvider, aiEndpoint, aiJsonHeaders, normalizeAiModel }, { getAiBlock }] = await Promise.all([
      import("../ai-runtime.ts"),
      import("../aiCircuit.ts"),
    ]);
    const provider = resolveAiProvider();
    if (!provider) return null;
    if (await getAiBlock(sb)) return null;
    const env = (globalThis as any).Deno?.env;
    let model = String(env?.get?.("NINO_AI_VISION_MODEL") ?? "").trim();
    if (!model) {
      const { data } = await sb.from("ai_model_routes").select("primary_model").eq("task", "vision").eq("active", true).maybeSingle();
      model = String(data?.primary_model ?? "").trim();
    }
    if (!model) return null;
    const dataUrl = bytesToDataUrl(file.bytes, file.mime_type);
    const content = [
      { type: "text", text: PROMPT },
      file.mime_type === "application/pdf"
        ? { type: "file", file: { filename: file.filename || "comprovante.pdf", file_data: dataUrl } }
        : { type: "image_url", image_url: { url: dataUrl } },
    ];
    const res = await fetch(aiEndpoint(provider, "chat/completions"), {
      method: "POST",
      headers: aiJsonHeaders(provider),
      body: JSON.stringify({
        model: normalizeAiModel(model, provider),
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
        max_tokens: 400,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return parseReceiptJson(String(data?.choices?.[0]?.message?.content ?? ""));
  } catch (error) {
    console.warn("[split_receipt] read_failed", String((error as Error)?.message ?? error).slice(0, 120));
    return null;
  }
}
