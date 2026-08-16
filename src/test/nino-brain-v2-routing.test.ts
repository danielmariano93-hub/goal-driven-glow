import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { validateAgainstEvidence } from "../../supabase/functions/_shared/agent/core/TruthValidator";
import { merchantDistribution } from "../lib/engine/merchantIntelligence";

const capability = (text: string) => classifyCapability(text, interpret(text), null);

describe("nino_brain.v2 — roteamento de evolução e distribuição", () => {
  it("evolução/tendência sem pedido visual é análise textual determinística", () => {
    for (const t of ["quero ver a evolução dos meus gastos", "qual a tendência do meu gasto", "estou reduzindo?"]) {
      expect(capability(t)).toMatchObject({
        name: "financial_evolution", execution: "deterministic", required_tool: "analyze_financial_evolution",
      });
    }
  });

  it("gráfico explícito continua indo para visualização", () => {
    expect(capability("me manda o gráfico dos gastos")).toMatchObject({
      name: "visualization", required_tool: "generate_chart_artifact",
    });
    expect(capability("mostra em barras por categoria")).toMatchObject({ name: "visualization" });
  });

  it("distribuição de categoria por estabelecimento é determinística", () => {
    expect(capability("como está a distribuição da categoria alimentação?")).toMatchObject({
      name: "merchant_distribution", execution: "deterministic", required_tool: "merchant_distribution",
    });
    expect(capability("onde mais gastei em transporte?")).toMatchObject({
      name: "merchant_distribution", required_tool: "merchant_distribution",
    });
  });
});

describe("merchant_distribution.v1 — share sempre sobre o total da categoria", () => {
  const txs = [
    { id: "1", type: "expense", status: "confirmed", amount: 100, occurred_at: "2026-08-05", description: "IFOOD", category_id: "cat" },
    { id: "2", type: "expense", status: "confirmed", amount: 50, occurred_at: "2026-08-06", description: "IFOOD", category_id: "cat" },
    { id: "3", type: "expense", status: "confirmed", amount: 50, occurred_at: "2026-08-07", description: "", category_id: "cat" },
  ] as never[];

  it("declara cobertura parcial e não infla percentuais", () => {
    const dist = merchantDistribution({
      txs,
      period: { from: "2026-08-01", to: "2026-08-31" },
      categoryId: "cat",
      categoryName: "Alimentação",
    } as never);
    expect(dist.category_total).toBe(200);
    expect(dist.merchants[0].amount).toBe(150);
    // 150 / 200 = 0,75 — nunca 1,0 (que seria 150/150 identificados).
    expect(dist.merchants[0].share_of_category).toBe(0.75);
    expect(dist.coverage).toBe(0.75);
    expect(dist.unresolved_total).toBe(50);
  });
});

describe("TruthValidator v2 — percentuais também são fatos", () => {
  const calls = [{ tool_name: "merchant_distribution", ok: true, result: { category_total: 200, merchants: [{ amount: 150, share_of_category: 0.75 }] } }];

  it("aceita percentual entregue pelo motor", () => {
    expect(validateAgainstEvidence("Alimentação: R$ 200,00, com 75% em iFood.", calls).ok).toBe(true);
  });

  it("recusa percentual inventado", () => {
    const verdict = validateAgainstEvidence("Alimentação: R$ 200,00, com 42% em iFood.", calls);
    expect(verdict.ok).toBe(false);
    expect(verdict.issues.some((i) => i.type === "percent_not_in_evidence")).toBe(true);
  });
});
