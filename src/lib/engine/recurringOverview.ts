import { brandOfName, type Subscription } from "@/lib/engine/subscriptions";

export type OverviewRule = { id: string; name: string; amount: number; kind: string; frequency: string; status: string };
export type OverviewItem = { key: string; name: string; monthly: number; source: "regra" | "detectada" | "divida" };
export type RecurringOverview = {
  total: number;
  essential: number;
  opportunity: number;
  essentials: OverviewItem[];
  opportunities: OverviewItem[];
  /** Quanto da conta recorrente é "cortável" sem mexer no que não dá para parar. */
  opportunity_share_pct: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function monthlyEquivalent(amount: number, frequency: string): number {
  if (frequency === "weekly") return amount * (52 / 12);
  if (frequency === "daily") return amount * (365 / 12);
  if (frequency === "yearly") return amount / 12;
  return amount;
}

/**
 * Separa o que se repete em "essencial" (não dá para simplesmente parar: seguro, dívidas,
 * aluguel…) e "oportunidade" (assinaturas e serviços que dá para cortar sem efeito colateral).
 * Oportunidade = regra cujo nome é de uma marca de assinatura conhecida + assinaturas detectadas
 * nos lançamentos que ainda não viraram regra. Cada marca conta uma vez só.
 */
export function buildRecurringOverview(input: {
  rules: OverviewRule[];
  detected: Subscription[];
  debtInstallments: Array<{ id: string; name: string; amount: number }>;
}): RecurringOverview {
  const essentials: OverviewItem[] = [];
  const opportunities: OverviewItem[] = [];
  const seenBrands = new Set<string>();
  const seenRules = new Set<string>();

  for (const r of input.rules) {
    if (r.status !== "active" || r.kind !== "expense") continue;
    const monthly = r2(monthlyEquivalent(Number(r.amount) || 0, r.frequency));
    const brand = brandOfName(r.name);
    if (brand) {
      if (seenBrands.has(brand.name)) continue; // regra duplicada da mesma marca não conta em dobro
      seenBrands.add(brand.name);
      opportunities.push({ key: `rule:${r.id}`, name: r.name, monthly, source: "regra" });
    } else {
      const k = r.name.trim().toLowerCase();
      if (seenRules.has(k)) continue;
      seenRules.add(k);
      essentials.push({ key: `rule:${r.id}`, name: r.name, monthly, source: "regra" });
    }
  }
  for (const s of input.detected) {
    if (seenBrands.has(s.name)) continue;
    seenBrands.add(s.name);
    opportunities.push({ key: `sub:${s.key}`, name: s.name, monthly: r2(s.monthly), source: "detectada" });
  }
  for (const d of input.debtInstallments) {
    essentials.push({ key: `debt:${d.id}`, name: d.name, monthly: r2(d.amount), source: "divida" });
  }

  const sum = (xs: OverviewItem[]) => r2(xs.reduce((a, b) => a + b.monthly, 0));
  const essential = sum(essentials);
  const opportunity = sum(opportunities);
  const total = r2(essential + opportunity);
  essentials.sort((a, b) => b.monthly - a.monthly);
  opportunities.sort((a, b) => b.monthly - a.monthly);
  return { total, essential, opportunity, essentials, opportunities, opportunity_share_pct: total > 0 ? Math.round((opportunity / total) * 100) : null };
}
