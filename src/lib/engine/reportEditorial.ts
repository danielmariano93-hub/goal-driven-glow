import type { ReportV2 } from "./reportV2";

/**
 * Motor editorial determinístico do "Meu mês" (handoff Meu mês, seção 12).
 * Só escolhe e redige a partir de números que o relatório já calculou: não calcula métricas novas,
 * não infere causa e não inventa números. A ordem dos capítulos é fixa; aqui muda só o protagonismo.
 *
 * Prioridade: 1 qualidade crítica → 2 risco de caixa → 3 pressão de compromissos → 4 mudança de consumo
 * → 5 evolução/oportunidade → resumo neutro. Desempate pelo id estável.
 */
export const EDITORIAL_VERSION = "meu_mes_editorial.v1";

/** Limiares propostos (a aprovar). Não são universais; ficam aqui, versionados, e não espalhados pela tela. */
export const EDITORIAL_THRESHOLDS = {
  /** Compromissos ≥ 50% da renda de referência do mesmo horizonte. */
  commitmentPressurePct: 0.5,
  /** Desvio material do consumo contra o habitual. */
  consumptionDeltaPct: 0.15,
  /** Base mínima de meses do habitual para destacar mudança. */
  minHabitualMonths: 3,
  /** Queda grande no mês em andamento: avisar que pode ser calendário. */
  calendarDropPct: 0.3,
} as const;

export type EditorialKind = "quality" | "cash_risk" | "commitments" | "consumption" | "evolution" | "neutral";
export type Anchor = "momento" | "gastos" | "habitos" | "futuro" | "evolucao" | "acao";

export interface EditorialItem {
  id: string;
  kind: EditorialKind;
  /** 1 = mais grave. */
  priority: number;
  /** Observação verificável (até ~90 caracteres). */
  title: string;
  /** Interpretação qualificada ou consequência (até ~90 caracteres). */
  detail: string;
  anchor: Anchor;
}

export interface Editorial { version: string; dominant: EditorialItem; complementary: EditorialItem[] }

const brl = (n: number) => `${n < 0 ? "−" : ""}R$ ${Math.abs(Math.round(n)).toLocaleString("pt-BR")}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function buildEditorial(rep: ReportV2, t: typeof EDITORIAL_THRESHOLDS = EDITORIAL_THRESHOLDS): Editorial {
  const items: EditorialItem[] = [];
  const o = rep.overview;
  const cur = rep.isCurrentMonth;

  // 1. Qualidade crítica: dado essencial indisponível limita o diagnóstico.
  if (!o) {
    items.push({ id: "quality:no_data", kind: "quality", priority: 1, title: "Ainda não há movimentações neste mês", detail: "Registre ou importe lançamentos para o Nino montar o seu mês.", anchor: "momento" });
  } else if (cur && o.balance.available == null) {
    items.push({ id: "quality:no_snapshot", kind: "quality", priority: 1, title: "Seu saldo de hoje ainda não foi atualizado", detail: "Saldo e previsões ficam limitados até a próxima atualização.", anchor: "momento" });
  }

  // 2. Risco de caixa: só com calendário confiável (vencimentos datados antes da próxima entrada).
  const cash = rep.projections.cash;
  const due = rep.projections.commitments?.items;
  if (cur && o && o.balance.available != null && cash?.expectedIncome && due && due.length > 0) {
    const incomeDate = cash.expectedIncome.date;
    const before = due.filter((d) => d.date && d.date < incomeDate);
    const owed = before.reduce((s, d) => s + d.amount, 0);
    const min = o.balance.available - owed;
    if (before.length > 0 && min < 0) {
      items.push({ id: "cash:deficit_before_income", kind: "cash_risk", priority: 2, title: `Seu saldo pode faltar antes de ${ddmm(incomeDate)}`, detail: `Vencem ${brl(owed)} até lá, contra ${brl(o.balance.available)} disponíveis hoje.`, anchor: "futuro" });
    }
  }

  // 3. Pressão de compromissos (mesmo horizonte da renda de referência).
  const ci = rep.projections.committedIncome;
  const cm = rep.projections.commitments;
  if (cur && ci && cm && ci.pct >= t.commitmentPressurePct) {
    items.push({ id: "commitments:pressure", kind: "commitments", priority: 3, title: `Compromissos somam ${brl(cm.next30)}${cm.horizonEnd ? ` até ${ddmm(cm.horizonEnd)}` : ""}`, detail: `Equivalem a ${Math.round(ci.pct * 100)}% da ${ci.basis}.`, anchor: "futuro" });
  }

  // 4. Mudança de consumo com base suficiente; separa efeito calendário de mudança observada.
  const h = o?.habitual;
  if (o && h && h.deltaPct != null && h.months.length >= t.minHabitualMonths && Math.abs(h.deltaPct) >= t.consumptionDeltaPct) {
    const pct = Math.round(Math.abs(h.deltaPct) * 100);
    if (h.deltaPct < 0) {
      const calendar = cur && Math.abs(h.deltaPct) >= t.calendarDropPct;
      items.push({
        id: "consumption:below", kind: "consumption", priority: 4,
        title: cur ? `Você está gastando ${pct}% menos que o habitual,` : `Você gastou ${pct}% menos que o habitual.`,
        detail: calendar ? "mas o mês ainda não terminou: parte pode ser calendário." : cur ? `até o dia ${o.windowDays}, contra ${brl(h.value)} no habitual.` : `Foram ${brl(o.consumption)}, contra ${brl(h.value)} no habitual.`,
        anchor: "gastos",
      });
    } else {
      const top = [...o.causes].filter((c) => c.impact > 0).sort((x, y) => y.impact - x.impact || (x.name < y.name ? -1 : 1))[0];
      items.push({
        id: "consumption:above", kind: "consumption", priority: 4,
        title: cur ? `Você está gastando ${pct}% acima do habitual.` : `Você gastou ${pct}% acima do habitual.`,
        detail: top ? `${top.name} responde por ${brl(top.impact)} da diferença.` : `São ${brl(h.deltaAbs)} a mais que o habitual nos mesmos dias.`,
        anchor: "gastos",
      });
    }
  }

  // 5. Evolução / oportunidade com evidência.
  const sv = rep.projections.savings;
  const rec = rep.recommendations.items.find((r) => r.nature === "saving" && r.monthlyImpact > 0);
  if (sv && sv.status === "ok" && (sv.monthly ?? 0) > 0) {
    items.push({ id: "evolution:saving", kind: "evolution", priority: 5, title: `Sua poupança sustentável é de ${brl(sv.monthly ?? 0)}/mês`, detail: `Mediana de ${sv.closedMonths} meses fechados.`, anchor: "evolucao" });
  } else if (rec) {
    items.push({ id: `evolution:rec:${rec.key}`, kind: "evolution", priority: 5, title: `Há uma oportunidade de até ${brl(rec.monthlyImpact)}/mês`, detail: rec.title, anchor: "acao" });
  }

  // Resumo neutro quando nada se destaca.
  if (items.length === 0 && o) {
    items.push({ id: "neutral:summary", kind: "neutral", priority: 6, title: cur ? `Você consumiu ${brl(o.consumption)} até o dia ${o.windowDays}.` : `Você consumiu ${brl(o.consumption)} no mês.`, detail: h ? "Dentro do seu habitual para os mesmos dias." : "Ainda não há histórico suficiente para comparar.", anchor: "gastos" });
  }

  const sorted = items.sort((x, y) => x.priority - y.priority || (x.id < y.id ? -1 : 1));
  return { version: EDITORIAL_VERSION, dominant: sorted[0], complementary: sorted.slice(1, 3) };
}
