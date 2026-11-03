// Ticket Alimentação para o agente: métrica de estado `benefit_balance` → get_benefit_status (determinística).
import { describe, expect, it, vi } from "vitest";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
import { FINANCIAL_METRICS } from "../../supabase/functions/_shared/agent/core/FinancialQueryIR";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter";
import { AGENT_TOOLS } from "../../supabase/functions/_shared/agent/tools";

vi.mock("../../supabase/functions/_shared/agent/parser.ts", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  todaySaoPaulo: () => "2026-11-18",
}));
import { get_benefit_status } from "../../supabase/functions/_shared/agent/benefitTools";

const NOW = new Date("2026-11-18T15:00:00Z");
const PERIOD = { from: "2026-11-18", to: "2026-11-18", label: "hoje" };
const ir = () => ({
  version: "financial_query_ir.v2", intent: "lookup",
  queries: [{ id: "q1", metric: "benefit_balance", operation: "value", filters: [], group_by: [], limit: null, depends_on: [] }],
  period: PERIOD, comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null,
});

// Mesmo cenário dourado de benefit-wallet.test.ts: saldo 412,40; ritmo 35,69; acaba em 30/11.
const spends: Array<[string, number, string | null]> = [
  ["2026-11-05", 80, "Mercado Extra"], ["2026-11-06", 45, "Restaurante Sabor & Cia"], ["2026-11-07", 52.8, "iFood"],
  ["2026-11-09", 70.3, "Mercado Extra"], ["2026-11-10", 39, "Padaria"], ["2026-11-12", 21, null],
  ["2026-11-13", 83.5, "Restaurante Sabor & Cia"], ["2026-11-14", 64, "Mercado Extra"], ["2026-11-15", 44, "iFood"],
];
const entryRows = [
  { id: "r", kind: "balance_reading", amount: 12, occurred_on: "2026-11-04", merchant: null },
  ...spends.map(([d, a, m], i) => ({ id: `s${i}`, kind: "spend", amount: a, occurred_on: d, merchant: m })),
];

function fakeSb(opts: { access: boolean; wallet: boolean }) {
  const table = (name: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => {
        if (name === "benefit_wallet_access") return { data: opts.access ? { user_id: "u1" } : null, error: null };
        return { data: opts.wallet ? { id: "w1", name: "Ticket Alimentação", monthly_credit: 900, credit_day: 5, carries_over: true } : null, error: null };
      },
      then: (res: (v: unknown) => unknown) => res({ data: name === "benefit_entries" ? entryRows : [], error: null }),
    };
    return q;
  };
  return { from: table } as never;
}
const ctx = (o: { access: boolean; wallet: boolean }) => ({ sb: fakeSb(o), user_id: "u1", conversation_id: "c1" });

describe("Ticket Alimentação — leitura pelo agente", () => {
  it("a métrica existe no IR e mapeia para a ferramenta determinística", () => {
    expect(FINANCIAL_METRICS).toContain("benefit_balance");
    const cap = capabilityFromFinancialIR(ir() as never);
    expect(cap.unsupported_queries).toEqual([]);
    expect(cap.mapped_tools).toEqual(["get_benefit_status"]);
    expect(AGENT_TOOLS.some((t) => t.name === "get_benefit_status")).toBe(true);
  });

  it("a ferramenta reproduz os números do motor da tela (saldo, ritmo, esgotamento)", async () => {
    const out = await get_benefit_status(ctx({ access: true, wallet: true }) as never);
    expect(out.ok).toBe(true);
    const r = (out as any).result;
    expect(r.balance).toBe(412.4);
    expect(r.rate_per_day).toBe(35.69);
    expect(r.projection.depletion_date).toBe("2026-11-30");
    expect(r.cycle.days_left).toBe(17);
  });

  it("cenário 'e se eu gastar R$ 24 por dia' vem do motor, não do modelo", async () => {
    const out = await get_benefit_status(ctx({ access: true, wallet: true }) as never, { per_day: 24 });
    expect((out as any).result.scenario).toMatchObject({ per_day: 24, status: "ok", leftover: 4.4 });
  });

  it("sem liberação ou sem carteira, responde honesto e sem número", async () => {
    const off = (await get_benefit_status(ctx({ access: false, wallet: false }) as never) as any).result;
    expect(off.enabled).toBe(false);
    const none = (await get_benefit_status(ctx({ access: true, wallet: false }) as never) as any).result;
    expect(none.configured).toBe(false);
    expect(semanticBlockText("get_benefit_status", none)).toMatch(/ainda não cadastrou/);
  });

  it("o pipeline responde com os números do resultado, sem violar preservation nem grounding", async () => {
    const result = (await get_benefit_status(ctx({ access: true, wallet: true }) as never) as any).result;
    const out = await runSemanticTurn({
      text: "quanto tenho de ticket?", acts: ["read_financial"], constraints: { period: false, dimension: false, entity: false },
      period: PERIOD, comparison_period: null, topic_state: null, max_queries: 1, investigation_enabled: false,
      now: NOW, failure_reply: "falha", authoritative_contract: true, preservation_enforced: true,
    } as never, {
      compile: async () => ({ ir: ir() as never, telemetry: null }),
      loadOptions: async () => [], recordStage: () => {},
      runEngine: async () => ({ ok: true, result, duration_ms: 5 }),
    } as never) as any;
    expect(out.errors).toEqual([]);
    expect(out.preservation?.compatible).toBe(true);
    expect(out.grounding?.ok).toBe(true);
    expect(out.turn?.reply).toContain("412,40");
    expect(out.turn?.reply).toContain("30/11");
  });
});
