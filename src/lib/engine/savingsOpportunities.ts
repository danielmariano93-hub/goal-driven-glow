// Motor "Onde meu dinheiro está escapando?" + Economia Personalizada
// (`savings_opportunities.v1`).
// Nunca sugere corte em custo estrutural. Cada oportunidade é realista: baseada
// no próprio comportamento do usuário (excesso sobre o hábito), não em metas
// genéricas de percentual.
import { round2 } from "./facts";
import type { EngineEnvelope, EnginePeriod } from "./engineEnvelope";
import { confidenceFromSample, makeEnvelope, makeEvidence } from "./engineEnvelope";
import type { MerchantStats } from "./merchantIntelligence";
import type { DetectedSubscription } from "./recurringDiscovery";
import type { CostStructureFacts } from "./costStructure";
import { classifyFlexibility } from "./costStructure";
import type { Anomaly } from "./anomalies";

export const SAVINGS_OPPORTUNITIES_VERSION = "savings_opportunities.v1";

const BRL = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0));
const PCT = (value: number | null | undefined): string => `${Math.round(Number(value || 0)).toLocaleString("pt-BR")}%`;

export type LeakKind =
  | "assinatura_esquecida"
  | "assinatura_aumentou"
  | "pequenos_valores"
  | "excesso_sobre_habito"
  | "taxa_ou_juros"
  | "pico_pontual";

export interface SavingsOpportunity {
  kind: LeakKind;
  label: string;
  /** Economia mensal estimada, conservadora. */
  monthly_saving: number;
  /** Como o número foi obtido — a LLM só repete. */
  basis: string;
  action_hint: string;
  effort: "baixo" | "medio" | "alto";
  confidence: "high" | "medium" | "low";
  evidence_ref: string | null;
}

export interface SavingsFacts {
  total_monthly_saving: number;
  opportunities_count: number;
  /** Fatia da sobra mensal que as oportunidades representam. */
  share_of_headroom: number | null;
  biggest_leak: string | null;
}

export interface SavingsInput {
  period: EnginePeriod;
  /** Ranking de estabelecimentos do período (líquido de estorno). */
  merchants: MerchantStats[];
  /** Mesmo ranking em período comparável, para medir excesso sobre hábito. */
  previousMerchants?: MerchantStats[];
  subscriptions?: DetectedSubscription[];
  anomalies?: Anomaly[];
  costStructure?: CostStructureFacts | null;
  /** Nome de categoria por id, para nunca sugerir corte em estrutura. */
  categoryNames?: Record<string, string>;
  /** Valor máximo considerado "pequeno valor". */
  smallTicketMax?: number;
}

function dominantCategoryName(m: MerchantStats, names: Record<string, string>): string | null {
  const top = [...m.categories].sort((a, b) => b.total - a.total)[0];
  if (!top?.category_id) return null;
  return names[top.category_id] ?? null;
}

/**
 * Onde o dinheiro escapa e quanto dá para recuperar sem cortar estrutura.
 */
export function computeSavingsOpportunities(
  input: SavingsInput,
): EngineEnvelope<SavingsFacts, SavingsOpportunity, SavingsOpportunity> {
  const names = input.categoryNames ?? {};
  const smallMax = input.smallTicketMax ?? 40;
  const prevByKey = new Map((input.previousMerchants ?? []).map((m) => [m.key, m]));
  const opportunities: SavingsOpportunity[] = [];

  // 1. Assinaturas paradas de usar / que subiram de preço.
  for (const s of input.subscriptions ?? []) {
    if (s.missing && s.days_overdue > 45) continue; // provavelmente já cancelada
    if (s.price_jump && s.previous_amount !== null) {
      opportunities.push({
        kind: "assinatura_aumentou",
        label: s.label,
        monthly_saving: round2(Math.max(0, s.current_amount - s.previous_amount)),
        basis: `${s.label} ficou mais caro: saiu de ${BRL(s.previous_amount)} para ${BRL(s.current_amount)}${s.price_change_pct !== null && s.price_change_pct !== undefined ? ` (${PCT(s.price_change_pct)})` : ""}.`,
        action_hint: "Revisar plano ou renegociar para voltar ao valor anterior.",
        effort: "baixo",
        confidence: s.confidence,
        evidence_ref: s.last_at,
      });
    }
    if (s.cadence === "monthly" && s.occurrences >= 3 && s.confidence !== "low") {
      opportunities.push({
        kind: "assinatura_esquecida",
        label: s.label,
        monthly_saving: s.monthly_equivalent,
        basis: `${s.label} aparece todo mês. O valor típico é ${BRL(s.typical_amount)}.`,
        action_hint: "Confirmar se ainda usa; se não usa, cancelar libera esse valor todo mês.",
        effort: "baixo",
        confidence: s.confidence,
        evidence_ref: s.last_at,
      });
    }
  }

  // 2. Excesso sobre o próprio hábito, por estabelecimento flexível.
  for (const m of input.merchants) {
    const categoryName = dominantCategoryName(m, names);
    if (classifyFlexibility(categoryName) === "estrutural") continue;
    const prev = prevByKey.get(m.key);
    if (!prev || prev.net_total <= 0) continue;
    const excess = round2(m.net_total - prev.net_total);
    if (excess < 30) continue;
    opportunities.push({
      kind: "excesso_sobre_habito",
      label: m.label,
      // Conservador: recuperar metade do excesso já volta ao patamar anterior.
      monthly_saving: round2(excess * 0.5),
      basis: `${m.label} saiu de ${BRL(prev.net_total)} para ${BRL(m.net_total)} neste período.`,
      action_hint: `Voltar mais perto do ritmo anterior pode liberar cerca de ${BRL(round2(excess * 0.5))} por mês.`,
      effort: "medio",
      confidence: m.count >= 4 ? "high" : "medium",
      evidence_ref: null,
    });
  }

  // 3. Pequenos valores que somam — o vazamento invisível.
  const smallLeaks = input.merchants
    .filter((m) => {
      if (m.count < 4) return false;
      if (m.avg_ticket > smallMax) return false;
      return classifyFlexibility(dominantCategoryName(m, names)) !== "estrutural";
    })
    .sort((a, b) => b.net_total - a.net_total);
  for (const m of smallLeaks.slice(0, 3)) {
    opportunities.push({
      kind: "pequenos_valores",
      label: m.label,
      monthly_saving: round2(m.net_total * 0.3),
      basis: `${m.count} compras pequenas em ${m.label} somaram ${BRL(m.net_total)}.`,
      action_hint: `Cortar cerca de 1 em cada 3 dessas compras economiza ${BRL(round2(m.net_total * 0.3))}.`,
      effort: "medio",
      confidence: m.count >= 8 ? "high" : "medium",
      evidence_ref: m.top_weekday ? `concentra em ${m.top_weekday.label}` : null,
    });
  }

  // 4. Picos pontuais fora da faixa pessoal (recuperáveis sem mudar rotina).
  for (const a of (input.anomalies ?? []).filter((x) => x.severity !== "info").slice(0, 3)) {
    if (a.scope === "record" || a.scope === "ticket") continue;
    opportunities.push({
      kind: "pico_pontual",
      label: a.label,
      monthly_saving: a.deviation_abs,
      basis: a.detail,
      action_hint: `Voltar ao seu padrão habitual pode liberar ${BRL(a.deviation_abs)}.`,
      effort: "baixo",
      confidence: a.sample_size >= 8 ? "high" : "medium",
      evidence_ref: a.reference,
    });
  }

  // Deduplica por label+kind mantendo a maior economia; nunca soma duas vezes o
  // mesmo estabelecimento em kinds sobrepostos.
  const byLabel = new Map<string, SavingsOpportunity>();
  for (const o of opportunities.sort((a, b) => b.monthly_saving - a.monthly_saving)) {
    if (o.monthly_saving < 5) continue;
    if (byLabel.has(o.label)) continue;
    byLabel.set(o.label, o);
  }
  const final = [...byLabel.values()].sort((a, b) => b.monthly_saving - a.monthly_saving);

  const total = round2(final.reduce((s, o) => s + o.monthly_saving, 0));
  const headroom = input.costStructure?.headroom_monthly ?? null;

  return makeEnvelope({
    engine: "savings_opportunities",
    facts: {
      total_monthly_saving: total,
      opportunities_count: final.length,
      share_of_headroom: headroom && headroom > 0 ? round2(total / headroom) : null,
      biggest_leak: final[0]?.label ?? null,
    },
    breakdown: final.slice(0, 8),
    drivers: final.slice(0, 3),
    evidence: makeEvidence({
      period: input.period,
      sampleSize: input.merchants.reduce((s, m) => s + m.count, 0),
      formulaVersion: SAVINGS_OPPORTUNITIES_VERSION,
      notes: [
        "Nenhuma sugestão toca custo estrutural (moradia, saúde, dívida, educação, contas básicas).",
        "Economias são conservadoras: metade do excesso sobre o próprio hábito, ou 1/3 das compras pequenas.",
      ],
    }),
    confidence: confidenceFromSample(input.merchants.length, { minSample: 3, goodSample: 12 }),
  });
}
