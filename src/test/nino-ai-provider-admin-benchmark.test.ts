import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260917113000_nino_ai_provider_admin_benchmark.sql",
  "utf8",
);
const board = readFileSync("src/components/admin/AiProviderBenchmarkBoard.tsx", "utf8");
const page = readFileSync("src/pages/admin/CustoLatencia.tsx", "utf8");

describe("AI provider admin benchmark", () => {
  it("exposes aggregate benchmark only to authorized cockpit readers", () => {
    expect(migration).toContain("admin_ai_provider_benchmark");
    expect(migration).toContain("public._require_perm('cockpit.read')");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.admin_ai_provider_benchmark");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.admin_ai_provider_benchmark");
  });

  it("compares latency, tokens and semantic contract dimensions", () => {
    expect(migration).toContain("official_avg_latency_ms");
    expect(migration).toContain("shadow_avg_latency_ms");
    expect(migration).toContain("tokens_per_turn");
    expect(migration).toContain("semantic_parity_pct");
    expect(migration).toContain("canonical_match_pct");
    expect(migration).toContain("focus_match_pct");
  });

  it("does not mislabel parity with production as ground-truth accuracy", () => {
    expect(migration).toContain("semantic_parity_is_not_ground_truth");
    expect(board).toContain("não é, isoladamente, prova de maior acurácia");
    expect(board).toContain("Concordância semântica com o Nino atual");
  });

  it("renders the benchmark in the existing cost and latency admin tab", () => {
    expect(page).toContain("AiEfficiencyHistoryBoard");
    expect(page).toContain("AiProviderBenchmarkBoard");
    expect(board).toContain("Latência diária");
    expect(board).toContain("Tokens por turno");
    expect(board).toContain("Lovable × Groq");
  });
});
