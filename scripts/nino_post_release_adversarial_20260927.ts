import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";
import type { TurnSpecV3 } from "../supabase/functions/_shared/agent/v3/TurnSpecV3.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
const pauseMs = Number(Deno.env.get("NINO_TEST_PAUSE_MS") ?? "3500");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

function writeTasks(turn: TurnSpecV3 | null) {
  return turn?.kind === "task" ? turn.tasks.filter((t: any) => t.kind === "financial_write") as any[] : [];
}
function financialTasks(turn: TurnSpecV3 | null) {
  return turn?.kind === "task" ? turn.tasks.filter((t: any) => t.kind === "financial_query") as any[] : [];
}
function goalTasks(turn: TurnSpecV3 | null) {
  return turn?.kind === "task" ? turn.tasks.filter((t: any) => t.kind === "goal_query") as any[] : [];
}
function slot(task: any, key: string) { return task?.slots?.[key]; }
function hasSlotValue(task: any, key: string, expected: string) { return norm(slot(task, key)) === norm(expected); }
function hasFilter(turn: TurnSpecV3 | null, field: string, value: string) {
  return financialTasks(turn).some((t: any) => (t.filters ?? []).some((f: any) => f.field === field && norm(f.entity?.value) === norm(value)));
}
function hasPeriod(turn: TurnSpecV3 | null, fragment: string) {
  return financialTasks(turn).some((t: any) => (t.periods ?? []).some((p: any) => norm(p.value).includes(norm(fragment))));
}
function hasReference(turn: TurnSpecV3 | null, target: string) {
  return !!turn?.references?.some((r: any) => r.target === target);
}
function actionList(turn: TurnSpecV3 | null) { return writeTasks(turn).map((t: any) => t.action); }
function readMetric(turn: TurnSpecV3 | null, metric: string) { return financialTasks(turn).some((t: any) => t.metric === metric); }
function readOperation(turn: TurnSpecV3 | null, op: string) { return financialTasks(turn).some((t: any) => t.operation === op); }
function groupBy(turn: TurnSpecV3 | null, dim: string) { return financialTasks(turn).some((t: any) => (t.group_by ?? []).includes(dim)); }

interface CheckResult { pass: boolean; detail: string }
interface Scenario {
  id: number;
  label: string;
  text: string;
  history?: string;
  context?: string;
  check: (turn: TurnSpecV3 | null, bridge: ReturnType<typeof bridgeTurnSpecV3ToRuntime> | null) => CheckResult;
}

const pass = (detail: string): CheckResult => ({ pass: true, detail });
const fail = (detail: string): CheckResult => ({ pass: false, detail });

function oneAction(action: string, slots?: Record<string, string>) {
  return (turn: TurnSpecV3 | null, bridge: ReturnType<typeof bridgeTurnSpecV3ToRuntime> | null): CheckResult => {
    const writes = writeTasks(turn);
    if (writes.length !== 1 || writes[0].action !== action) return fail(`actions=${JSON.stringify(actionList(turn))}`);
    if (slots) {
      for (const [k, v] of Object.entries(slots)) if (!hasSlotValue(writes[0], k, v)) return fail(`slot_${k}=${JSON.stringify(slot(writes[0], k))}`);
    }
    if (!bridge?.ok) return fail(`bridge=${JSON.stringify(bridge)}`);
    return pass(action);
  };
}

const scenarios: Scenario[] = [
  { id: 1, label: "Criar meta de R$ 25 mil", text: "Crie uma meta Viagem de R$ 25 mil.", check: oneAction("goal.create") },
  { id: 2, label: "Aportar R$ 500 nessa meta", text: "Coloque R$ 500 nessa meta.", history: "Usuário: Crie uma meta Viagem de R$ 25 mil.", context: "Meta ativa: Viagem.", check: (turn, bridge) => {
      const a = oneAction("goal.contribute")(turn, bridge); if (!a.pass) return a;
      return hasReference(turn, "goal") || norm(slot(writeTasks(turn)[0], "goal")).includes("viagem") ? pass("goal.contribute com continuidade") : fail("sem referência/meta");
    } },
  { id: 3, label: "Criar Divisão do Rolê", text: "Crie uma Divisão do Rolê de R$ 480 com Lucas e Ana.", check: oneAction("split.create") },
  { id: 4, label: "Registrar Uber no cartão Itaú em Transporte", text: "Registra R$ 89,90 de Uber no cartão Itaú em Transporte.", check: (turn, bridge) => {
      const a = oneAction("transaction.create")(turn, bridge); if (!a.pass) return a;
      const w = writeTasks(turn)[0];
      if (norm(slot(w, "merchant")) !== "uber") return fail(`merchant=${JSON.stringify(slot(w, "merchant"))}`);
      if (norm(slot(w, "category")) !== "transporte") return fail(`category=${JSON.stringify(slot(w, "category"))}`);
      return pass("transaction.create com merchant/categoria preservados");
    } },
  { id: 5, label: "Transferir Nubank → Itaú", text: "Transfira R$ 300 da Nubank para o Itaú.", check: oneAction("transfer.create") },
  { id: 6, label: "Criar dívida parcelada", text: "Crie uma dívida de R$ 1.200 com Lucas em 4 parcelas.", check: oneAction("debt.create") },
  { id: 7, label: "Pagar fatura do cartão Itaú", text: "Pague a fatura do cartão Itaú.", check: oneAction("card_bill.pay") },
  { id: 8, label: "Excluir lançamento do Uber", text: "Exclua o lançamento do Uber de hoje.", check: oneAction("transaction.delete") },
  { id: 9, label: "Alterar meta", text: "Altere a meta Viagem para R$ 30 mil.", check: oneAction("goal.update") },
  { id: 10, label: "Excluir meta", text: "Exclua a meta Viagem.", check: oneAction("goal.delete") },
  { id: 11, label: "Criar categoria Pets", text: "Crie uma categoria Pets.", check: oneAction("category.create") },
  { id: 12, label: "Renomear categoria Pets", text: "Renomeie a categoria Pets para Pet Shop.", check: oneAction("category.update") },
  { id: 13, label: "Excluir categoria Pet Shop", text: "Exclua a categoria Pet Shop.", check: oneAction("category.delete") },
  { id: 14, label: "Excluir algo ambíguo de ontem", text: "Apaga aquilo de ontem.", check: (turn) => turn?.kind === "clarification" ? pass("clarification") : fail(`kind=${turn?.kind} actions=${JSON.stringify(actionList(turn))}`) },

  { id: 15, label: "Listar dívidas com saldo/parcelas/vencimentos", text: "Quais dívidas eu tenho? Mostra saldo, parcelas e vencimentos.", check: (turn, bridge) => {
      if (turn?.kind !== "task") return fail(`kind=${turn?.kind}`);
      if (!financialTasks(turn).some((t: any) => ["debt_balance", "future_installments"].includes(t.metric))) return fail(`metrics=${JSON.stringify(financialTasks(turn).map((t: any) => t.metric))}`);
      return bridge?.ok ? pass("consulta de dívidas") : fail(`bridge=${JSON.stringify(bridge)}`);
    } },
  { id: 16, label: "Quanto falta pagar dessa dívida?", text: "Quanto falta pagar dessa dívida?", history: "Nino mostrou a dívida Empréstimo Lucas.", context: "Referência ativa: dívida Empréstimo Lucas.", check: (turn, bridge) => readMetric(turn, "debt_balance") && hasReference(turn, "debt") && bridge?.ok ? pass("debt_balance + referência debt") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 17, label: "Pagamento parcial de dívida", text: "Registra R$ 300 de pagamento na dívida do Lucas.", check: oneAction("debt.pay", { debt: "Lucas", amount: "300" }) },
  { id: 18, label: "Quitação total de dívida", text: "Quita a dívida do Lucas.", check: (turn, bridge) => {
      const a = oneAction("debt.pay")(turn, bridge); if (!a.pass) return a;
      const w = writeTasks(turn)[0]; return norm(slot(w, "full_payment")) === "true" ? pass("debt.pay full_payment") : fail(`full_payment=${JSON.stringify(slot(w, "full_payment"))}`);
    } },
  { id: 19, label: "Pagar R$ 200 nessa dívida", text: "Paga R$ 200 nessa.", history: "Nino mostrou a dívida Empréstimo Lucas.", context: "Referência ativa: dívida Empréstimo Lucas.", check: (turn, bridge) => {
      const a = oneAction("debt.pay")(turn, bridge); if (!a.pass) return a;
      return hasReference(turn, "debt") && hasSlotValue(writeTasks(turn)[0], "amount", "200") ? pass("debt.pay + referência debt") : fail(`turn=${JSON.stringify(turn)}`);
    } },
  { id: 20, label: "Dívidas vencidas e próximos 30 dias", text: "Quais dívidas estão vencidas e quais vencem nos próximos 30 dias?", check: (turn, bridge) => {
      if (turn?.kind !== "task") return fail(`kind=${turn?.kind}`);
      const metrics = financialTasks(turn).map((t: any) => t.metric);
      if (!metrics.some((m: string) => ["debt_balance", "future_installments"].includes(m))) return fail(`metrics=${JSON.stringify(metrics)}`);
      return bridge?.ok ? pass("consulta temporal de dívidas") : fail(`bridge=${JSON.stringify(bridge)}`);
    } },
  { id: 21, label: "Listar metas e quanto falta", text: "Quais metas eu tenho e quanto falta para cada uma?", check: (turn, bridge) => goalTasks(turn).some((t: any) => t.operation === "overview") && bridge?.ok ? pass("goal overview") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 22, label: "Criar recorrência Netflix", text: "Todo dia 10 pago R$ 39,90 de Netflix na conta Itaú.", check: oneAction("recurring.create") },
  { id: 23, label: "Compra parcelada em 12x", text: "Comprei uma TV de R$ 3.600 em 12x no cartão Itaú.", check: (turn, bridge) => {
      const a = oneAction("transaction.create")(turn, bridge); if (!a.pass) return a;
      const w = writeTasks(turn)[0];
      const installmentValue = Object.entries(w.slots ?? {}).find(([k]) => norm(k).includes("parcel") || norm(k).includes("installment"))?.[1];
      return norm(installmentValue).includes("12") ? pass("transaction.create 12x") : fail(`installments=${JSON.stringify(installmentValue)}`);
    } },
  { id: 24, label: "Corrigir lançamento Transporte → Lazer", text: "Corrige o último lançamento de Transporte para Lazer.", check: oneAction("transaction.update") },
  { id: 25, label: "Desfazer último lançamento", text: "Desfaz o último lançamento.", check: (turn, bridge) => {
      const acts = actionList(turn); if (acts.length !== 1 || !["transaction.delete", "undo.last"].includes(acts[0])) return fail(`actions=${JSON.stringify(acts)}`);
      return bridge?.ok ? pass(acts[0]) : fail(`bridge=${JSON.stringify(bridge)}`);
    } },
  { id: 26, label: "Meta + aporte inicial composto", text: "Crie uma meta Reserva de Emergência de R$ 20 mil e já coloque R$ 500 nela.", check: (turn, bridge) => {
      const acts = actionList(turn); if (!(acts.includes("goal.create") && acts.includes("goal.contribute"))) return fail(`actions=${JSON.stringify(acts)}`);
      if (!bridge?.ok) return fail(`bridge=${JSON.stringify(bridge)}`);
      return bridge.contract.action?.action === "goal.create" && norm(bridge.contract.action?.slots?.initial_contribution) === "500" ? pass("compilado atomicamente") : fail(`compiled=${JSON.stringify(bridge.contract.action)}`);
    } },
  { id: 27, label: "Recebimento de divisão", text: "O Lucas me pagou R$ 120 daquele rolê hoje.", context: "Divisão ativa: Rolê com Lucas.", check: oneAction("split.receive") },
  { id: 28, label: "Interpretação repetida consistente", text: "Registra R$ 50 de almoço hoje.", check: oneAction("transaction.create") },

  { id: 29, label: "Lazer + estabelecimento Thales", text: "Quanto gastei em lazer no estabelecimento Thales este mês?", check: (turn, bridge) => hasFilter(turn, "category", "Lazer") && hasFilter(turn, "merchant", "Thales") && bridge?.ok ? pass("dois filtros preservados") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 30, label: "Quanto gastei em Lazer sem período explícito", text: "Quanto gastei em lazer?", check: (turn, bridge) => turn?.kind === "task" && hasFilter(turn, "category", "Lazer") && bridge?.ok ? pass("consulta executável sem clarificação desnecessária") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 31, label: "Follow-up: E julho?", text: "E julho?", history: "Usuário: Quanto gastei em alimentação em agosto?", context: "Categoria ativa: Alimentação. Consulta anterior: gastos de Alimentação em agosto.", check: (turn, bridge) => hasFilter(turn, "category", "Alimentação") && hasPeriod(turn, "julho") && bridge?.ok ? pass("herda categoria, troca período") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 32, label: "Follow-up: Quais os estabelecimentos?", text: "Quais os estabelecimentos?", history: "Usuário: Quanto gastei em alimentação em agosto?", context: "Categoria ativa: Alimentação. Período ativo: agosto.", check: (turn, bridge) => groupBy(turn, "merchant") && hasFilter(turn, "category", "Alimentação") && bridge?.ok ? pass("breakdown por merchant") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 33, label: "Follow-up: Qual deles cresceu mais?", text: "Qual deles cresceu mais?", history: "Nino listou os estabelecimentos de Alimentação.", context: "Último resultado: conjunto de estabelecimentos de Alimentação. Referência ativa: estabelecimentos.", check: (turn, bridge) => turn?.kind === "task" && hasReference(turn, "merchant") && bridge?.ok ? pass("referência ao result set de merchants") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 34, label: "Voltar explicitamente para Alimentação", text: "Voltando para alimentação, quanto gastei esse mês?", context: "Tópico anterior: Lazer.", check: (turn, bridge) => hasFilter(turn, "category", "Alimentação") && hasPeriod(turn, "esse mes") && bridge?.ok ? pass("categoria explícita vence contexto") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 35, label: "Série mês a mês últimos 5 meses", text: "Quanto gastei com Alimentação mês a mês nos últimos 5 meses?", check: (turn, bridge) => hasFilter(turn, "category", "Alimentação") && readOperation(turn, "trend") && groupBy(turn, "month") && bridge?.ok ? pass("trend mensal") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 36, label: "Gasto típico mensal sem período", text: "Quanto gasto por mês com Uber?", check: (turn, bridge) => hasFilter(turn, "merchant", "Uber") && readOperation(turn, "value") && financialTasks(turn).every((t: any) => (t.periods ?? []).length === 0) && bridge?.ok ? pass("hábito mensal sem clarificação") : fail(`turn=${JSON.stringify(turn)}`) },

  { id: 37, label: "NOVO — pagar duas parcelas sem inventar valor", text: "Paguei duas parcelas da dívida do Lucas.", check: (turn, bridge) => {
      const a = oneAction("debt.pay")(turn, bridge); if (!a.pass) return a;
      const w = writeTasks(turn)[0];
      if (norm(slot(w, "installments")) !== "2") return fail(`installments=${JSON.stringify(slot(w, "installments"))}`);
      if (slot(w, "amount") != null && String(slot(w, "amount")).trim() !== "") return fail(`inventou amount=${JSON.stringify(slot(w, "amount"))}`);
      return pass("installments=2 sem amount inventado");
    } },
  { id: 38, label: "NOVO — atualizar recorrência", text: "Mude a recorrência da Netflix para R$ 49,90 todo dia 15.", check: oneAction("recurring.update") },
  { id: 39, label: "NOVO — cancelar recorrência", text: "Pare a recorrência da Netflix.", check: oneAction("recurring.delete") },
  { id: 40, label: "NOVO — duas ações de split sem execução parcial", text: "Recebi R$ 120 do Lucas daquele rolê e depois apague a divisão.", context: "Divisão ativa: Rolê com Lucas.", check: (turn, bridge) => {
      const acts = actionList(turn); if (!(acts.includes("split.receive") && acts.includes("split.delete"))) return fail(`actions=${JSON.stringify(acts)}`);
      return bridge && !bridge.ok ? pass("duas intenções preservadas e bridge fail-closed") : fail(`bridge=${JSON.stringify(bridge)}`);
    } },
  { id: 41, label: "NOVO — gasto + transferência no mesmo comando", text: "Registra R$ 50 de almoço e transfere R$ 200 do Nubank para o Itaú.", check: (turn, bridge) => {
      const acts = actionList(turn); if (!(acts.includes("transaction.create") && acts.includes("transfer.create"))) return fail(`actions=${JSON.stringify(acts)}`);
      return bridge && !bridge.ok ? pass("sem execução parcial") : fail(`bridge=${JSON.stringify(bridge)}`);
    } },
  { id: 42, label: "NOVO — criar + renomear categoria no mesmo comando", text: "Crie a categoria Pets e renomeie para Animais.", check: (turn, bridge) => {
      const acts = actionList(turn); if (!(acts.includes("category.create") && acts.includes("category.update"))) return fail(`actions=${JSON.stringify(acts)}`);
      return bridge && !bridge.ok ? pass("preserva as duas ações e bloqueia parcial") : fail(`bridge=${JSON.stringify(bridge)}`);
    } },
  { id: 43, label: "NOVO — exclusão sem contexto", text: "Apaga isso.", check: (turn) => turn?.kind === "clarification" ? pass("clarification") : fail(`kind=${turn?.kind} actions=${JSON.stringify(actionList(turn))}`) },
  { id: 44, label: "NOVO — merchant antes da categoria", text: "Quanto gastei no Thales em Lazer este mês?", check: (turn, bridge) => hasFilter(turn, "merchant", "Thales") && hasFilter(turn, "category", "Lazer") && bridge?.ok ? pass("merchant/category separados") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 45, label: "NOVO — categoria antes do merchant", text: "Quanto gastei em Lazer no Thales este mês?", check: (turn, bridge) => hasFilter(turn, "merchant", "Thales") && hasFilter(turn, "category", "Lazer") && bridge?.ok ? pass("category/merchant separados") : fail(`turn=${JSON.stringify(turn)}`) },
  { id: 46, label: "NOVO — explícito Lazer vence memória Alimentação", text: "E em lazer?", history: "Usuário: Quanto gastei em Alimentação?", context: "Categoria ativa: Alimentação.", check: (turn, bridge) => {
      if (!hasFilter(turn, "category", "Lazer") || !bridge?.ok) return fail(`turn=${JSON.stringify(turn)}`);
      const f = financialTasks(turn).flatMap((t: any) => t.filters ?? []).find((x: any) => x.field === "category");
      return f?.entity?.source === "current_turn" ? pass("current_turn vence memory") : fail(`source=${JSON.stringify(f?.entity?.source)}`);
    } },
  { id: 47, label: "NOVO — referência de dívida não vira meta", text: "Pague R$ 200 nessa dívida.", context: "Referência ativa: dívida Empréstimo Lucas. Meta ativa: Reserva.", check: (turn, bridge) => {
      const a = oneAction("debt.pay")(turn, bridge); if (!a.pass) return a;
      return hasReference(turn, "debt") && !hasReference(turn, "goal") ? pass("debt reference") : fail(`refs=${JSON.stringify(turn?.references)}`);
    } },
  { id: 48, label: "NOVO — recorrência não degrada para lançamento único", text: "Todo mês, no dia 5, pague R$ 79,90 de academia.", check: (turn, bridge) => {
      const acts = actionList(turn); return acts.length === 1 && acts[0] === "recurring.create" && bridge?.ok ? pass("recurring.create") : fail(`actions=${JSON.stringify(acts)}`);
    } },
];

let passed = 0;
let failed = 0;
const results: any[] = [];
for (const scenario of scenarios) {
  let outcome: Awaited<ReturnType<typeof interpretSemanticTurnV3>> | null = null;
  let terminalError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    outcome = await interpretSemanticTurnV3({
      text: scenario.text,
      history_text: scenario.history ?? "",
      context_text: scenario.context ?? "",
      model,
    });
    if (outcome.telemetry.ok && outcome.turn) break;
    terminalError = outcome.telemetry.error ?? outcome.violations.join(",") ?? "unknown";
    if (!/429|rate.?limit|too many requests|deadline|timeout/i.test(terminalError) || attempt === 3) break;
    await sleep(18_000 * attempt);
  }

  let result: CheckResult;
  let bridge: ReturnType<typeof bridgeTurnSpecV3ToRuntime> | null = null;
  if (!outcome?.telemetry.ok || !outcome.turn) {
    result = fail(`provider_or_contract_error=${terminalError || outcome?.telemetry.error || "missing_turn"}`);
  } else {
    bridge = bridgeTurnSpecV3ToRuntime(outcome.turn);
    result = scenario.check(outcome.turn, bridge);
  }

  if (result.pass) passed++; else failed++;
  results.push({
    id: scenario.id,
    label: scenario.label,
    status: result.pass ? "PASS" : "FAIL",
    detail: result.detail,
    latency_ms: outcome?.telemetry.latency_ms ?? null,
    llm_calls: outcome?.telemetry.llm_calls ?? null,
  });
  console.log(`RESULT|${scenario.id}|${result.pass ? "PASS" : "FAIL"}|${scenario.label}|${result.detail}`);
  await sleep(pauseMs);
}

console.log(`SUMMARY|PASS=${passed}|FAIL=${failed}|TOTAL=${scenarios.length}`);
console.log(JSON.stringify({ model, passed, failed, total: scenarios.length, results }, null, 2));
