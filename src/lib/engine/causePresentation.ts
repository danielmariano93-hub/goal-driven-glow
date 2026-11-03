// Apresentação do livro de causas (F3): decide SE o card aparece e o que ele diz. Puro e determinístico.
// Regras de linguagem (do desenho do projeto): fato e associação afirmam; nada de intenção ou culpa;
// hipótese de comportamento é pergunta, nunca afirmação.
import { round2 } from "./facts";
import type { CauseDriver, CauseLedger } from "./causeLedger";

export const CAUSE_CARD_VERSION = "cause_card.v1";

export interface CauseCard {
  version: typeof CAUSE_CARD_VERSION;
  month: string;
  /** Mês por extenso, ex.: "outubro". */
  month_label: string;
  tone: "worse" | "better";
  title: string;
  /** Até 3 linhas de fato: o que mais pesou, em reais contra o normal do próprio usuário. */
  lines: Array<{ key: CauseDriver["key"]; label: string; effect: number; text: string }>;
  /** Parte que o Nino não conseguiu classificar (lançamentos sem categoria). */
  unclassified: number;
  confidence: CauseLedger["confidence"];
  /** Pergunta de acompanhamento só quando o maior peso é comportamento (hipótese não vira afirmação). */
  question: string | null;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const brl = (n: number) => `R$ ${Math.abs(round2(n)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mesma tolerância do livro de causas: variação pequena não vira card. */
export function causeTolerance(ledger: CauseLedger): number {
  const income = ledger.drivers.find((d) => d.key === "renda")?.baseline ?? 0;
  return Math.max(100, Math.abs(ledger.free_cash_baseline) * 0.05, income * 0.03);
}

const VERB: Record<CauseDriver["key"], (effect: number, d: CauseDriver) => string> = {
  renda: (e, d) => e < 0 ? `A renda foi ${brl(e)} menor que o seu normal (${brl(d.current)} contra ${brl(d.baseline)}).` : `A renda foi ${brl(e)} maior que o seu normal (${brl(d.current)} contra ${brl(d.baseline)}).`,
  fixa: (e) => e < 0 ? `Gastos fixos ${brl(e)} acima do normal.` : `Gastos fixos ${brl(e)} abaixo do normal.`,
  parcela_cartao: (e) => e < 0 ? `Parcelas de cartão ${brl(e)} acima do normal.` : `Parcelas de cartão ${brl(e)} abaixo do normal.`,
  variavel: (e) => e < 0 ? `Gastos variáveis ${brl(e)} acima do normal.` : `Gastos variáveis ${brl(e)} abaixo do normal.`,
  pontual: (e) => e < 0 ? `Gastos pontuais ${brl(e)} acima do normal.` : `Gastos pontuais ${brl(e)} abaixo do normal.`,
  antecipacao: (e) => e < 0 ? `Antecipação de parcelas pesou ${brl(e)} neste mês (é calendário, não hábito).` : `Antecipação de parcelas aliviou ${brl(e)} neste mês (é calendário, não hábito).`,
  desconhecida: () => "",
};

/**
 * Card "Por que está assim?" de um mês JÁ FECHADO. Devolve null quando não há o que dizer com segurança:
 * confiança baixa, variação pequena, sem causa identificada ou causa só em lançamentos sem classificação.
 */
export function describeCauseLedger(ledger: CauseLedger | null | undefined): CauseCard | null {
  if (!ledger || ledger.confidence === "baixa") return null;
  if (Math.abs(ledger.delta) < causeTolerance(ledger)) return null;
  const tone: CauseCard["tone"] = ledger.delta < 0 ? "worse" : "better";
  // Mostra o que MAIS pesou na direção da variação (nunca um fator que puxou para o outro lado).
  const sign = ledger.delta < 0 ? -1 : 1;
  const ranked = ledger.drivers
    .filter((d) => d.key !== "desconhecida" && Math.sign(d.effect) === sign && Math.abs(d.effect) >= 1)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, 3);
  if (!ranked.length) return null;
  const monthIdx = Number(ledger.month.slice(5, 7)) - 1;
  const monthLabel = MONTHS[monthIdx] ?? ledger.month;
  const unknown = ledger.drivers.find((d) => d.key === "desconhecida");
  const unclassified = round2(Math.max(0, Math.abs(unknown?.effect ?? 0)));
  const behavioralTop = ranked[0].key === "variavel";
  return {
    version: CAUSE_CARD_VERSION,
    month: ledger.month,
    month_label: monthLabel,
    tone,
    title: tone === "worse"
      ? `${monthLabel[0].toUpperCase()}${monthLabel.slice(1)} fechou ${brl(ledger.delta)} abaixo do seu normal`
      : `${monthLabel[0].toUpperCase()}${monthLabel.slice(1)} fechou ${brl(ledger.delta)} acima do seu normal`,
    lines: ranked.map((d) => ({ key: d.key, label: d.label, effect: d.effect, text: VERB[d.key](d.effect, d) })),
    unclassified,
    confidence: ledger.confidence,
    question: behavioralTop && tone === "worse" ? "Quer que eu mostre em quais categorias o gasto variável cresceu?" : null,
  };
}
