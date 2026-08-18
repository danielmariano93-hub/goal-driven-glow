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
  });

  it("WhatsApp usa identidade de domínio e não o id técnico da sugestão", () => {
    const dispatcher = source("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts");
    expect(dispatcher).toContain("communicationTopicKey");
    expect(dispatcher).not.toContain("`proactive:${candidate.id}:whatsapp`");
  });
});