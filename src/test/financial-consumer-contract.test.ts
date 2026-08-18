import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("verdade financeira única — consumidores críticos", () => {
  it("Metas e detalhe consomem o snapshot em vez de avaliar a meta novamente", () => {
    for (const path of ["src/pages/Metas.tsx", "src/pages/MetaCategoriaDetalhe.tsx"]) {
      const value = source(path);
      expect(value).toContain("useFinancialSnapshot");
      expect(value).not.toContain("evaluateCategoryGoal(");
    }
  });

  it("comunicação de meta nasce do snapshot e carrega reconciliação", () => {
    const adapter = source("supabase/functions/_shared/intelligence/diagnosisToCommunication.ts");
    expect(adapter).toContain("computeAgentSnapshot");
    expect(adapter).toContain('source: "financial_snapshot_contract.v8"');
    expect(adapter).toContain("reconciliation_id: snapshot.reconciliation_id");
    expect(adapter).toContain('String(row.logical_topic_key ?? "").includes("category_goal")');
  });

  it("WhatsApp usa identidade de domínio e não o id técnico da sugestão", () => {
    const dispatcher = source("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts");
    expect(dispatcher).toContain("communicationTopicKey");
    expect(dispatcher).not.toContain("`proactive:${candidate.id}:whatsapp`");
    expect(dispatcher).toContain('outboundError?.code === "23505"');
  });

  it("escritas externas invalidam o snapshot do app em tempo real", () => {
    const sync = source("src/components/finance/FinancialRealtimeSync.tsx");
    expect(sync).toContain('table: "transactions"');
    expect(sync).toContain('table: "category_spending_goals"');
    expect(sync).toContain("invalidateFinancialQueries(queryClient)");
    expect(sync).toContain("filter: `user_id=eq.${user.id}`");
  });
});