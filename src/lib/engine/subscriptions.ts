// subscriptions.v1 — o que o usuário paga todo mês em assinaturas (cartão E conta) e onde dá para economizar.
// Lê os próprios lançamentos: marca conhecida (Netflix, Spotify, ChatGPT/OpenAI, Apple…) agrupada por mês,
// com nomes bagunçados do banco ("PIX AUT EBANX", "Apple.com/billsao Paulo") reconhecidos pela marca.
// Só LÊ e orienta; não cria nada.
import type { DetectionTx } from "./recurringDetection";

export const SUBSCRIPTIONS_VERSION = "subscriptions.v1";

export type SubscriptionFamily = "video" | "musica" | "ia" | "nuvem" | "software" | "fitness" | "leitura" | "apple" | "outros";

type Brand = { name: string; family: SubscriptionFamily; re: RegExp };

// A ordem importa: a primeira que casar vence. Não inclui "Google" genérico nem "Google ADS" (anúncios, não assinatura).
const BRANDS: Brand[] = [
  { name: "ChatGPT / OpenAI", family: "ia", re: /\b(openai|chatgpt|chat gpt)\b/ },
  { name: "Claude / Anthropic", family: "ia", re: /\b(anthropic|claude)\b/ },
  { name: "Midjourney", family: "ia", re: /\bmidjourney\b/ },
  { name: "Cursor", family: "ia", re: /\bcursor\b/ },
  { name: "Netflix", family: "video", re: /\bnetflix|netfl\b/ },
  { name: "Amazon Prime", family: "video", re: /\bamazon\s*prime|prime\s*video\b/ },
  { name: "Disney+", family: "video", re: /\bdisney/ },
  { name: "Max (HBO)", family: "video", re: /\b(hbo|max\.com|\bmax\b)/ },
  { name: "Globoplay", family: "video", re: /\bgloboplay/ },
  { name: "Paramount+", family: "video", re: /\bparamount/ },
  { name: "Crunchyroll", family: "video", re: /\bcrunchyroll/ },
  { name: "YouTube Premium", family: "video", re: /\byoutube\s*(premium|music)?|google\s*youtube/ },
  { name: "Spotify", family: "musica", re: /\bspotify|\bpay dm sp\b/ },
  { name: "Deezer", family: "musica", re: /\bdeezer/ },
  { name: "Apple (assinaturas)", family: "apple", re: /\bapple(\.com)?\s*\/?\s*bill|\bapple\.com|\bitunes|\bicloud/ },
  { name: "Google One", family: "nuvem", re: /\bgoogle\s*(one|storage)/ },
  { name: "Dropbox", family: "nuvem", re: /\bdropbox/ },
  { name: "Notion", family: "software", re: /\bnotion\b/ },
  { name: "Canva", family: "software", re: /\bcanva/ },
  { name: "Adobe", family: "software", re: /\badobe/ },
  { name: "Microsoft 365", family: "software", re: /\bmicrosoft|\bmsft|office\s*365/ },
  { name: "GitHub", family: "software", re: /\bgithub/ },
  { name: "Duolingo", family: "software", re: /\bduolingo/ },
  { name: "Wellhub / Gympass", family: "fitness", re: /\b(gympass|wellhub|totalpass)/ },
  { name: "Academia", family: "fitness", re: /\b(smart\s*fit|smartfit|bluefit|bio\s*ritmo|academia)/ },
  { name: "Jornal / revista", family: "leitura", re: /\b(folha|estadao|globo\s*\+|the\s*economist|nyt|new york times|medium)\b/ },
];

const norm = (t: string) => t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "");
const NOT_SUBSCRIPTION = /\b(google\s*ads|ads\d|facebook\s*ads|meta\s*ads|pagamento de fatura|estorno)\b/;

export const FAMILY_LABEL: Record<SubscriptionFamily, string> = {
  video: "vídeo", musica: "música", ia: "IA", nuvem: "armazenamento", software: "aplicativos", fitness: "academia", leitura: "leitura", apple: "Apple", outros: "outros",
};

export function brandOf(tx: Pick<DetectionTx, "description" | "merchant_name" | "normalized_description">): Brand | null {
  const label = norm([tx.description, tx.merchant_name, tx.normalized_description].filter(Boolean).join(" | "));
  if (!label || NOT_SUBSCRIPTION.test(label)) return null;
  return BRANDS.find((b) => b.re.test(label)) ?? null;
}

export type Subscription = {
  key: string;
  name: string;
  family: SubscriptionFamily;
  /** Valor mensal típico (mediana dos últimos meses, somando cobranças do mês). */
  monthly: number;
  last_amount: number;
  months: number;
  last_date: string;
  channel: "cartão" | "conta" | "cartão e conta";
  amount_varies: boolean;
  /** Variação do último mês contra a média dos anteriores (%), quando há base. */
  price_change_pct: number | null;
  day_of_month: number;
  account_id: string | null;
  category_id: string | null;
  next_date: string;
  sample_ids: string[];
};

export type SubscriptionsResult = { active: Subscription[]; possibly_ended: Subscription[] };

const MS = 86_400_000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function detectSubscriptions(input: { txs: DetectionTx[]; today: string }): SubscriptionsResult {
  const todayMs = Date.parse(`${input.today}T12:00:00Z`);
  const byBrand = new Map<string, { brand: Brand; rows: DetectionTx[] }>();
  for (const t of input.txs) {
    if (t.status && t.status !== "confirmed") continue;
    if (t.superseded_by || t.transfer_group_id || t.settles_card_id) continue;
    if (t.type !== "expense" || !(Number(t.amount) > 0)) continue;
    if (t.movement_kind && !["transaction", ""].includes(String(t.movement_kind))) continue;
    const brand = brandOf(t);
    if (!brand) continue;
    const g = byBrand.get(brand.name) ?? { brand, rows: [] };
    g.rows.push(t);
    byBrand.set(brand.name, g);
  }

  const active: Subscription[] = [];
  const possibly_ended: Subscription[] = [];
  for (const { brand, rows } of byBrand.values()) {
    rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const perMonth = new Map<string, number>();
    for (const r of rows) perMonth.set(r.occurred_at.slice(0, 7), (perMonth.get(r.occurred_at.slice(0, 7)) ?? 0) + Number(r.amount));
    const months = [...perMonth.keys()].sort();
    if (months.length < 2) continue; // marca conhecida: 2 meses bastam
    const sums = months.map((m) => perMonth.get(m)!);
    const recent = sums.slice(-3);
    const monthly = median(recent);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const cv = mean > 0 ? Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length) / mean : 0;
    const prev = sums.slice(0, -1).slice(-3);
    const prevMean = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
    const change = prevMean && prevMean > 0 ? ((sums[sums.length - 1] - prevMean) / prevMean) * 100 : null;
    const cards = rows.filter((r) => Boolean(r.credit_card_id) || r.payment_method === "credit_card").length;
    const last = rows[rows.length - 1];
    const mode = <T,>(xs: T[]) => {
      const c = new Map<T, number>();
      for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
      return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const day = Math.round(median(rows.map((r) => Number(r.occurred_at.slice(8, 10)))));
    const lastDate = last.occurred_at.slice(0, 10);
    const [ly, lm] = [Number(lastDate.slice(0, 4)), Number(lastDate.slice(5, 7))];
    const nextMonthIdx = ly * 12 + lm; // mês seguinte ao da última cobrança (0-based em lm)
    const ny = Math.floor(nextMonthIdx / 12), nm = (nextMonthIdx % 12) + 1;
    const nextDay = Math.min(day, new Date(Date.UTC(ny, nm, 0)).getUTCDate());
    let next = `${ny}-${String(nm).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
    if (next <= input.today) {
      const k = nextMonthIdx + 1;
      const y2 = Math.floor(k / 12), m2 = (k % 12) + 1;
      next = `${y2}-${String(m2).padStart(2, "0")}-${String(Math.min(day, new Date(Date.UTC(y2, m2, 0)).getUTCDate())).padStart(2, "0")}`;
    }
    const sub: Subscription = {
      day_of_month: day,
      account_id: mode(rows.map((r) => r.account_id ?? null)),
      category_id: mode(rows.map((r) => r.category_id ?? null)),
      next_date: next,
      sample_ids: rows.slice(-3).map((r) => r.id),
      key: brand.name,
      name: brand.name,
      family: brand.family,
      monthly: r2(monthly),
      last_amount: r2(Number(last.amount)),
      months: months.length,
      last_date: last.occurred_at.slice(0, 10),
      channel: cards === 0 ? "conta" : cards === rows.length ? "cartão" : "cartão e conta",
      amount_varies: cv > 0.08,
      price_change_pct: change == null ? null : Math.round(change),
    };
    const daysSince = (todayMs - Date.parse(`${sub.last_date}T12:00:00Z`)) / MS;
    (daysSince <= 50 ? active : possibly_ended).push(sub);
  }
  active.sort((a, b) => b.monthly - a.monthly);
  possibly_ended.sort((a, b) => b.monthly - a.monthly);
  return { active, possibly_ended };
}

export type SubscriptionInsights = {
  count: number;
  monthly_total: number;
  annual_total: number;
  income_share_pct: number | null;
  largest: Subscription | null;
  overlaps: Array<{ family: SubscriptionFamily; label: string; names: string[]; monthly: number; savings_if_keep_one: number }>;
  price_ups: Subscription[];
  max_savings_month: number;
  lines: string[];
};

const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

export function subscriptionInsights(subs: Subscription[], monthlyIncome: number | null): SubscriptionInsights {
  const monthly_total = r2(subs.reduce((s, x) => s + x.monthly, 0));
  const largest = subs[0] ?? null;
  const overlaps: SubscriptionInsights["overlaps"] = [];
  for (const family of ["video", "musica", "ia", "nuvem", "software", "fitness", "leitura"] as SubscriptionFamily[]) {
    const group = subs.filter((s) => s.family === family);
    if (group.length < 2) continue;
    const total = group.reduce((s, x) => s + x.monthly, 0);
    const top = Math.max(...group.map((x) => x.monthly));
    overlaps.push({ family, label: FAMILY_LABEL[family], names: group.map((g) => g.name), monthly: r2(total), savings_if_keep_one: r2(total - top) });
  }
  const price_ups = subs.filter((s) => s.price_change_pct != null && s.price_change_pct >= 10);
  const max_savings_month = r2(overlaps.reduce((s, o) => s + o.savings_if_keep_one, 0));
  const income_share_pct = monthlyIncome && monthlyIncome > 0 ? Math.round((monthly_total / monthlyIncome) * 1000) / 10 : null;

  const lines: string[] = [];
  if (largest && subs.length > 1) lines.push(`A maior é ${largest.name}: ${brl(largest.monthly)}/mês (${Math.round((largest.monthly / monthly_total) * 100)}% do total).`);
  for (const o of overlaps) lines.push(`${o.names.length} serviços de ${o.label} (${o.names.join(", ")}) somam ${brl(o.monthly)}/mês. Ficando com um só, você liberaria até ${brl(o.savings_if_keep_one)}/mês — não sei qual você mais usa, essa escolha é sua.`);
  for (const p of price_ups.slice(0, 2)) {
    lines.push((p.price_change_pct ?? 0) <= 100
      ? `${p.name} subiu ${p.price_change_pct}% no último mês (${brl(p.last_amount)}).`
      : `${p.name} teve uma cobrança bem acima do normal no último mês (${brl(p.last_amount)}): vale conferir se entrou algo novo.`);
  }
  if (income_share_pct != null && income_share_pct >= 3) lines.push(`Assinaturas pesam ${String(income_share_pct).replace(".", ",")}% da sua renda mensal.`);
  return { count: subs.length, monthly_total, annual_total: r2(monthly_total * 12), income_share_pct, largest, overlaps, price_ups, max_savings_month, lines };
}
