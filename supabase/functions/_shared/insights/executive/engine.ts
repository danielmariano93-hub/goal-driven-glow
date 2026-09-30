// Nino Executive Insights (`nino_executive_insights.v1`)
//
// Leitura executiva das finanças pessoais — o mesmo rigor de um comitê de
// resultados de banco: primeiro o resultado (quanto entrou × quanto saiu), depois
// o que mudou de forma estrutural, o que puxa o número e o que fazer a respeito.
//
// Princípios (não negociáveis):
// - Verdade canônica: competência de relatório (compra no cartão pertence ao mês
//   da fatura), estornos abatendo a despesa original, transferências, fatura e
//   investimentos fora do consumo. O motor recebe o livro já normalizado.
// - Mês contra padrão, nunca contra UM mês: o padrão é a MEDIANA dos meses
//   anteriores. Um aluguel pago no dia 31 em vez do dia 30 não vira "Moradia foi
//   de R$ 0 a R$ 3 mil" (bug do motor antigo, que comparava janelas de dias).
// - Materialidade: só vira insight o que muda o resultado em reais (R$/mês e
//   R$/ano) e passa de um piso absoluto e relativo à renda/gasto da pessoa.
// - Uma causa, um insight: deduplicação pela causa-raiz (categoria/estabelecimento).
// - Acionável: todo insight termina numa ação concreta com efeito estimado.
// - Nenhum jargão interno (score, confiança, amostras) chega ao texto.
//
// Módulo puro: sem I/O, sem Deno/Node, testável no app e no edge.
import { brl, compact, joinPt, monthName, monthNameCap, monthShort, pct, plural, signedCompact } from "./format.ts";

export const EXECUTIVE_INSIGHTS_VERSION = "nino_executive_insights.v1";

export type LedgerEntry = {
  id: string;
  /** Competência canônica (YYYY-MM-DD). */
  date: string;
  kind: "expense" | "income";
  /** Despesa: consumo (estorno negativo). Receita: valor positivo. */
  amount: number;
  category_id: string | null;
  category: string;
  merchant_key: string | null;
  merchant: string | null;
};

export type ExecutiveInput = {
  as_of: string;
  entries: LedgerEntry[];
  /** Parcelas de cartão já contratadas para os próximos meses (competência YYYY-MM). */
  future_installments?: Array<{ month: string; amount: number }>;
};

export type InsightKind =
  | "cashflow"
  | "month_vs_typical"
  | "structural_trend"
  | "price_increase"
  | "new_recurring"
  | "usage_concentration"
  | "recurring_costs"
  | "installments_ahead"
  | "unusual_charge"
  | "income_volatility";

export type InsightAction =
  | { type: "ask"; label: string; prompt: string; detail: string | null }
  | { type: "route"; label: string; route: string; detail: string | null };

export type ExecutiveInsight = {
  /** Causa-raiz (deduplicação e feedback): "cashflow", "category:<id>", "merchant:<key>". */
  key: string;
  kind: InsightKind;
  direction: "worse" | "better" | "neutral";
  severity: "critical" | "attention" | "positive" | "info";
  section: "agora" | "mudancas" | "aprendizados";
  headline: string;
  why: string;
  evidence: string[];
  action: InsightAction | null;
  /** Efeito no resultado mensal, em reais (sempre positivo). */
  impact_monthly: number;
  score: number;
};

export type ExecutiveKpi = { label: string; value: string; hint: string | null; tone: "good" | "bad" | "neutral" };

export type ExecutiveBriefing = {
  version: typeof EXECUTIVE_INSIGHTS_VERSION;
  as_of: string;
  /** Mês de referência da leitura (fechado ou praticamente fechado). */
  reference_month: string;
  kpis: ExecutiveKpi[];
  insights: ExecutiveInsight[];
  coverage: { months_of_history: number; income_reliable: boolean; learning: boolean };
};

// ---------------------------------------------------------------------------
// Aritmética de meses e estatística robusta
// ---------------------------------------------------------------------------

const ym = (date: string) => date.slice(0, 7);
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 60; m = addMonths(m, 1)) out.push(m);
  return out;
}
export function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Recorrente = aparece quase todo mês com valor estável (dispersão robusta baixa). */
function isStable(values: number[], minPresent: number): boolean {
  const present = values.filter((v) => v > 0);
  if (present.length < minPresent) return false;
  const med = median(present);
  if (med <= 0) return false;
  const mad = median(present.map((v) => Math.abs(v - med)));
  // Degrau (R$ 80 → R$ 1.400) não é estabilidade, mesmo com mediana parada.
  const withinBand = present.every((v) => v <= 1.8 * med && v >= 0.5 * med);
  return mad / med <= 0.3 && withinBand;
}

// ---------------------------------------------------------------------------
// Estabelecimentos: unificação de chaves ("Lovablelovable.devus" = "Lovable")
// ---------------------------------------------------------------------------

export function unifyMerchantKeys(keys: Array<{ key: string; label: string }>): Map<string, { key: string; label: string }> {
  const compactKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const uniques = [...new Map(keys.map((k) => [k.key, k])).values()]
    .sort((a, b) => compactKey(a.key).length - compactKey(b.key).length);
  const canon: Array<{ c: string; key: string; label: string }> = [];
  const out = new Map<string, { key: string; label: string }>();
  for (const item of uniques) {
    const c = compactKey(item.key);
    const hit = canon.find((existing) => existing.c === c || (existing.c.length >= 5 && c.startsWith(existing.c)));
    if (hit) {
      out.set(item.key, { key: hit.key, label: hit.label });
    } else {
      canon.push({ c, key: item.key, label: item.label });
      out.set(item.key, { key: item.key, label: item.label });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Livro mensal
// ---------------------------------------------------------------------------

type MerchantBook = {
  label: string;
  months: Map<string, number>;
  counts: Map<string, number>;
  charges: Array<{ month: string; amount: number; date: string }>;
  categories: Map<string, number>;
};

type Book = {
  months: string[];
  spend: Map<string, number>;
  income: Map<string, number>;
  byCategory: Map<string, { name: string; id: string | null; months: Map<string, number> }>;
  byMerchant: Map<string, MerchantBook>;
};

function buildBook(entries: LedgerEntry[], months: string[]): Book {
  const inWindow = new Set(months);
  const book: Book = { months, spend: new Map(), income: new Map(), byCategory: new Map(), byMerchant: new Map() };
  const merchantMap = unifyMerchantKeys(entries
    .filter((e) => e.kind === "expense" && e.merchant_key)
    .map((e) => ({ key: e.merchant_key!, label: e.merchant ?? e.merchant_key! })));
  for (const e of entries) {
    const m = ym(e.date);
    if (!inWindow.has(m)) continue;
    if (e.kind === "income") {
      book.income.set(m, (book.income.get(m) ?? 0) + e.amount);
      continue;
    }
    book.spend.set(m, (book.spend.get(m) ?? 0) + e.amount);
    const catKey = e.category_id ?? `name:${e.category}`;
    const cat = book.byCategory.get(catKey) ?? { name: e.category, id: e.category_id, months: new Map() };
    cat.months.set(m, (cat.months.get(m) ?? 0) + e.amount);
    book.byCategory.set(catKey, cat);
    if (e.merchant_key) {
      const unified = merchantMap.get(e.merchant_key) ?? { key: e.merchant_key, label: e.merchant ?? e.merchant_key };
      const mer: MerchantBook = book.byMerchant.get(unified.key)
        ?? { label: unified.label, months: new Map(), counts: new Map(), charges: [], categories: new Map() };
      mer.months.set(m, (mer.months.get(m) ?? 0) + e.amount);
      if (e.amount > 0) {
        mer.counts.set(m, (mer.counts.get(m) ?? 0) + 1);
        mer.charges.push({ month: m, amount: e.amount, date: e.date });
      }
      mer.categories.set(e.category, (mer.categories.get(e.category) ?? 0) + e.amount);
      book.byMerchant.set(unified.key, mer);
    }
  }
  return book;
}

const monthsOf = (map: Map<string, number>, months: string[]) => months.map((m) => r2(map.get(m) ?? 0));

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORY = /^(sem categoria|outros)$/i;

export function computeExecutiveInsights(input: ExecutiveInput): ExecutiveBriefing {
  const asOf = input.as_of.slice(0, 10);
  const current = ym(asOf);
  const day = Number(asOf.slice(8, 10));
  const closing = day >= daysInMonth(current) - 2;
  // Mês de referência: o atual se já está praticamente fechado; senão o último fechado.
  const ref = closing ? current : addMonths(current, -1);
  const firstMonth = input.entries.reduce<string | null>((min, e) => (!min || ym(e.date) < min ? ym(e.date) : min), null) ?? ref;

  const recent3 = range(addMonths(ref, -2), ref);
  const prior3 = range(addMonths(ref, -5), addMonths(ref, -3)).filter((m) => m >= firstMonth);
  const baseline6 = range(addMonths(ref, -6), addMonths(ref, -1)).filter((m) => m >= firstMonth);
  const window12 = range(addMonths(ref, -11), current);
  const book = buildBook(input.entries, window12);

  const monthsOfHistory = range(firstMonth, ref).length;
  const incomeMonths = recent3.filter((m) => (book.income.get(m) ?? 0) > 0).length;
  const incomeReliable = incomeMonths >= 2;
  const typicalSpend = median(monthsOf(book.spend, baseline6));
  const typicalIncome = median(monthsOf(book.income, range(addMonths(ref, -5), ref).filter((m) => m >= firstMonth)).filter((v) => v > 0));
  // Referência de materialidade: o maior entre renda típica e gasto típico.
  const scale = Math.max(typicalIncome, typicalSpend, 1);
  const insights: ExecutiveInsight[] = [];
  const score = (impactMonthly: number, weight: number) =>
    Math.round(100 * Math.min(1, impactMonthly / (0.12 * scale)) * weight * Math.min(1, monthsOfHistory / 4));

  // Compromissos fixos: estabelecimento com UMA cobrança por mês e valor estável
  // (aluguel, contas, assinaturas, crediário) — não "gasto frequente" como Uber.
  const fixedWindow = [...baseline6, ref];
  const fixedCommitments = [...book.byMerchant.entries()].flatMap(([key, mer]) => {
    const values = monthsOf(mer.months, fixedWindow);
    const presentMonths = fixedWindow.filter((m) => (mer.counts.get(m) ?? 0) > 0);
    if (presentMonths.length < Math.min(4, fixedWindow.length)) return [];
    const chargesPerMonth = sum(presentMonths.map((m) => mer.counts.get(m) ?? 0)) / presentMonths.length;
    if (chargesPerMonth > 1.5 || !isStable(values, Math.min(4, fixedWindow.length))) return [];
    return [{ key, label: mer.label, typical: median(values.filter((v) => v > 0)) }];
  }).sort((a, b) => b.typical - a.typical);

  // 1) Resultado: quanto entrou × quanto saiu nos últimos 3 meses -------------
  const income3 = sum(monthsOf(book.income, recent3));
  const spend3 = sum(monthsOf(book.spend, recent3));
  const net3 = income3 - spend3;
  if (incomeReliable && income3 > 0) {
    const perMonth = recent3.map((m) => {
      const inc = book.income.get(m) ?? 0;
      const sp = book.spend.get(m) ?? 0;
      return `${monthNameCap(m)}: entrou ${compact(inc)}, saiu ${compact(sp)} (${signedCompact(inc - sp)})`;
    });
    if (net3 < 0 && -net3 >= Math.max(500, 0.05 * spend3)) {
      const monthly = -net3 / 3;
      insights.push({
        key: "cashflow",
        kind: "cashflow",
        direction: "worse",
        severity: -net3 >= 0.15 * income3 ? "critical" : "attention",
        section: "agora",
        headline: `Nos últimos 3 meses você gastou ${compact(-net3)} a mais do que recebeu`,
        why: `É um déficit médio de ${compact(monthly)} por mês. Mantido esse ritmo, são ${compact(monthly * 12)} em um ano saindo das reservas ou virando dívida.`,
        evidence: perMonth,
        action: { type: "ask", label: "Montar plano para equilibrar", prompt: "Monte um plano para eu equilibrar meus gastos com a minha renda nos próximos meses", detail: null },
        impact_monthly: r2(monthly),
        score: score(monthly, 1.3),
      });
    } else if (net3 > 0 && net3 / income3 >= 0.1) {
      const rate = net3 / income3;
      insights.push({
        key: "cashflow",
        kind: "cashflow",
        direction: "better",
        severity: "positive",
        section: "agora",
        headline: `Você guardou ${pct(rate)} do que recebeu nos últimos 3 meses`,
        why: `Sobraram ${compact(net3)} (${compact(net3 / 3)} por mês). Acima de 10% da renda é um ritmo saudável; em um ano isso vira ${compact(net3 * 4)}.`,
        evidence: perMonth,
        action: { type: "route", label: "Dar destino à sobra", route: "/app/metas", detail: "Uma meta evita que a sobra se dilua no mês seguinte." },
        impact_monthly: r2(net3 / 3),
        score: score(net3 / 3, 0.9),
      });
    }
  }

  // 2) Mês de referência contra o padrão ---------------------------------------
  const catDelta = (m: string) => [...book.byCategory.entries()]
    .filter(([, cat]) => !EXCLUDED_CATEGORY.test(cat.name))
    .map(([key, cat]) => {
      const value = cat.months.get(m) ?? 0;
      const typical = median(monthsOf(cat.months, baseline6));
      return { key, name: cat.name, id: cat.id, value, typical, delta: value - typical };
    });
  if (baseline6.length >= 3 && typicalSpend > 0) {
    const value = book.spend.get(ref) ?? 0;
    const diff = value - typicalSpend;
    if (Math.abs(diff) >= Math.max(300, 0.12 * typicalSpend)) {
      const worse = diff > 0;
      const drivers = catDelta(ref)
        .filter((c) => (worse ? c.delta > 0 : c.delta < 0) && Math.abs(c.delta) >= 100)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3);
      const verb = closing && ref === current ? "está fechando" : "fechou";
      insights.push({
        key: "month",
        kind: "month_vs_typical",
        direction: worse ? "worse" : "better",
        severity: worse ? "attention" : "positive",
        section: "mudancas",
        headline: `${monthNameCap(ref)} ${verb} em ${compact(value)}, ${pct(Math.abs(diff) / typicalSpend)} ${worse ? "acima" : "abaixo"} do seu padrão`,
        why: `Seu padrão é ${compact(typicalSpend)} por mês (mediana dos últimos ${baseline6.length} meses).${
          drivers.length ? ` A diferença vem principalmente de ${joinPt(drivers.map((d) => d.name))}.` : ""}`,
        evidence: drivers.map((d) => `${d.name}: ${brl(d.value)} (padrão ${brl(d.typical)}, ${signedCompact(d.delta)})`),
        action: worse
          ? { type: "ask", label: "Onde dá para cortar", prompt: `Onde eu consigo cortar gastos considerando o que subiu em ${monthName(ref)}?`, detail: null }
          : { type: "route", label: "Guardar a diferença", route: "/app/metas", detail: `${compact(-diff)} abaixo do padrão podem ir para uma meta.` },
        impact_monthly: r2(Math.abs(diff)),
        score: score(Math.abs(diff), 0.85),
      });
    }
  }

  // 3) Mudanças estruturais por categoria (3 meses contra os 3 anteriores) -----
  if (prior3.length >= 2) {
    for (const [key, cat] of book.byCategory.entries()) {
      if (EXCLUDED_CATEGORY.test(cat.name)) continue;
      const recentValues = monthsOf(cat.months, recent3);
      const priorValues = monthsOf(cat.months, prior3);
      const r = median(recentValues);
      const p = median(priorValues);
      const change = r - p;
      // Mudança estrutural exige um NOVO nível consistente (não um mês atípico).
      const consistent = Math.min(...recentValues) >= 0.5 * r && Math.max(...recentValues) <= 2 * r;
      const rising = consistent && change >= 150 && r >= 1.25 * p && Math.min(...recentValues) > p;
      const falling = -change >= 150 && r <= 0.75 * p && Math.max(...recentValues) < p;
      if (!rising && !falling) continue;

      // Estabelecimento que explica a mudança.
      const merchantShift = [...book.byMerchant.values()]
        .filter((mer) => (mer.categories.get(cat.name) ?? 0) > 0)
        .map((mer) => ({
          label: mer.label,
          delta: median(monthsOf(mer.months, recent3)) - median(monthsOf(mer.months, prior3)),
        }))
        .filter((mer) => (rising ? mer.delta > 0 : mer.delta < 0))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      const driverShare = merchantShift ? Math.min(1, Math.abs(merchantShift.delta) / Math.abs(change)) : 0;
      const series = range(addMonths(ref, -5), ref).filter((m) => m >= firstMonth)
        .map((m) => `${monthShort(m)} ${compact(cat.months.get(m) ?? 0)}`).join(" · ");
      const evidence = [series];
      if (merchantShift && driverShare >= 0.4) {
        evidence.push(`${merchantShift.label} responde por ${pct(driverShare)} da ${rising ? "alta" : "queda"}`);
      }
      const monthly = Math.abs(change);
      insights.push({
        key: `category:${key}`,
        kind: "structural_trend",
        direction: rising ? "worse" : "better",
        severity: rising ? "attention" : "positive",
        section: "mudancas",
        headline: rising
          ? (p < 100
            ? `${cat.name} saltou de ${compact(p)} para ${compact(r)} por mês`
            : `${cat.name} está em alta há 3 meses: ${compact(r)} por mês contra ${compact(p)} antes`)
          : `${cat.name} caiu de ${compact(p)} para ${compact(r)} por mês`,
        why: rising
          ? `São ${compact(monthly)} a mais por mês — ${compact(monthly * 12)} por ano se continuar.`
          : `Isso libera ${compact(monthly)} por mês (${compact(monthly * 12)} por ano) no seu orçamento.`,
        evidence,
        action: rising
          ? (merchantShift && driverShare >= 0.7
            // Um estabelecimento explica a alta: a decisão é sobre ele, não sobre a categoria.
            ? { type: "ask", label: `Analisar ${merchantShift.label}`, prompt: `Quanto eu gastei com ${merchantShift.label} por mês e em quantas cobranças?`, detail: null }
            : { type: "route", label: `Definir limite para ${cat.name}`, route: "/app/metas", detail: `Sugestão: teto de ${compact(Math.round((p + change / 2) / 50) * 50)} por mês, no meio do caminho entre antes e agora.` })
          : { type: "route", label: "Direcionar a sobra", route: "/app/metas", detail: `${compact(monthly)} por mês podem ir para uma meta.` },
        impact_monthly: r2(monthly),
        score: score(monthly, rising ? 1.0 : 0.8),
      });
    }
  }

  // 4) Estabelecimentos: reajuste, novo recorrente e uso concentrado -----------
  const last4 = range(addMonths(ref, -3), ref);
  const total3 = sum(recent3.map((m) => book.spend.get(m) ?? 0));
  for (const [key, mer] of book.byMerchant.entries()) {
    const values = monthsOf(mer.months, last4);
    const present = values.filter((v) => v > 0).length;
    const counts = last4.map((m) => mer.counts.get(m) ?? 0);
    const refValue = mer.months.get(ref) ?? 0;
    const prevValues = monthsOf(mer.months, baseline6).filter((v) => v > 0);
    const avgCharges = sum(counts) / Math.max(1, counts.filter((c) => c > 0).length);
    const recent3Values = monthsOf(mer.months, recent3);
    const monthlyAvg = sum(recent3Values) / 3;

    // Reajuste de assinatura: cobrança mensal única que subiu.
    const refCharges = mer.charges.filter((c) => c.month === ref);
    const subscriptionLike = present >= 3 && avgCharges <= 1.5 && refCharges.length === 1;
    const prevTypical = median(prevValues);
    if (subscriptionLike && prevValues.length >= 2 && refValue >= prevTypical * 1.15 && refValue - prevTypical >= 15) {
      const up = refValue - prevTypical;
      insights.push({
        key: `merchant:${key}`,
        kind: "price_increase",
        direction: "worse",
        severity: "attention",
        section: "mudancas",
        headline: `${mer.label} subiu de ${brl(prevTypical)} para ${brl(refValue)} por mês`,
        why: `São ${brl(up)} a mais por mês, ${compact(up * 12)} por ano. Vale conferir se mudou de plano ou se é reajuste.`,
        evidence: [last4.map((m) => `${monthShort(m)} ${brl(mer.months.get(m) ?? 0)}`).join(" · ")],
        action: { type: "ask", label: "Revisar assinaturas", prompt: "Liste minhas assinaturas e quanto cada uma custa por mês", detail: null },
        impact_monthly: r2(up),
        score: score(up, 0.9) + 15,
      });
      continue;
    }

    // Gasto recorrente novo: não existia antes da janela recente e agora é mensal.
    const firstSeen = mer.charges.reduce<string | null>((min, c) => (!min || c.month < min ? c.month : min), null);
    const isNew = !!firstSeen && firstSeen >= recent3[0] && recent3Values.every((v) => v > 0);
    const heavyUse = avgCharges >= 4 && monthlyAvg >= 300 && total3 > 0 && (monthlyAvg * 3) / total3 >= 0.05;
    // Recorrente = uma cobrança por mês com valor estável (assinatura, serviço),
    // não um mercado ou loja frequentados.
    const newSubscription = isNew && avgCharges <= 1.5 && isStable(recent3Values, 3) && monthlyAvg >= 50;
    if (newSubscription && !heavyUse) {
      insights.push({
        key: `merchant:${key}`,
        kind: "new_recurring",
        direction: "worse",
        severity: "info",
        section: "mudancas",
        headline: `Novo gasto recorrente: ${mer.label}, ${compact(monthlyAvg)} por mês`,
        why: `Começou em ${monthName(firstSeen!)} e se repetiu todos os meses desde então. Em um ano, são ${compact(monthlyAvg * 12)}.`,
        evidence: [recent3.map((m) => `${monthShort(m)} ${brl(mer.months.get(m) ?? 0)}`).join(" · ")],
        action: { type: "ask", label: "Revisar recorrentes", prompt: "Liste meus gastos recorrentes e quanto cada um custa por mês", detail: null },
        impact_monthly: r2(monthlyAvg),
        score: score(monthlyAvg, 0.7),
      });
      continue;
    }

    // Uso concentrado: muitas cobranças no mesmo lugar, peso relevante no variável.
    if (heavyUse && present >= 2) {
      const share = (monthlyAvg * 3) / total3;
      const refCount = mer.counts.get(ref) ?? 0;
      const ticket = refCount ? refValue / refCount : monthlyAvg / Math.max(1, avgCharges);
      const saving = monthlyAvg * 0.25;
      insights.push({
        key: `merchant:${key}`,
        kind: "usage_concentration",
        direction: "neutral",
        severity: "info",
        section: "aprendizados",
        headline: `${mer.label} leva ${pct(share)} de tudo o que você gasta: ${compact(monthlyAvg)} por mês`,
        why: `São cerca de ${plural(Math.round(avgCharges), "cobrança", "cobranças")} por mês, de ${brl(ticket)} em média. Reduzir um quarto do uso economiza cerca de ${compact(saving)} por mês (${compact(saving * 12)} por ano).`,
        evidence: [recent3.map((m) => `${monthShort(m)} ${compact(mer.months.get(m) ?? 0)} (${plural(mer.counts.get(m) ?? 0, "vez", "vezes")})`).join(" · ")],
        action: { type: "ask", label: `Ver ${mer.label} dia a dia`, prompt: `Gráfico diário de ${monthName(ref)} dos gastos com ${mer.label}`, detail: null },
        impact_monthly: r2(saving),
        score: score(saving, 0.8),
      });
    }
  }

  // 5) Compromissos fixos contra a renda ------------------------------------
  if (incomeReliable && typicalIncome > 0 && fixedCommitments.length) {
    const fixedTotal = sum(fixedCommitments.map((f) => f.typical));
    const ratio = fixedTotal / typicalIncome;
    if (ratio >= 0.25) {
      const heavy = ratio >= 0.5;
      insights.push({
        key: "recurring_costs",
        kind: "recurring_costs",
        direction: heavy ? "worse" : "neutral",
        severity: heavy ? "attention" : "info",
        section: "aprendizados",
        headline: `Compromissos fixos levam ${pct(ratio)} da sua renda: ${compact(fixedTotal)} por mês`,
        why: heavy
          ? "Aluguel, contas e assinaturas saem antes de qualquer escolha do mês. Acima de 50% da renda, sobra pouca margem para imprevistos e para poupar."
          : "Aluguel, contas e assinaturas saem antes de qualquer escolha do mês. Abaixo de 50% da renda, é uma faixa confortável.",
        evidence: fixedCommitments.slice(0, 4).map((f) => `${f.label}: ${brl(f.typical)} por mês`),
        action: heavy
          ? { type: "ask", label: "Onde reduzir o fixo", prompt: "Quais dos meus gastos fixos eu consigo reduzir ou renegociar?", detail: null }
          : null,
        impact_monthly: r2(Math.max(0, fixedTotal - 0.5 * typicalIncome)),
        score: Math.max(score(Math.max(0, fixedTotal - 0.5 * typicalIncome), 0.8), heavy ? 35 : 20),
      });
    }
  }

  // 6a) Renda irregular: o parâmetro prudente é o mês mais fraco ----------------
  const incomeWindow = range(addMonths(ref, -5), ref).filter((m) => m >= firstMonth);
  const incomeValues = monthsOf(book.income, incomeWindow).filter((v) => v > 0);
  if (incomeReliable && incomeValues.length >= 4) {
    const low = Math.min(...incomeValues);
    const high = Math.max(...incomeValues);
    if (high >= 2 * low && high - low >= 1500) {
      const gap = typicalSpend - low;
      insights.push({
        key: "income_volatility",
        kind: "income_volatility",
        direction: gap > 0 ? "worse" : "neutral",
        severity: gap > 0 ? "attention" : "info",
        section: "aprendizados",
        headline: `Sua renda oscilou de ${compact(low)} a ${compact(high)} por mês nos últimos ${incomeWindow.length} meses`,
        why: gap > 0
          ? `Com renda irregular, o orçamento seguro parte do mês mais fraco. Seu gasto típico (${compact(typicalSpend)}) passa dele em ${compact(gap)}: uma reserva de ${compact(gap * 3)} cobre três meses fracos seguidos.`
          : `Seu gasto típico (${compact(typicalSpend)}) cabe até no mês mais fraco. Os meses fortes podem ir inteiros para reserva e metas.`,
        evidence: [incomeWindow.map((m) => `${monthShort(m)} ${compact(book.income.get(m) ?? 0)}`).join(" · ")],
        action: gap > 0
          ? { type: "route", label: "Criar reserva para meses fracos", route: "/app/metas", detail: `Sugestão: ${compact(gap * 3)}, formada nos meses de renda alta.` }
          : { type: "route", label: "Guardar o excedente", route: "/app/metas", detail: null },
        impact_monthly: r2(Math.max(0, gap)),
        score: Math.max(score(Math.max(0, gap), 0.9), 25),
      });
    }
  }

  // 6) Parcelas já contratadas ---------------------------------------------------
  const ahead = range(addMonths(current, 1), addMonths(current, 3));
  const installments = ahead.map((m) => ({
    month: m,
    amount: sum((input.future_installments ?? []).filter((i) => i.month === m).map((i) => i.amount)),
  }));
  const committed = sum(installments.map((i) => i.amount));
  if (committed >= 300) {
    const share = typicalIncome > 0 ? committed / (typicalIncome * 3) : 0;
    insights.push({
      key: "installments",
      kind: "installments_ahead",
      direction: "neutral",
      severity: share >= 0.2 ? "attention" : "info",
      section: "agora",
      headline: `${compact(committed)} em parcelas já comprometidos até ${monthName(ahead[2])}`,
      why: share > 0
        ? `É ${pct(share)} da sua renda típica desses 3 meses que já tem destino antes de o mês começar.`
        : "Esse valor já tem destino antes de o mês começar.",
      evidence: installments.filter((i) => i.amount > 0).map((i) => `${monthNameCap(i.month)}: ${brl(i.amount)}`),
      action: { type: "route", label: "Ver cartões e parcelas", route: "/app/cartoes", detail: null },
      impact_monthly: r2(committed / 3),
      score: score(committed / 3, 0.6),
    });
  }

  // 7) Cobrança fora do padrão no mês de referência -----------------------------
  for (const [key, mer] of book.byMerchant.entries()) {
    const history = mer.charges.filter((c) => c.month !== ref && c.month !== current).map((c) => c.amount);
    if (history.length < 3) continue;
    const typical = median(history);
    const outlier = mer.charges
      .filter((c) => (c.month === ref || c.month === current) && c.amount >= 300 && c.amount >= 3 * typical)
      .sort((a, b) => b.amount - a.amount)[0];
    if (!outlier) continue;
    insights.push({
      key: `merchant:${key}`,
      kind: "unusual_charge",
      direction: "worse",
      severity: "attention",
      section: "mudancas",
      headline: `Cobrança fora do padrão em ${mer.label}: ${brl(outlier.amount)}`,
      why: `Seu valor típico lá é ${brl(typical)}. Se não reconhece essa cobrança, vale conferir agora.`,
      evidence: [`Em ${outlier.date.slice(8, 10)}/${outlier.date.slice(5, 7)}, ${pct(outlier.amount / typical - 1)} acima do habitual`],
      action: { type: "route", label: "Ver lançamentos", route: "/app/lancamentos", detail: null },
      impact_monthly: r2(outlier.amount - typical),
      score: score(outlier.amount - typical, 0.7),
    });
  }

  // Deduplicação pela causa-raiz: fica o de maior peso.
  const byKey = new Map<string, ExecutiveInsight>();
  for (const insight of insights) {
    const existing = byKey.get(insight.key);
    if (!existing || insight.score > existing.score) byKey.set(insight.key, insight);
  }
  // Piso de relevância e no máximo 3 recorrentes novos: o resto é ruído.
  let newRecurring = 0;
  const ranked = [...byKey.values()]
    .filter((i) => i.score >= 8 || (i.direction === "better" && i.score > 0))
    .sort((a, b) => b.score - a.score)
    .filter((i) => i.kind !== "new_recurring" || ++newRecurring <= 3);

  // KPIs do topo -----------------------------------------------------------------
  const refSpend = book.spend.get(ref) ?? 0;
  const kpis: ExecutiveKpi[] = [];
  if (typicalSpend > 0) {
    const d = refSpend - typicalSpend;
    kpis.push({
      label: `Gasto em ${monthName(ref)}`,
      value: compact(refSpend),
      hint: `padrão ${compact(typicalSpend)}`,
      tone: Math.abs(d) < 0.08 * typicalSpend ? "neutral" : d > 0 ? "bad" : "good",
    });
  }
  if (incomeReliable) {
    kpis.push({
      label: "Saldo em 3 meses",
      value: signedCompact(net3),
      hint: `entrou ${compact(income3)}`,
      tone: net3 >= 0 ? "good" : "bad",
    });
    kpis.push({
      label: "Taxa de poupança",
      value: income3 > 0 ? pct(net3 / income3) : "—",
      hint: "meta saudável: 10%+",
      tone: income3 > 0 && net3 / income3 >= 0.1 ? "good" : "bad",
    });
  }

  return {
    version: EXECUTIVE_INSIGHTS_VERSION,
    as_of: asOf,
    reference_month: ref,
    kpis,
    insights: ranked,
    coverage: { months_of_history: monthsOfHistory, income_reliable: incomeReliable, learning: monthsOfHistory < 3 },
  };
}

/** Seleção por seção: "Agora" é a pauta do comitê — o que mais pesa, com contraponto positivo. */
export function insightsForSection(briefing: ExecutiveBriefing, section: "agora" | "mudancas" | "aprendizados", limit = 6): ExecutiveInsight[] {
  if (section === "agora") {
    const top = briefing.insights.slice(0, 5);
    const positive = briefing.insights.find((i) => i.direction === "better");
    if (positive && !top.includes(positive)) top[top.length - 1] = positive;
    return top;
  }
  return briefing.insights.filter((i) => i.section === section).slice(0, limit);
}
