import { describe, it, expect } from "vitest";

// Espelho leve do regex do AppAdapter (Deno). Testamos o mesmo padrão aqui para
// garantir que pedidos visuais/tendência não sejam interceptados pelo fast-path
// textual. Se o regex mudar no AppAdapter, atualize este espelho.
const wantsChart = (text: string) =>
  /\b(gr[aá]fico|gr[aá]ficos|graficos?|chart|visualiz(a|ar|a[çc][aã]o)|em\s+barras?|em\s+pizza|em\s+donut|em\s+linhas?|linha|curva|dia\s+a\s+dia|diariamente|por\s+dia|por\s+semana|por\s+m[eê]s|evolu(?:[cç][aã]o|ir|indo)|tend[eê]ncia|m[eé]dia\s+(?:di[aá]ria|do\s+dia|acumulada)|gasto\s+m[eé]dio|estou\s+reduzindo|reduzindo\s+meus?\s+gastos|andando\s+de\s+lado|est[aá]\s+(?:caindo|subindo)|ritmo\s+dos?\s+gastos?)\b/i.test(text || "");

const isAnalyticsRequest = (text: string) =>
  /\b(me\s+analis[ae]|an[aá]lise\s+geral|resumo\s+(?:do\s+m[eê]s|geral|dos?\s+gastos?)|onde\s+(?:mais\s+)?gast[aeo])\b/i.test(text || "");

describe("chart routing — pedidos visuais nunca caem no fast-path textual", () => {
  const visualPhrases = [
    "me manda o gráfico",
    "quero ver a evolução",
    "estou reduzindo meus gastos?",
    "meu gasto médio dia a dia",
    "andando de lado?",
    "qual a tendência do meu gasto",
    "média diária acumulada",
    "gasto médio do mês",
    "por dia, quanto gastei",
  ];
  for (const p of visualPhrases) {
    it(`"${p}" → wantsChart=true`, () => expect(wantsChart(p)).toBe(true));
  }

  const textualPhrases = [
    "me analisa",
    "resumo do mês",
    "onde mais gastei",
    "análise geral",
  ];
  for (const p of textualPhrases) {
    it(`"${p}" → analytics texto e não gráfico`, () => {
      expect(isAnalyticsRequest(p)).toBe(true);
      expect(wantsChart(p)).toBe(false);
    });
  }

  it("correção 'não foi isso, agora manda o gráfico' vira visual", () => {
    expect(wantsChart("não foi isso, agora manda o gráfico")).toBe(true);
  });
});
