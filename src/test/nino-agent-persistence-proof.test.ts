import { describe, expect, it } from "vitest";
import {
  proofTarget, unprovenMessage, verifyPersisted,
} from "../../supabase/functions/_shared/agent/core/PersistenceProof";
import { decideAutonomy, HIGH_VALUE_BRL } from "../../supabase/functions/_shared/agent/core/AutonomyPolicy";
import {
  CAPABILITIES, capabilityByTool, capabilitySummary, riskOfTool, writeTools,
} from "../../supabase/functions/_shared/agent/core/CapabilityRegistry";

const UUID = "11111111-2222-3333-4444-555555555555";

function fakeSb(row: unknown, error: { message: string } | null = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: () => chain } as any;
}

describe("PersistenceProof", () => {
  it("resolve tabela e id a partir do resultado do RPC", () => {
    expect(proofTarget("transaction", { id: UUID })).toEqual({ table: "transactions", id: UUID });
    expect(proofTarget("goal_contribution", { contribution_id: UUID })?.table).toBe("goal_contributions");
    expect(proofTarget("desconhecido", { id: UUID })).toBeNull();
    expect(proofTarget("transaction", { id: "nao-e-uuid" })).toBeNull();
  });

  it("prova a escrita quando a linha é lida de volta", async () => {
    const proof = await verifyPersisted(fakeSb({ id: UUID }), {
      kind: "transaction", user_id: "u1", result: { id: UUID },
    });
    expect(proof.proven).toBe(true);
    expect(proof.table).toBe("transactions");
  });

  it("não prova quando a linha não existe", async () => {
    const proof = await verifyPersisted(fakeSb(null), {
      kind: "transaction", user_id: "u1", result: { id: UUID },
    });
    expect(proof.proven).toBe(false);
    expect(proof.reason).toBe("row_not_found");
  });

  it("não prova quando a leitura falha", async () => {
    const proof = await verifyPersisted(fakeSb(null, { message: "boom" }), {
      kind: "transaction", user_id: "u1", result: { id: UUID },
    });
    expect(proof.proven).toBe(false);
    expect(proof.reason).toContain("read_back_failed");
  });

  it("aceita idempotência sem id legível", async () => {
    const proof = await verifyPersisted(fakeSb(null), {
      kind: "transaction", user_id: "u1", result: {}, idempotent: true,
    });
    expect(proof.proven).toBe(true);
  });

  it("mensagem honesta nunca afirma que salvou", () => {
    expect(unprovenMessage()).not.toMatch(/registrad[oa]\s*✅/i);
    expect(unprovenMessage()).toMatch(/não vou dizer que salvei/i);
  });
});

describe("CapabilityRegistry", () => {
  it("não tem chaves nem ferramentas duplicadas", () => {
    expect(new Set(CAPABILITIES.map((c) => c.key)).size).toBe(CAPABILITIES.length);
    expect(new Set(CAPABILITIES.map((c) => c.tool)).size).toBe(CAPABILITIES.length);
  });

  it("toda capacidade de escrita tem risco acima de leitura", () => {
    for (const cap of CAPABILITIES.filter((c) => c.writes)) {
      expect(cap.risk).not.toBe("read_only");
    }
    expect(writeTools()).toContain("create_transaction_draft");
    expect(riskOfTool("get_financial_snapshot")).toBe("read_only");
  });

  it("resume capacidades em pt-BR sem jargão", () => {
    const summary = capabilitySummary(["ledger"]);
    expect(summary).toContain("registrar gastos");
    expect(summary).not.toMatch(/tool|rpc|supabase/i);
    expect(capabilityByTool("create_transaction_draft")?.domain).toBe("ledger");
  });
});

describe("AutonomyPolicy", () => {
  it("leitura executa sozinha", () => {
    expect(decideAutonomy({ tool: "get_financial_snapshot", complete: true, user_explicit: false }).mode)
      .toBe("auto_execute");
  });

  it("escrita de risco médio/alto sempre confirma", () => {
    expect(decideAutonomy({ tool: "create_transaction_draft", complete: true, user_explicit: true, amount: 30 }).mode)
      .toBe("draft_then_confirm");
    expect(decideAutonomy({ tool: "draft_transaction_delete", complete: true, user_explicit: true }).mode)
      .toBe("draft_then_confirm");
  });

  it("escrita de baixo risco pedida explicitamente executa direto", () => {
    const d = decideAutonomy({ tool: "log_emotional_checkin", complete: true, user_explicit: true });
    expect(d.mode).toBe("auto_execute");
    expect(d.reason).toBe("low_risk_explicit_request");
  });

  it("valor alto e gatilho proativo nunca executam sozinhos", () => {
    expect(decideAutonomy({ tool: "create_goal_draft", complete: true, user_explicit: true, amount: HIGH_VALUE_BRL }).reason)
      .toBe("high_value");
    expect(decideAutonomy({ tool: "log_emotional_checkin", complete: true, user_explicit: true, proactive: true }).mode)
      .toBe("draft_then_confirm");
  });

  it("ferramenta desconhecida é recusada", () => {
    expect(decideAutonomy({ tool: "drop_database", complete: true, user_explicit: true }).mode).toBe("refuse");
  });
});
