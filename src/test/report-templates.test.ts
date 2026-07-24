import { describe, it, expect } from "vitest";
import { matchTemplate, templateToArtifactArgs } from "../../supabase/functions/_shared/agent/templates/reportTemplates";

describe("matchTemplate", () => {
  it("casa spending_trend para frases de evolução/tendência", () => {
    expect(matchTemplate("mostra a evolução dos meus gastos")?.template_key).toBe("spending_trend");
    expect(matchTemplate("como está a tendência do meu gasto")?.template_key).toBe("spending_trend");
    expect(matchTemplate("estou reduzindo?")?.template_key).toBe("spending_trend");
    expect(matchTemplate("meu gasto médio dia a dia")?.template_key).toBe("spending_trend");
  });

  it("casa monthly_comparison para frases de comparação com o mês passado", () => {
    expect(matchTemplate("compara com o mês passado")?.template_key).toBe("monthly_comparison");
    expect(matchTemplate("mes atual vs mes passado")?.template_key).toBe("monthly_comparison");
    expect(matchTemplate("o que mudou do mês passado")?.template_key).toBe("monthly_comparison");
  });

  it("casa weekly_one_page para relatório/resumo semanal", () => {
    expect(matchTemplate("me dá um one page da semana")?.template_key).toBe("weekly_one_page");
    expect(matchTemplate("resumo semanal por favor")?.template_key).toBe("weekly_one_page");
    expect(matchTemplate("relatório da semana")?.template_key).toBe("weekly_one_page");
  });

  it("NÃO casa frases genéricas de análise textual", () => {
    expect(matchTemplate("quanto gastei esse mês")).toBeNull();
    expect(matchTemplate("onde gasto mais")).toBeNull();
    expect(matchTemplate("me analisa")).toBeNull();
    expect(matchTemplate("")).toBeNull();
  });

  it("mapeia template_key para kind do ChartArtifact", () => {
    expect(templateToArtifactArgs({ template_key: "spending_trend", params: {} }).kind).toBe("average_daily_trend");
    expect(templateToArtifactArgs({ template_key: "monthly_comparison", params: {} }).kind).toBe("compare");
    expect(templateToArtifactArgs({ template_key: "weekly_one_page", params: {} }).kind).toBe("timeseries");
  });
});
