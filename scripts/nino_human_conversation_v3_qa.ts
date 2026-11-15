import { interpretWithSingleSemanticAuthorityV3 } from "../supabase/functions/_shared/agent/v3/SemanticAuthorityV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../supabase/functions/_shared/agent/v3/TurnSpecV3.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Memory = {
  current_topic: string | null;
  active_category: string | null;
  active_merchant: string | null;
  active_period: { label: string } | null;
  active_references: Array<Record<string, unknown>>;
  last_tool_context: Record<string, unknown> | null;
  last_analysis: Record<string, unknown> | null;
};

const memory: Memory = {
  current_topic: null,
  active_category: null,
  active_merchant: null,
  active_period: null,
  active_references: [],
  last_tool_context: null,
  last_analysis: null,
};

const history: Array<{ role: "user" | "assistant"; content: string }> = [];

function historyText() {
  return history.slice(-14).map((t) => `${t.role === "user" ? "Usuário" : "Nino"}: ${t.content}`).join("\n");
}

function contextText() {
  return JSON.stringify({
    conversation_state: memory,
    qa_fixture: {
      today: "2026-09-28",
      facts_are_simulated_not_for_model_calculation: true,
      available_entities: {
        debt: [{ name: "Empréstimo Lucas", creditor: "Lucas" }],
        goal: [{ name: "Viagem" }],
      },
    },
  });
}

function firstTask(turn: TurnSpecV3 | null) {
  return turn?.kind === "task" ? turn.tasks[0] : null;
}

function filterValue(turn: TurnSpecV3 | null, field: string): string | null {
  const task = firstTask(turn);
  if (task?.kind !== "financial_query") return null;
  return task.filters.find((f) => f.field === field)?.entity.value ?? null;
}

function periodValue(turn: TurnSpecV3 | null): string | null {
  const task = firstTask(turn);
  if (task?.kind !== "financial_query") return null;
  return task.periods[0]?.value ?? null;
}

function updateMemory(turn: TurnSpecV3 | null, simulatedReply: string) {
  if (!turn) return;
  if (turn.kind === "task") {
    const task = turn.tasks[0];
    if (task?.kind === "financial_query") {
      memory.current_topic = `financial:${task.metric}`;
      const cat = task.filters.find((f) => f.field === "category")?.entity.value ?? null;
      if (cat) memory.active_category = cat;
      const period = task.periods[0]?.value ?? null;
      if (period) memory.active_period = { label: period };
      memory.last_tool_context = { tool: task.operation === "trend" ? "spending_timeseries_monthly" : "analyze_spending" };
      memory.last_analysis = { metric: task.metric, operation: task.operation, category: memory.active_category, period: memory.active_period };
    }
    if (task?.kind === "goal_query") memory.current_topic = "goals";
    if (task?.kind === "financial_write") memory.current_topic = `write:${task.action}`;
  }
  history.push({ role: "assistant", content: simulatedReply });
}

function semanticSummary(turn: TurnSpecV3 | null) {
  if (!turn) return "NULL";
  if (turn.kind === "conversation") return `conversation | ${turn.direct_reply}`;
  if (turn.kind === "clarification") return `clarification | ${turn.question}`;
  return turn.tasks.map((t) => {
    if (t.kind === "financial_query") return `financial_query metric=${t.metric} op=${t.operation} group_by=${t.group_by.join(",")} filters=${JSON.stringify(t.filters.map(f => [f.field,f.entity.value,f.entity.source]))} periods=${JSON.stringify(t.periods.map(p => [p.value,p.source]))}`;
    if (t.kind === "financial_write") return `financial_write action=${t.action} slots=${JSON.stringify(t.slots)}`;
    if (t.kind === "goal_query") return `goal_query op=${t.operation} goal=${t.goal?.value ?? ""}`;
    return `advisory op=${t.operation}`;
  }).join(" + ") + ` refs=${JSON.stringify(turn.references)}`;
}

const turns = [
  {
    user: "Oi Nino, tudo bem? Tô tentando entender melhor pra onde meu dinheiro tá indo.",
    check: (t: TurnSpecV3 | null) => t?.kind === "conversation",
    simulated: "Tô com você. Podemos olhar seus gastos por período, categoria ou tendência — por onde quer começar?",
  },
  {
    user: "Pra começar, quanto eu gastei semana passada, do dia 21 ao dia 27?",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.metric === "expense_amount" && q.operation === "sum" && /21/.test(periodValue(t) ?? "") && /27/.test(periodValue(t) ?? "");
    },
    simulated: "De 21 a 27/09, você gastou R$ 1.940,00.",
  },
  {
    user: "E no mês anterior?",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.metric === "expense_amount" && /m[eê]s anterior|m[eê]s passado/i.test(periodValue(t) ?? "");
    },
    simulated: "Em agosto, você gastou R$ 2.450,00.",
  },
  {
    user: "Qual categoria mais pesou nesse mês?",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.metric === "expense_amount" && ["rank","breakdown"].includes(q.operation) && q.group_by.includes("category");
    },
    simulated: "Nesse mês, Moradia foi a categoria que mais pesou, com R$ 1.200,00.",
  },
  {
    user: "E quanto foi só em lazer?",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.metric === "expense_amount" && (filterValue(t,"category") ?? "").toLowerCase() === "lazer";
    },
    simulated: "Em Lazer, foram R$ 700,00 em agosto.",
  },
  {
    user: "Me mostra mês a mês os últimos 4 meses de lazer.",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.operation === "trend" && q.group_by.includes("month") && (filterValue(t,"category") ?? "").toLowerCase() === "lazer" && /4/.test(periodValue(t) ?? "");
    },
    simulated: "Lazer mês a mês: junho R$ 300, julho R$ 450, agosto R$ 700 e setembro R$ 450.",
  },
  {
    user: "Faz um gráfico disso.",
    check: (t: TurnSpecV3 | null) => t !== null && !(t.kind === "task" && t.tasks.some(x => x.kind === "financial_write")),
    simulated: "Claro — vou transformar essa mesma série mensal em gráfico.",
  },
  {
    user: "Agora mudando de assunto: quais dívidas eu tenho?",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.metric === "debt_balance";
    },
    simulated: "Você tem uma dívida ativa: Empréstimo Lucas, saldo R$ 1.200,00.",
    after: () => {
      memory.current_topic = "debt:Empréstimo Lucas";
      memory.active_category = null;
      memory.active_period = null;
      memory.active_references = [{ target: "debt", entity_labels: ["Empréstimo Lucas"], source_tool: "get_debt_status", query_id: "qa-debt-1" }];
    },
  },
  {
    user: "Quanto falta pagar dessa e quando vence a próxima parcela?",
    check: (t: TurnSpecV3 | null) => {
      const q = firstTask(t); return q?.kind === "financial_query" && q.metric === "debt_balance" && (t?.references ?? []).some(r => r.target === "debt");
    },
    simulated: "Faltam R$ 1.200,00. A próxima parcela é de R$ 300,00 e vence em 10/10.",
  },
  {
    user: "Paguei 300 dela hoje.",
    check: (t: TurnSpecV3 | null) => {
      const w = firstTask(t); return w?.kind === "financial_write" && w.action === "debt.pay" && String(w.slots.amount ?? "") === "300" && (t?.references ?? []).some(r => r.target === "debt");
    },
    simulated: "Entendi. Vou preparar o pagamento de R$ 300 dessa dívida para sua confirmação, sem gravar ainda.",
  },
];

let passed = 0;
for (let i = 0; i < turns.length; i++) {
  const turn = turns[i];
  history.push({ role: "user", content: turn.user });
  const outcome = await interpretWithSingleSemanticAuthorityV3({
    text: turn.user,
    history_text: historyText(),
    context_text: contextText(),
  });
  const ok = turn.check(outcome.turn);
  if (ok) passed++;
  let bridge = null;
  if (outcome.turn) bridge = bridgeTurnSpecV3ToRuntime(outcome.turn);
  console.log(JSON.stringify({
    turn: i + 1,
    user: turn.user,
    pass: ok,
    tier: outcome.tier,
    review_required: outcome.review_required,
    review_match: outcome.review_match,
    error: outcome.telemetry.error,
    semantic: semanticSummary(outcome.turn),
    bridge_ok: bridge?.ok ?? null,
    bridge_errors: bridge && !bridge.ok ? bridge.errors : [],
  }));
  updateMemory(outcome.turn, turn.simulated);
  turn.after?.();
  if (i < turns.length - 1) await sleep(35000);
}
console.log(JSON.stringify({ summary: { total: turns.length, passed, failed: turns.length - passed } }));
if (passed !== turns.length) Deno.exit(1);
