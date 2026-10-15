// recurring_detection.v1 — contas que se repetem, achadas nos próprios lançamentos.
// Só PROPÕE: nada vira regra sem o usuário confirmar. Conservador de propósito (assinatura, seguro, mensalidade,
// conta fixa) — compras do dia a dia (mercado, app de transporte) repetem muito por mês e ficam de fora.
import { brandOf, detectSubscriptions } from "./subscriptions";

export const RECURRING_DETECTION_VERSION = "recurring_detection.v1";

export type DetectionTx = {
  id: string;
  description: string | null;
  merchant_name?: string | null;
  normalized_description?: string | null;
  amount: number | string;
  occurred_at: string;
  type: "expense" | "income" | string;
  account_id?: string | null;
  category_id?: string | null;
  status?: string | null;
  movement_kind?: string | null;
  transfer_group_id?: string | null;
  settles_card_id?: string | null;
  superseded_by?: string | null;
  credit_card_id?: string | null;
  payment_method?: string | null;
};

export type ExistingRule = { name: string };

export type RecurringSuggestion = {
  key: string;
  name: string;
  kind: "expense" | "income";
  amount: number;
  day_of_month: number;
  account_id: string | null;
  category_id: string | null;
  months: number;
  occurrences: number;
  last_date: string;
  next_date: string;
  amount_varies: boolean;
  confidence: "alta" | "media";
  score: number;
  sample_ids: string[];
};

const MS_DAY = 86_400_000;
const norm = (t: string) => t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

const SUBSCRIPTION_HINT = /\b(netflix|spotify|disney|hbo|max|prime|amazon prime|youtube|apple|icloud|google one|globoplay|deezer|paramount|crunchyroll|adobe|microsoft|office|dropbox|chatgpt|openai|claude|notion|canva|gympass|wellhub|smartfit|academia|seguro|plano|mensalidade|assinatura|clube|anuidade|escola|faculdade|curso)\b/;
const UTILITY_HINT = /\b(luz|energia|enel|cpfl|light|sabesp|copasa|agua|gas|comgas|internet|vivo|claro|tim|oi|net|condominio|iptu|ipva|telefone|celular)\b/;
const INSTALLMENT = /\bparc(ela)?\s*\d+\s*(\/|de)\s*\d+|\b\d+\s*\/\s*\d+\b/;
const NOT_A_BILL = /\b(pix|transferencia|ted|doc|saque|resgate|aplicacao|rendimento|estorno|fatura|pagamento de fatura|pagamento de divida)\b/;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const ym = (iso: string) => iso.slice(0, 7);
const dayOf = (iso: string) => Number(iso.slice(8, 10));
const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
const addMonthsIso = (iso: string, n: number, day: number) => {
  const idx = monthIndex(iso) + n;
  const y = Math.floor((idx - 1) / 12), m = ((idx - 1) % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

export function detectRecurringSuggestions(input: {
  txs: DetectionTx[];
  today: string;
  existingRules?: ExistingRule[];
  dismissedKeys?: Iterable<string>;
}): RecurringSuggestion[] {
  const dismissed = new Set(input.dismissedKeys ?? []);
  const existing = new Set((input.existingRules ?? []).map((r) => norm(r.name)).filter(Boolean));
  const todayMs = Date.parse(`${input.today}T12:00:00Z`);
  const groups = new Map<string, DetectionTx[]>();

  for (const t of input.txs) {
    if (t.status && t.status !== "confirmed") continue;
    if (t.superseded_by || t.transfer_group_id || t.settles_card_id) continue;
    if (t.movement_kind && !["transaction", ""].includes(String(t.movement_kind))) continue;
    if (t.type !== "expense" && t.type !== "income") continue;
    const amount = Number(t.amount);
    if (!(amount > 0)) continue;
    const label = String(t.merchant_name || t.normalized_description || t.description || "");
    const key = norm(label);
    if (!key || key.length < 3 || NOT_A_BILL.test(key) || INSTALLMENT.test(String(t.description ?? "").toLowerCase())) continue;
    const gk = `${t.type}:${key}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(t);
  }

  const out: RecurringSuggestion[] = [];
  for (const [gk, rows] of groups) {
    if (dismissed.has(gk)) continue;
    const key = gk.slice(gk.indexOf(":") + 1);
    // marcas conhecidas (assinaturas) vêm da leitura por marca, mais completa (cartão + conta, nomes diferentes).
    if (brandOf({ description: rows[0].description, merchant_name: rows[0].merchant_name })) continue;
    if (existing.has(key) || [...existing].some((e) => e && (e === key || key.includes(e) || e.includes(key)) && Math.min(e.length, key.length) >= 5)) continue;
    rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

    const months = [...new Set(rows.map((r) => ym(r.occurred_at)))];
    if (months.length < 3) continue;
    // no máximo ~1 cobrança por mês (compras frequentes não são conta fixa)
    if (rows.length > months.length * 1.25) continue;
    // meses seguidos (tolera 1 buraco) e ainda ativa
    const idx = months.map((m) => monthIndex(`${m}-01`));
    let maxGap = 0;
    for (let i = 1; i < idx.length; i += 1) maxGap = Math.max(maxGap, idx[i] - idx[i - 1] - 1);
    if (maxGap > 1) continue;
    const last = rows[rows.length - 1].occurred_at.slice(0, 10);
    if ((todayMs - Date.parse(`${last}T12:00:00Z`)) / MS_DAY > 45) continue;

    const amounts = rows.map((r) => Number(r.amount));
    const amount = median(amounts);
    const cv = Math.sqrt(amounts.reduce((s, a) => s + (a - amount) ** 2, 0) / amounts.length) / amount;
    const days = rows.map((r) => dayOf(r.occurred_at));
    const dayMid = Math.round(median(days));
    const dayDev = Math.max(...days.map((d) => Math.min(Math.abs(d - dayMid), 31 - Math.abs(d - dayMid))));
    if (dayDev > 5) continue;

    const subscription = SUBSCRIPTION_HINT.test(key);
    const utility = UTILITY_HINT.test(key);
    const fixed = cv <= 0.04;
    if (!(cv <= 0.12) && !(utility && cv <= 0.45)) continue;

    const name = String(rows[rows.length - 1].merchant_name || rows[rows.length - 1].description || key).trim();
    let score = 0.35 + Math.min(months.length, 6) * 0.07 + (fixed ? 0.15 : 0) + (dayDev <= 2 ? 0.1 : 0) + (subscription || utility ? 0.12 : 0);
    score = Math.min(0.98, score);
    if (score < 0.62) continue;

    const mode = <T>(xs: T[]) => {
      const c = new Map<T, number>();
      for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
      return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const nextBase = addMonthsIso(last, 0, dayMid);
    const next = nextBase > input.today ? nextBase : addMonthsIso(last, 1, dayMid);
    out.push({
      key: gk,
      name: name.length > 40 ? name.slice(0, 40) : name,
      kind: rows[0].type as "expense" | "income",
      amount: Math.round(amount * 100) / 100,
      day_of_month: dayMid,
      account_id: mode(rows.map((r) => r.account_id ?? null)),
      category_id: mode(rows.map((r) => r.category_id ?? null)),
      months: months.length,
      occurrences: rows.length,
      last_date: last,
      next_date: next,
      amount_varies: !fixed,
      confidence: score >= 0.8 ? "alta" : "media",
      score: Math.round(score * 100) / 100,
      sample_ids: rows.slice(-3).map((r) => r.id),
    });
  }
  // Assinaturas por marca: ChatGPT/OpenAI, Apple, Spotify… mesmo com nome diferente a cada mês ou pago no cartão.
  const ruleBrands = new Set((input.existingRules ?? []).map((r) => brandOf({ description: r.name, merchant_name: null })?.name).filter(Boolean) as string[]);
  for (const sub of detectSubscriptions({ txs: input.txs, today: input.today }).active) {
    const gk = `expense:brand:${sub.name}`;
    if (dismissed.has(gk) || dismissed.has(`expense:${norm(sub.name)}`) || ruleBrands.has(sub.name)) continue;
    out.push({
      key: gk, name: sub.name, kind: "expense", amount: sub.monthly, day_of_month: sub.day_of_month,
      account_id: sub.account_id, category_id: sub.category_id, months: sub.months, occurrences: sub.months,
      last_date: sub.last_date, next_date: sub.next_date, amount_varies: sub.amount_varies,
      confidence: sub.months >= 3 ? "alta" : "media", score: sub.months >= 3 ? 0.9 : 0.75, sample_ids: sub.sample_ids,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.amount - a.amount).slice(0, 14);
}
