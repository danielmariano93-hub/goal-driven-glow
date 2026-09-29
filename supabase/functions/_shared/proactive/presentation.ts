// proactive_presentation.v1 — o que chega ao usuário (função pura).
// ==================================================================
// Situações nascem de motores diferentes (snapshot, diagnóstico, timing) e cada
// um formatava dinheiro e redigia do seu jeito: "R$ 6353,26", "R$ 10,800.00",
// "no vermelho", corpo com metodologia de cálculo. Esta camada padroniza a
// apresentação SEM criar número: só reformata valores que já estão no texto e
// remove frases que não são para o usuário final.
import type { FinancialSituation } from "./contracts.ts";

export const PROACTIVE_PRESENTATION_VERSION = "proactive_presentation.v1";

/** Moeda pt-BR com separador de milhar: R$ 6.353,26. */
export function brlPt(value: number): string {
  const n = Math.abs(Number(value) || 0);
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseMoneyToken(raw: string): number | null {
  const token = raw.trim();
  // en-US: 10,800.00 | 800.00
  if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(token) || /^\d+\.\d{2}$/.test(token)) {
    return Number(token.replace(/,/g, ""));
  }
  // pt-BR sem milhar: 6353,26 | pt-BR com milhar: 6.353,26
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(token) || /^\d+,\d{2}$/.test(token)) {
    return Number(token.replace(/\./g, "").replace(",", "."));
  }
  // inteiro com ou sem milhar pt-BR: 1.200 | 1200
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) return Number(token.replace(/\./g, ""));
  if (/^\d+$/.test(token)) return Number(token);
  return null;
}

/** Reescreve todo "R$ <valor>" do texto no formato pt-BR, preservando o valor. */
export function normalizeMoneyText(text: string): string {
  return String(text ?? "").replace(/R\$\s?(\d[\d.,]*\d|\d)/g, (match, token: string) => {
    const value = parseMoneyToken(token);
    return value == null || !Number.isFinite(value) ? match : brlPt(value);
  });
}

const VOCABULARY: Array<[RegExp, string]> = [
  [/\bfechar\s+(R\$\s?[\d.,]+)\s+no vermelho\b/gi, "fechar $1 negativo"],
  [/\bno vermelho\b/gi, "no negativo"],
  [/\bd[ée]ficit\b/gi, "diferença negativa"],
];

// Frases de metodologia e de telemetria interna: úteis para auditoria, não
// para a pessoa. Ficam na evidência, nunca no corpo.
const METHODOLOGY_SENTENCE = [
  /O cálculo considera[^.]*\./gi,
  /[^.]*\b(?:amostras?|confiança de \d)[^.]*\./gi,
  /[^.]*\bpara evitar dupla contagem\b[^.]*\./gi,
];

export function stripMethodology(text: string): { text: string; removed: string[] } {
  let out = String(text ?? "");
  const removed: string[] = [];
  for (const rx of METHODOLOGY_SENTENCE) {
    out = out.replace(rx, (sentence) => {
      removed.push(sentence.trim());
      return "";
    });
  }
  return { text: out.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim(), removed };
}

/** Ação concreta por tipo, usada quando o corpo original não era para o usuário. */
const ACTION_BY_KIND: Record<string, string> = {
  cash_flow_imbalance: "Vale escolher agora um gasto para segurar até o fim do mês.",
  goal_at_risk: "Um aporte menor agora já mantém a meta andando.",
  goal_feasibility: "Vale revisar o prazo ou o valor da meta para caber no seu mês.",
  spending_pace_change: "Segurar os próximos dias já muda o fechamento.",
  growing_category: "Definir um teto para essa categoria ajuda a segurar o mês.",
  emotional_spending: "Quer olhar isso juntos?",
};

export function presentText(text: string): string {
  let out = normalizeMoneyText(text);
  for (const [rx, replacement] of VOCABULARY) out = out.replace(rx, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Aplica a apresentação padrão a uma situação (não muda nenhum valor). */
export function presentSituation(situation: FinancialSituation): FinancialSituation {
  const title = presentText(situation.title);
  const stripped = stripMethodology(situation.body);
  let body = presentText(stripped.text);
  if (!body || body.length < 12) {
    body = ACTION_BY_KIND[situation.communication_kind] ?? "";
  }
  if (body && title && body.toLowerCase().startsWith(title.toLowerCase()) && body.length === title.length) {
    body = ACTION_BY_KIND[situation.communication_kind] ?? body;
  }
  if (title === situation.title && body === situation.body) return situation;
  return {
    ...situation,
    title,
    body,
    evidence: {
      ...situation.evidence,
      presentation: {
        version: PROACTIVE_PRESENTATION_VERSION,
        original_title: situation.title !== title ? situation.title : undefined,
        methodology: stripped.removed.length ? stripped.removed : undefined,
      },
    },
  };
}

/**
 * Tipo de comunicação correto para itens do diagnóstico canônico. Antes, todo
 * item que não era conquista virava `emotional_spending` — inclusive "meta
 * pede aporte" e "consumo supera a renda" —, o que distorcia prioridade,
 * cooldown e aprendizado por tipo.
 */
export function diagnosisCommunicationKind(kind: string, topicKey: string): string {
  const [, topic = "", subject = ""] = String(topicKey ?? "").split(":");
  if (kind === "achievement") return topic === "debt_progress" ? "debt_progress" : "goal_progress";
  if (topic === "future") {
    if (subject === "debt") return "debt_due_soon";
    if (subject === "bill") return "expected_recurring_payment";
    return "goal_at_risk";
  }
  switch (topic) {
    case "goal_feasibility":
    case "goal_pace":
      return "goal_at_risk";
    case "cash_flow":
      return "cash_flow_imbalance";
    case "debt_overdue":
      return "debt_overdue";
    case "spending_pace":
      return "spending_pace_change";
    case "category_shift":
    case "category_growth":
      return "growing_category";
    case "anticipation":
      return "small_spend_acceleration";
    default:
      return "emotional_spending";
  }
}

/** Tópicos do diagnóstico que outro motor já cobre com a fonte canônica. */
export function diagnosisTopicOwnedElsewhere(topicKey: string, ctx: { debtObligationsAvailable: boolean }): boolean {
  const [, topic = "", subject = ""] = String(topicKey ?? "").split(":");
  return ctx.debtObligationsAvailable
    && (topic === "debt_overdue" || topic === "debt_due_soon" || (topic === "future" && subject === "debt"));
}
