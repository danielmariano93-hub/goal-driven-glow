// Bateria "como um humano": o que o interpretador V3 emite para frases reais do
// WhatsApp percorre ponte → capacidade → ferramenta (resultado realista) → gates
// → texto. Foi assim que apareceram, de uma vez, os defeitos de 01/10/2026:
// meta específica virava visão geral, patrimônio/parcelas ficavam sem texto e
// saúde financeira era barrada como "incompleta".
import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import type { TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { goalNameMatches, foldGoalName } from "../../supabase/functions/_shared/agent/core/GoalNameMatch";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";

const NOW = new Date("2026-10-01T15:00:00-03:00");
const PERIOD = { from: "2026-10-01", to: "2026-10-01", label: "hoje" };
const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });
const turn = (canonical: string, task: unknown): TurnSpecV3 => ({
  version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
  canonical_request: canonical, inherit_topic: false, references: [], tasks: [task as never],
});

// ---- resultados realistas das ferramentas -------------------------------------------------
const goalRow = { id: "g1", category_id: "c1", name: "Alimentação", type: "category", status: "on_track", target: 943.87, achieved: 25, attainment_pct: 100, remaining: 918.87 };
const overBudget = { id: "g2", category_id: "c2", name: "Transporte", type: "category", status: "off_track", target: 846.36, achieved: 900, attainment_pct: 94, remaining: -53.64 };
const savings = { id: "s1", name: "Viagem", type: "savings", status: "active", target: 5000, achieved: 1250, attainment_pct: 25, remaining: 3750 };
const goalsFixture = (args: Record<string, unknown>) => {
  const all = { formula_version: "goals_overview.v2", month: "2026-10", items: [savings], category_goals: [goalRow, overBudget], shared_goals: [], overall_attainment_pct: 73 };
  const name = String(args?.category ?? args?.goal ?? "").trim().toLowerCase();
  if (!name) return all;
  const hit = (n: string) => goalNameMatches(n, name);
  const cats = all.category_goals.filter((g) => hit(g.name)).map((g) => ({ ...g, used_pct: Math.round(g.achieved / g.target * 100), over_limit: g.achieved > g.target }));
  const own = all.items.filter((g) => hit(g.name));
  return { ...all, items: own, category_goals: cats, shared_goals: [], category_filter: { requested: String(args.category ?? args.goal), applied: true, matched: cats.length + own.length }, overall_attainment_pct: 50 };
};
const FIXTURES: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_financial_snapshot: () => ({ available_today: 12345.67, current_month_income: 0, current_month_expense: 285.09, daily_pace: 285.09, typical_daily_pace: 300, projected_month_end_available: 9000, known_future_commitments: 1000, active_debts: [], card_due_this_month: 0 }),
  get_net_worth: () => ({ net_worth: 52000.5, composition: { cash: 12345.67, invested: 45000, account_overdraft: 0, cards_owed: 3000, other_debts: 2345.17 }, explanation: "…", bridge: {}, provenance: {} }),
  get_debt_status: () => ({ engine: "debt_status", facts: { debts_analyzed: 2, overdue_count: 0, overdue_amount: 0, due_soon_count: 1, due_soon_amount: 500, total_outstanding: 8000, undefined_count: 0 }, breakdown: [{ name: "Celular", outstanding_balance: 3000 }, { name: "Banco Pan", outstanding_balance: 5000 }], evidence: {}, answer_format: { headline: "Você tem 2 dívidas ativas." } }),
  get_future_installments: () => ({ horizon_months: 6, total: 4200, by_month: [{ competence_month: "2026-10", total: 700 }, { competence_month: "2026-11", total: 700 }], items: [], count: 6, note: "Competência é o mês em que a parcela entra na fatura." }),
  assess_financial_health: () => ({ engine: "financial_health", facts: { headline: "Você está melhorando: a poupança subiu.", sentences: ["A sobra do mês melhorou."] }, answer_format: { headline: "Você está melhorando." } }),
  get_goals_overview: goalsFixture,
};

async function answer(irQueries: any[]) {
  const ir = {
    version: "financial_query_ir.v2", intent: "lookup",
    queries: irQueries.map((q, i) => ({ id: `q${i + 1}`, operation: "value", group_by: [], limit: null, depends_on: [], ...q, filters: q.filters ?? [] })),
    period: PERIOD, comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null,
  };
  const cap = capabilityFromFinancialIR(ir as never);
  const out: any = await runSemanticTurn({
    text: "frase", acts: ["read_financial"], constraints: { period: false, dimension: false, entity: false }, period: PERIOD, comparison_period: null,
    topic_state: null, max_queries: 1, investigation_enabled: false, now: NOW, failure_reply: "FALHA", authoritative_contract: true, preservation_enforced: true,
  } as never, {
    compile: async () => ({ ir: ir as never, telemetry: null }), loadOptions: async () => [], recordStage: () => {},
    runEngine: async (tool: string, args: Record<string, unknown>) => ({ ok: true, result: (FIXTURES[tool] ?? (() => ({})))(args ?? {}), duration_ms: 1 }),
  } as never);
  return { cap, out, reply: String(out.turn?.reply ?? "") };
}

function expectAnswered(r: Awaited<ReturnType<typeof answer>>) {
  expect(r.cap.capability, "capacidade mapeada").not.toBeNull();
  expect(r.out.errors, "sem bloqueio").toEqual([]);
  expect(r.out.preservation?.compatible).toBe(true);
  expect(r.out.grounding?.ok ?? true).toBe(true);
  expect(r.reply.length).toBeGreaterThan(10);
}

describe("frase → ponte V3: a meta citada no turno não pode ser descartada", () => {
  const bridge = (t: TurnSpecV3) => {
    const r = bridgeTurnSpecV3ToRuntime(t, NOW);
    expect(r.ok).toBe(true);
    return (r as any).contract.financial_read.queries[0];
  };
  it("\"como está minha meta de alimentação?\" leva o nome para a consulta", () => {
    const q = bridge(turn("Como está minha meta de alimentação esse mês?", { kind: "goal_query", family: "goals", operation: "progress", goal: sourced("alimentação") }));
    expect(q).toMatchObject({ metric: "goal_progress", filters: [{ field: "category", value: "alimentação" }] });
  });
  it("visão geral continua sem filtro", () => {
    const q = bridge(turn("Quais metas eu tenho?", { kind: "goal_query", family: "goals", operation: "overview", goal: null }));
    expect(q.filters).toEqual([]);
  });
});

describe("perguntas de estado (o que eu tenho agora) respondem de ponta a ponta", () => {
  const cases: Array<[string, any[], RegExp]> = [
    ["qual meu saldo atual?", [{ metric: "balance" }], /12\.345,67/],
    ["qual meu patrimônio?", [{ metric: "net_worth" }], /patrimônio líquido hoje é de \*?R\$\s52\.000,50/],
    ["quanto eu devo?", [{ metric: "debt_balance" }], /R\$\s8\.000,00/],
    ["quanto tenho de parcelas no cartão?", [{ metric: "future_installments" }], /R\$\s4\.200,00.*6 parcelas/s],
    ["estou melhorando ou piorando?", [{ metric: "financial_health" }], /melhorando/],
    ["quais metas eu tenho?", [{ metric: "goal_progress" }], /Visão geral das suas metas/],
  ];
  for (const [phrase, queries, expected] of cases) {
    it(phrase, async () => {
      const r = await answer(queries);
      expectAnswered(r);
      expect(r.reply).toMatch(expected);
    });
  }
});

describe("meta específica: responde só a meta pedida", () => {
  const ask = (name: string) => answer([{ metric: "goal_progress", filters: [{ field: "category", op: "eq", value: name }] }]);
  it("meta de categoria", async () => {
    const r = await ask("Alimentação");
    expectAnswered(r);
    expect(r.reply).toMatch(/Meta de Alimentação: você usou R\$\s25,00 de R\$\s943,87 \(3%\)/);
    expect(r.reply).not.toContain("Transporte");
    expect(r.reply).not.toContain("Visão geral");
  });
  it("sem acento e em minúsculas", async () => {
    const r = await ask("alimentacao");
    expectAnswered(r);
    expect(r.reply).toContain("Meta de Alimentação");
  });
  it("meta de categoria estourada diz quanto passou", async () => {
    const r = await ask("Transporte");
    expectAnswered(r);
    expect(r.reply).toMatch(/passou do limite em R\$\s53,64/);
  });
  it("meta de guardar dinheiro (não é categoria)", async () => {
    const r = await ask("Viagem");
    expectAnswered(r);
    expect(r.reply).toMatch(/Meta Viagem: R\$\s1\.250,00 de R\$\s5\.000,00 \(25%\)\. Falta R\$\s3\.750,00/);
  });
  it("meta que não existe: resposta honesta e oferta de criar", async () => {
    const r = await ask("Moto");
    expectAnswered(r);
    expect(r.reply).toContain("Você ainda não tem uma meta de Moto");
  });
});

describe("visão geral: meta estourada não vira \"-R$ disponíveis\"", () => {
  it("diz quanto passou do limite", async () => {
    const r = await answer([{ metric: "goal_progress" }]);
    expect(r.reply).toMatch(/Transporte: R\$\s900,00 usados de R\$\s846,36; passou R\$\s53,64 do limite/);
    expect(r.reply).not.toMatch(/-R\$|−R\$/);
  });
});

describe("casamento do nome da meta", () => {
  it("ignora acento, caixa e palavras de ligação", () => {
    for (const asked of ["alimentação", "Alimentacao", "ALIMENTAÇÃO", "a meta de alimentação", "minha meta de alimentacao"]) {
      expect(goalNameMatches("Alimentação", asked), asked).toBe(true);
    }
    expect(foldGoalName("Meta da Viagem")).toBe("viagem");
  });
  it("não casa metas diferentes nem texto vazio", () => {
    expect(goalNameMatches("Transporte", "alimentação")).toBe(false);
    expect(goalNameMatches("Alimentação", "")).toBe(false);
    expect(goalNameMatches("", "alimentação")).toBe(false);
    expect(goalNameMatches("Meta", "meta")).toBe(false);
  });
});

import { humanizeStatusCodes } from "../../supabase/functions/_shared/agent/v3/ConversationalComposerV3";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter";

describe("rede de segurança de texto", () => {
  it("códigos técnicos de status nunca chegam ao usuário", () => {
    expect(humanizeStatusCodes("A meta está at_risk e outra on_track")).toBe("A meta está em risco e outra no ritmo");
  });
  it("saldo por conta responde a conta pedida e é honesto quando ela não existe", () => {
    expect(semanticBlockText("get_account_balance", { accounts: [{ name: "Itaú", balance: 1234.5 }], account_filter: { requested: "Itaú", applied: true } }))
      .toMatch(/Itaú.*1\.234,50/);
    expect(semanticBlockText("get_account_balance", { accounts: [], account_filter: { requested: "XP", applied: false }, available_accounts: ["Itaú", "Nubank"] }))
      .toMatch(/Não encontrei uma conta chamada \*XP\*.*Itaú, Nubank/);
  });
});

describe("projeção do mês (\"quanto sobra até o fim do mês?\")", () => {
  it("forecast_month_close responde e passa nos gates", async () => {
    FIXTURES.forecast_month_close = () => ({
      month: "2026-10", point: 4200.5, low: 3900, high: 4700,
      drivers: { mtd_expense: 1889.9, recurring_future: 620, day_of_month: 2, days_in_month: 31 },
      provenance: { row_count: 19, confidence: "medium" }, notes: [],
    });
    const r = await answer([{ metric: "expense_amount", operation: "forecast" }]);
    expect(r.out.errors).toEqual([]);
    expect(r.reply).toMatch(/4\.200,50/);
  });
});

import { compareSemanticSignaturesV3, semanticSignatureV3 } from "../../supabase/functions/_shared/agent/v3/SemanticComparatorV3";
describe("escrita: leituras equivalentes não divergem por formato de data", () => {
  const turnWith = (date: string) => ({
    version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request", canonical_request: "x", inherit_topic: false, references: [],
    tasks: [{ kind: "financial_write", family: "financial.write", action: "transaction.create", slots: { amount: "35", date } }],
  }) as never;
  it("\"hoje\" equivale à data ISO de hoje", () => {
    const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    expect(compareSemanticSignaturesV3(semanticSignatureV3(turnWith("hoje")), semanticSignatureV3(turnWith(today))).semantic_match).toBe(true);
  });
});

describe("escrita: categoria divergente não bloqueia; valor e estabelecimento continuam bloqueando", () => {
  const t = (list: Array<{ key: string; value: string }>) => { const slots = Object.fromEntries(list.map((x) => [x.key, x.value])); return {
    version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request", canonical_request: "x", inherit_topic: false, references: [],
    tasks: [{ kind: "financial_write", family: "financial.write", action: "transaction.create", slots }],
  } as never; };
  const same = (a: any, b: any) => compareSemanticSignaturesV3(semanticSignatureV3(a), semanticSignatureV3(b)).semantic_match;
  it("categoria", () => {
    expect(same(t([{ key: "amount", value: "35" }, { key: "category", value: "Alimentação" }]), t([{ key: "amount", value: "35" }, { key: "category", value: "Restaurante" }]))).toBe(true);
  });
  it("valor e estabelecimento", () => {
    expect(same(t([{ key: "amount", value: "35" }]), t([{ key: "amount", value: "53" }]))).toBe(false);
    expect(same(t([{ key: "amount", value: "35" }, { key: "merchant", value: "iFood" }]), t([{ key: "amount", value: "35" }, { key: "merchant", value: "Rappi" }]))).toBe(false);
  });
});
