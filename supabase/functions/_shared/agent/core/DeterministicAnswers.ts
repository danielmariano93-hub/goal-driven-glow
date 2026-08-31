// DeterministicAnswers — formats factual tool results without asking an LLM
// to calculate, rename fields or infer missing values.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { LLMTurn } from "../llm.ts";
import { runTool } from "./ToolRuntime.ts";
import type { CapabilityDecision } from "./CapabilityRouter.ts";
import { classifyOutcome, isClarification } from "./ToolOutcome.ts";


const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PCT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function money(value: unknown): string { return BRL.format(Number(value ?? 0)); }

export function formatFinancialSnapshot(s: any): string {
  const paceDelta = Number(s.daily_pace ?? 0) - Number(s.typical_daily_pace ?? 0);
  const pace = paceDelta > 0.009
    ? `${money(Math.abs(paceDelta))}/dia acima do seu ritmo de sempre`
    : paceDelta < -0.009
      ? `${money(Math.abs(paceDelta))}/dia abaixo do seu ritmo de sempre`
      : "no seu ritmo de sempre";
  const lines = [
    `Hoje você tem *${money(s.available_today)}* disponível 💛`,
    "",
    `• Entrou este mês: ${money(s.current_month_income)}`,
    `• Você gastou: ${money(s.current_month_expense)}`,
    `• Ritmo: ${money(s.daily_pace)}/dia — ${pace}`,
  ];
  if (Number(s.card_due_this_month ?? 0) > 0) {
    lines.push(`• Cartão a vencer: ${money(s.card_due_this_month)}${s.card_due_estimated ? " (estimativa pelas compras e parcelas já conhecidas)" : ""}`);
  }
  const otherDebt = Array.isArray(s.active_debts)
    ? s.active_debts.reduce((sum: number, debt: any) => sum + Number(debt.outstanding_balance ?? 0), 0)
    : 0;
  if (otherDebt > 0) lines.push(`• Dívidas em aberto: ${money(otherDebt)}`);
  lines.push("", `Se nada mudar, você fecha o mês com cerca de *${money(s.projected_month_end_available)}* — já contando ${money(s.known_future_commitments)} de compromissos que estão na agenda.`);
  return lines.join("\n");
}

export function formatGoalsOverview(result: any): string {
  const personal = Array.isArray(result.items) ? result.items : [];
  const categories = Array.isArray(result.category_goals) ? result.category_goals : [];
  const shared = Array.isArray(result.shared_goals) ? result.shared_goals : [];
  if (!personal.length && !categories.length && !shared.length) {
    return "Você ainda não tem metas cadastradas. Posso te ajudar a criar uma meta financeira, de categoria, doação ou conjunta.";
  }
  const lines = [`Visão geral das suas metas: ${PCT.format(Number(result.overall_attainment_pct ?? 0))}% de atingimento geral.`];
  for (const item of personal.slice(0, 8)) {
    lines.push(`• ${item.name}: ${money(item.achieved)} de ${money(item.target)} (${PCT.format(Number(item.attainment_pct ?? 0))}%). Falta ${money(item.remaining)}.`);
  }
  for (const item of categories.slice(0, 8)) {
    lines.push(`• Categoria ${item.name}: ${money(item.achieved)} usados de ${money(item.target)}; ${money(item.remaining)} disponíveis.`);
  }
  for (const item of shared.slice(0, 5)) {
    lines.push(`• Meta conjunta ${item.title}: alvo de ${money(item.target_amount)}${item.deadline ? ` até ${item.deadline}` : ""}.`);
  }
  return lines.join("\n");
}

/**
 * Plano de meta em texto: quanto, de onde, e o próximo passo.
 * Sai formatado do motor — a IA não reescreve números.
 */
export function formatGoalStrategy(result: any): string {
  const plans = Array.isArray(result?.plans) ? result.plans : [];
  if (!plans.length) {
    return "Você ainda não tem meta ativa para eu montar o plano. Me diga o alvo e o prazo e eu monto com você.";
  }
  const blocks = plans.slice(0, 3).map((plan: any) => {
    const lines = [plan.headline];
    if (plan.requiredMonthly != null && plan.requiredMonthly > 0) {
      lines.push(`• Por mês: ${money(plan.requiredMonthly)}${plan.requiredWeekly ? ` (${money(plan.requiredWeekly)} por semana)` : ""}.`);
    }
    if (plan.currentMonthlyPace > 0) lines.push(`• Ritmo atual: ${money(plan.currentMonthlyPace)} por mês.`);
    if (plan.monthlyGap != null && plan.monthlyGap > 0) lines.push(`• Diferença a cobrir: ${money(plan.monthlyGap)} por mês.`);
    for (const source of (plan.fundingSources ?? []).slice(1, 4)) {
      lines.push(`• De onde tirar: ${source.name} — ${money(source.monthlyAmount)} por mês.`);
    }
    for (const step of (plan.steps ?? []).slice(0, 3)) {
      lines.push(`• ${step.title}: ${step.detail}`);
    }
    for (const alternative of (plan.alternatives ?? []).slice(0, 2)) {
      lines.push(`• ${alternative.label}: ${alternative.detail}`);
    }
    lines.push(`Próximo passo: ${plan.nextAction}`);
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

export function formatBeforeSpending(result: any): string {
  const amount = Number(result.amount ?? 0);
  const date = String(result.planned_date ?? "hoje");
  const lines = [`Simulação de ${money(amount)} em ${date}:`];
  const scenarios = Array.isArray(result.scenarios) ? result.scenarios : [];
  if (scenarios.length > 1) {
    for (const scenario of scenarios) {
      const label = scenario.method === "card" ? `no cartão${scenario.card?.name ? ` ${scenario.card.name}` : ""}` : "à vista/conta";
      lines.push(
        `• ${label}: disponível agora ${money(scenario.available_after_now)}; fechamento do mês ${money(scenario.projected_month_end_after)}${scenario.cash_impact_date ? `; saída em ${scenario.cash_impact_date}` : ""}.`,
      );
    }
  } else {
    lines.push(
      `• disponível imediatamente: ${money(result.available_today)} → ${money(result.available_after_now)}`,
      `• projeção para o fim do mês: ${money(result.projected_month_end_before)} → ${money(result.projected_month_end_after)}`,
    );
  }
  lines.push(`• compromissos futuros já conhecidos: ${money(result.known_future_commitments)}`);
  const category = result.category_goal_impact;
  if (category) {
    lines.push(
      `• meta de ${category.category_name}: ${money(category.spent_before)} → ${money(category.spent_after)} de ${money(category.limit)}`,
      category.exceeds
        ? `Essa compra ultrapassaria a meta em ${money(Math.abs(Number(category.remaining_after ?? 0)))}.`
        : `Depois da compra, restariam ${money(category.remaining_after)} nessa meta.`,
    );
  } else if (result.category_requested) {
    lines.push("A categoria foi identificada, mas ela não tem uma meta ativa; por isso não há limite de categoria para comparar.");
  } else {
    lines.push("Você não informou a categoria; não presumi uma e não calculei impacto em meta de categoria.");
  }
  if (Array.isArray(result.requires_card_selection) && result.requires_card_selection.length) {
    lines.push(`Para comparar também no crédito, diga qual cartão: ${result.requires_card_selection.map((card: any) => card.name).join(", ")}.`);
  }
  if (Array.isArray(result.limitations) && result.limitations.length) {
    lines.push(`Limitação do cálculo: ${result.limitations.join(" ")}`);
  }
  return lines.join("\n");
}

export function formatRecentTransactions(rows: any[]): string {
  if (!rows.length) return "Ainda não há lançamentos registrados.";
  return ["Seus últimos lançamentos 👇", ...rows.map((x) =>
    `• ${x.occurred_at} · ${x.type === "expense" ? "−" : "+"}${money(x.amount)}${x.description ? ` · ${x.description}` : ""}`,
  )].join("\n");
}

export function formatSpendingForDate(result: any): string {
  const count = Number(result.transactions_count ?? 0);
  if (count === 0) {
    const excluded = Number(result.excluded_low_confidence ?? 0);
    return excluded > 0
      ? `Não encontrei gastos em ${result.date}. Deixei de fora ${excluded} lançamento${excluded > 1 ? "s" : ""} que o banco registrou em outro dia.`
      : `Não encontrei gastos de consumo em ${result.date}.`;
  }
  const top = Array.isArray(result.categories) && result.categories[0]
    ? ` A maior categoria foi ${result.categories[0].name}, com ${money(result.categories[0].value)}.`
    : "";
  const excluded = Number(result.excluded_low_confidence ?? 0) > 0
    ? ` Deixei de fora ${result.excluded_low_confidence} lançamento que o banco registrou em outro dia.`
    : "";
  return `Em ${result.date}, você gastou ${money(result.total)} em ${count} lançamento${count > 1 ? "s" : ""}.${top}${excluded}`;
}

const CONFIDENCE_SENTENCE: Record<string, string> = {
  high: "Tenho bastante histórico seu, então essa conta está bem firme.",
  medium: "Ainda pode variar um pouco conforme o mês avança.",
  low: "É uma estimativa inicial, com poucos dados até agora.",
  insufficient_data: "Ainda estou aprendendo seu ritmo, então trate como um primeiro palpite.",
};

export function formatForecastMonthClose(result: any): string {
  const point = money(result.point);
  const drivers = result.drivers ?? {};
  const lines = [
    `Fechando ${String(result.month ?? "").replace("-", "/")}, você deve gastar cerca de *${point}* 📊`,
  ];
  if (result.low != null && result.high != null) {
    lines.push(`Provavelmente entre ${money(result.low)} e ${money(result.high)}.`);
  }
  lines.push(
    "",
    `• Já gastos: ${money(drivers.mtd_expense)} (dia ${drivers.day_of_month} de ${drivers.days_in_month})`,
    `• Já agendado até o fim do mês: ${money(drivers.recurring_future)}`,
    `• O resto é o seu consumo do dia a dia, projetado`,
  );
  const provenance = result.provenance ?? {};
  const rows = provenance.row_count ?? provenance.sample_size;
  const confidence = CONFIDENCE_SENTENCE[String(provenance.confidence ?? "")] ?? "";
  lines.push("", `Base: ${rows ?? 0} lançamentos seus.${confidence ? ` ${confidence}` : ""}`);
  const notes = Array.isArray(result.notes) ? result.notes : [];
  if (notes.length) lines.push(`Vale saber: ${notes.join(" ")}`);
  return lines.join("\n");
}

function datePt(value: unknown): string {
  const raw = String(value ?? "");
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

/**
 * Distribuição por estabelecimento (`merchant_distribution.v1`) — 100%
 * determinística. Ordem, valores e percentuais vêm do motor; nada é
 * recalculado, reordenado ou estimado aqui (e muito menos pela LLM).
 * O denominador do percentual é sempre o TOTAL REAL da categoria.
 */
export function formatMerchantDistribution(result: any): string {
  const categoryName = result?.category?.name ?? null;
  const globalScope = !categoryName || result?.scope === "all_categories";
  const scope = categoryName ? `em ${categoryName}` : "considerando todas as categorias";
  const from = datePt(result?.period?.from);
  const to = datePt(result?.period?.to);
  const total = Number(result?.category_total ?? 0);
  const merchants: any[] = Array.isArray(result?.merchants) ? result.merchants : [];
  if (total <= 0 || merchants.length === 0) {
    return `Não encontrei gastos ${scope} entre ${from} e ${to}.`;
  }
  const ranked = merchants
    .slice()
    .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0));
  const header = globalScope
    ? `Considerando *todas as categorias*, você gastou *${money(total)}* entre ${from} e ${to}.`
    : `Em *${categoryName}*, você gastou *${money(total)}* entre ${from} e ${to}.`;
  const lines = [header, ""];
  ranked.forEach((row) => {
    const pct = PCT.format(Number(row.share_of_category ?? 0) * 100);
    const count = Number(row.transactions_count ?? 0);
    lines.push(
      `• *${row.merchant}* — ${money(row.amount)} · ${pct}%`
      + (count > 1 ? ` · ${count} lançamentos` : ""),
    );
  });
  // Reconciliação: a soma listada nunca pode ser apresentada como o total.
  const listed = ranked.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const unresolved = Number(result?.unresolved_total ?? 0);
  const missing = Math.max(0, total - listed);
  if (unresolved > 1 && Number(result?.coverage ?? 1) < 0.995) {
    lines.push(
      "",
      `Reconheci o estabelecimento de ${money(result?.resolved_total ?? listed)} desse total (${PCT.format(Number(result?.coverage ?? 0) * 100)}% de cobertura). Outros ${money(unresolved)} ainda estão sem estabelecimento identificado.`,
    );
  } else if (missing > 1) {
    lines.push("", `Os demais ${money(missing)} estão espalhados em estabelecimentos menores.`);
  }
  if (globalScope) {
    lines.push("", "Se quiser o mesmo recorte dentro de uma categoria específica, me diga qual.");
  }
  return lines.join("\n");
}


/** Evolução financeira: análise TEXTUAL determinística (nunca gráfico). */
export function formatFinancialEvolution(result: any): string {
  const facts = result?.facts ?? {};
  const windows: any[] = Array.isArray(result?.breakdown) ? result.breakdown : [];
  const w30 = windows.find((w) => w.key === "30d");
  const w90 = windows.find((w) => w.key === "90d");
  const trend = String(facts.trend ?? "estavel");
  const trendPhrase = trend === "melhorando"
    ? "você vem gastando menos que o seu próprio histórico"
    : trend === "piorando"
      ? "seu gasto vem subindo em relação ao seu próprio histórico"
      : "seu gasto está estável em relação ao seu histórico";
  const lines: string[] = [];
  if (w30) {
    lines.push(
      `Nos últimos 30 dias entraram *${money(w30.income)}* e saíram *${money(w30.expense)}* — resultado de ${money(w30.net)}.`,
      "",
      `• Tendência: ${trendPhrase}${facts.expense_trend_pct != null ? ` (${PCT.format(Number(facts.expense_trend_pct))}%)` : ""}`,
    );
  } else {
    lines.push(`Tendência: ${trendPhrase}.`);
  }
  if (w90) lines.push(`• Média mensal de gasto nos 90 dias: ${money(w90.expense_monthly_avg)}`);
  if (facts.savings_rate_30d != null) {
    lines.push(`• Você guardou ${PCT.format(Number(facts.savings_rate_30d) * 100)}% do que entrou nos últimos 30 dias`);
  }
  lines.push(`• Estabilidade dos seus meses: ${String(facts.stability ?? "media")}`);
  if (facts.best_month) lines.push(`• Melhor mês: ${String(facts.best_month.month).replace("-", "/")} com resultado de ${money(facts.best_month.net)}`);
  if (facts.worst_month) lines.push(`• Mês mais difícil: ${String(facts.worst_month.month).replace("-", "/")} com resultado de ${money(facts.worst_month.net)}`);
  return lines.join("\n");
}


function failureReply(capability: CapabilityDecision, error: string | null): string {
  // Raw provider/database errors stay in telemetry and are never exposed to
  // the user. The response says what failed and whether data was changed.
  const suffix = error ? " Já registrei aqui para eu resolver." : "";
  if (capability.name === "before_spending") {
    if (error === "missing_planned_date") return "Preciso da data do gasto para calcular o caixa e a competência corretamente. Nenhum dado foi alterado.";
    if (error === "planned_date_in_past") return "Essa data já passou. Diga uma data de hoje em diante para eu simular sem misturar previsão com histórico; nenhum dado foi alterado.";
    if (error === "category_not_found") return "Não reconheci essa categoria entre as suas categorias cadastradas. Diga o nome como aparece no app; nenhum dado foi alterado.";
    if (error === "card_ambiguous" || error === "card_not_found") return "Preciso saber qual cartão usar para calcular o ciclo e o vencimento corretos. Nenhum dado foi alterado.";
    if (error === "account_not_found") return "Não reconheci a conta informada. Diga o nome como aparece no app; nenhum dado foi alterado.";
    return `Não consegui concluir a simulação agora. Nenhum dado foi alterado.${suffix}`;
  }
  if (capability.name === "goals_overview" || capability.name === "goal_strategy") {
    return `Não consegui carregar suas metas agora. Nenhuma meta foi alterada.${suffix}`;
  }
  return `Não consegui olhar seus dados agora. Nenhum dado foi alterado.${suffix}`;
}


/**
 * Renderizador genérico de envelope de motor (`nino_efficiency.v1`).
 *
 * Deterministic-first v2: quando existe motor determinístico, mas não existe
 * formatter específico para a capability, a resposta ainda NÃO precisa de LLM —
 * os motores já devolvem frases prontas (`facts.headline`, `main_attention`,
 * `main_improvement`, `next_action`, `sentence`). Antes disso, esses turnos
 * caíam no loop de modelo e custavam 21–26k tokens de entrada cada
 * (financial_performance, financial_evolution, debt_status, merchant_*).
 *
 * Regra: só STRINGS produzidas pelo motor são usadas. Nada é recalculado,
 * nenhum número é reformatado, nenhuma conclusão é criada aqui.
 */
export function formatEngineNarrative(result: any): string | null {
  if (!result || typeof result !== "object") return null;
  const facts = (result.facts ?? result) as any;
  const lines: string[] = [];
  const push = (value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (text && !lines.includes(text)) lines.push(text);
  };

  push(facts.headline ?? facts.summary ?? facts.sentence ?? result.headline ?? result.summary);

  const highlight = (node: any, prefix: string) => {
    if (!node || typeof node !== "object") return;
    const title = typeof node.title === "string" ? node.title.trim() : "";
    const body = typeof node.body === "string" ? node.body.trim() : "";
    if (!title && !body) return;
    push(`${prefix} ${[title, body].filter(Boolean).join(" — ")}`);
  };
  highlight(facts.main_attention, "• Atenção:");
  highlight(facts.main_improvement, "• Avanço:");

  const sentences = Array.isArray(facts.sentences) ? facts.sentences
    : Array.isArray(result.sentences) ? result.sentences
    : [];
  for (const sentence of sentences.slice(0, 3)) push(typeof sentence === "string" ? `• ${sentence}` : "");

  const drivers = Array.isArray(result.drivers) ? result.drivers : [];
  for (const driver of drivers.slice(0, 3)) {
    if (driver && typeof driver === "object" && typeof (driver as any).sentence === "string") {
      push(`• ${(driver as any).sentence}`);
    }
  }

  const next = facts.next_action ?? result.next_action;
  if (typeof next === "string" && next.trim()) push(`Próximo passo: ${next.trim()}`);

  // Sem frase do motor não há resposta honesta determinística: o turno segue
  // para o modelo (agora com a evidência já apurada e comprimida).
  if (lines.length < 2) return null;
  return lines.join("\n");
}

export async function executeDeterministicCapability(
  sb: SupabaseClient,
  args: { user_id: string; conversation_id: string; user_text: string; capability: CapabilityDecision },
): Promise<LLMTurn | null> {
  const capability = args.capability;
  if (capability.clarification) {
    return { reply: capability.clarification, steps: 0, tokensIn: 0, tokensOut: 0, toolCalls: [], finish: "stop" };
  }
  if (!capability.required_tool) return null;
  const execution = await runTool({
    sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text,
  }, capability.required_tool, capability.tool_args ?? {}, { timeoutMs: 12_000, maxRetries: 1 });
  const call = {
    step_index: 1, tool_name: execution.tool_name, args: execution.args,
    result: execution.ok ? execution.result : null, ok: execution.ok,
    duration_ms: execution.duration_ms, error: execution.error,
  };
  const outcome = classifyOutcome(execution);
  if (isClarification(outcome.kind) && outcome.ask) {
    // Não é falha técnica: falta um dado. O Nino pergunta.
    return { reply: outcome.ask, steps: 1, tokensIn: 0, tokensOut: 0, toolCalls: [call], finish: "stop" };
  }

  if (!execution.ok) {
    // Degradação honesta: em vez de "problema técnico", o Nino entrega o que
    // o snapshot canônico consegue provar e diz explicitamente o que faltou.
    const calls = [call];
    if (capability.required_tool !== "get_financial_snapshot") {
      const degraded = await runTool({
        sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text,
      }, "get_financial_snapshot", {}, { timeoutMs: 12_000, maxRetries: 0 });
      calls.push({
        step_index: 2, tool_name: degraded.tool_name, args: degraded.args,
        result: degraded.ok ? degraded.result : null, ok: degraded.ok,
        duration_ms: degraded.duration_ms, error: degraded.error,
      });
      if (degraded.ok) {
        return {
          reply: [
            formatFinancialSnapshot(degraded.result),
            `Essa parte mais detalhada não veio agora, então te trouxe o essencial acima. Nada foi alterado nos seus dados.`,
          ].join("\n"),
          steps: 2, tokensIn: 0, tokensOut: 0, toolCalls: calls, finish: "tool_error",
        };
      }
    }
    return {
      reply: failureReply(capability, execution.error), steps: calls.length, tokensIn: 0, tokensOut: 0,
      toolCalls: calls, finish: "tool_error",
    };
  }
  let reply: string;
  // `nino_intent.v1`: leitura do mês resolvida por significado responde com o
  // mesmo motor canônico de caixa — sem texto novo e sem modelo.
  if (capability.name === "financial_snapshot" || (capability.name === "month_report" && capability.required_tool === "get_financial_snapshot")) {
    reply = formatFinancialSnapshot(execution.result);
  }
  else if (capability.name === "goals_overview") reply = formatGoalsOverview(execution.result);

  else if (capability.name === "goal_strategy") reply = formatGoalStrategy(execution.result);
  else if (capability.name === "before_spending") reply = formatBeforeSpending(execution.result);
  else if (capability.name === "recent_transactions") reply = formatRecentTransactions(execution.result as any[]);
  else if (capability.name === "weekday_literal") reply = formatSpendingForDate(execution.result);
  else if (capability.name === "forecast_month_close") reply = formatForecastMonthClose(execution.result);
  // Distribuição por estabelecimento e evolução financeira nunca voltam para a
  // LLM: a resposta sai formatada direto do resultado do motor.
  else if (capability.name === "merchant_distribution") reply = formatMerchantDistribution(execution.result);
  else if (capability.name === "financial_evolution") reply = formatFinancialEvolution(execution.result);
  else if (capability.name === "emotional_checkin") {
    reply = formatEmotionalCheckin(execution.result);
    // Registrar sentimento nunca devolve só recibo: quando o histórico ainda
    // não sustenta a associação, o Nino traz o gasto de hoje comparado ao
    // próprio padrão do mesmo dia da semana e um passo pequeno.
    if ((execution.result as any)?.registered && !(execution.result as any)?.prospective_signal) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      const day = await runTool({
        sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text,
      }, "get_spending_for_date", { date: today }, { timeoutMs: 12_000, maxRetries: 0 });
      if (day.ok) {
        const extra = formatEmotionalDaySignal(day.result);
        if (extra) reply = `${reply}\n\n${extra}`;
        return {
          reply, steps: 2, tokensIn: 0, tokensOut: 0, finish: "stop",
          toolCalls: [call, {
            step_index: 2, tool_name: day.tool_name, args: day.args, result: day.result,
            ok: day.ok, duration_ms: day.duration_ms, error: day.error,
          }],
        };
      }
    }
  }

  else if (capability.name === "emotion_finance") reply = formatEmotionFinance(execution.result);
  else {
    // Deterministic-first v2: tenta o renderizador genérico do envelope antes
    // de escalar para o modelo.
    const narrative = formatEngineNarrative(execution.result);
    if (!narrative) return null;
    reply = narrative;
  }

  return { reply, steps: 1, tokensIn: 0, tokensOut: 0, toolCalls: [call], finish: "stop" };
}


/**
 * Retorno útil do dia: gasto real de hoje (data comportamental) com um passo
 * pequeno. Só usa o que o motor devolveu — nada estimado.
 */
function formatEmotionalDaySignal(result: any): string | null {
  const count = Number(result?.transactions_count ?? 0);
  if (count === 0) {
    return "Hoje ainda não tem gasto registrado. Se aparecer algum, me conta que eu já ligo ao seu humor de hoje.";
  }
  const top = Array.isArray(result?.categories) && result.categories[0]
    ? ` A maior foi ${result.categories[0].name}, com ${money(result.categories[0].value)}.`
    : "";
  return `Hoje você gastou ${money(result?.total)} em ${count} lançamento${count > 1 ? "s" : ""}.${top}`
    + `\nUm passo pequeno: escolha um gasto flexível de hoje e decida se ele valeu o que você está sentindo.`;
}

/** Recibo curto do check-in emocional (registro do dia ou histórico). */

function formatEmotionalCheckin(result: any): string {
  if (result?.registered) {
    const base = String(result.card ?? "Registrei como você se sentiu hoje.");
    const extra = result.updated
      ? "Atualizei o registro de hoje."
      : "Isso me ajuda a ligar o que você sente ao que você gasta.";
    // Sinal prospectivo é associação do histórico da própria pessoa, oferecido
    // como convite — sem julgamento e sem afirmar causa.
    const signal = result.prospective_signal;
    if (signal?.headline) {
      return `${base}\n${extra}\n\n${signal.headline}\n${signal.question ?? ""}`.trim();
    }
    return `${base}\n${extra}`;
  }
  const total = Number(result?.total ?? 0);
  if (!total) {
    return "Ainda não tenho registros de humor seus. Se quiser, me conta em uma palavra como você está hoje que eu guardo.";
  }
  const average = result?.average_mood;
  const recent = (result?.checkins ?? []).slice(0, 3)
    .map((row: any) => `• ${String(row.trigger_label ?? row.emotion_key ?? "registro")}`)
    .join("\n");
  return [
    `Nos últimos ${result?.days ?? 14} dias você fez ${total} registro${total > 1 ? "s" : ""}${
      average != null ? `, com humor médio ${average} de 5` : ""
    }.`,
    recent,
  ].filter(Boolean).join("\n");
}

/**
 * Padrões emoção × gasto. Texto montado a partir das frases do motor, que já
 * são associativas por contrato — aqui não se acrescenta nenhuma causa.
 */
function formatEmotionFinance(result: any): string {
  if (result?.reason === "no_checkins") {
    return [
      "Ainda não tenho registros de como você se sentiu, então não consigo cruzar emoção com gasto sem inventar.",
      "Se você me contar em uma palavra como está em alguns dias, em poucas semanas eu já consigo mostrar o padrão do seu histórico.",
    ].join("\n\n");
  }

  const patterns = (result?.patterns ?? []) as any[];
  const material = patterns.filter((p) => p.material);

  if (material.length === 0) {
    const considered = Number(result?.episodes_considered ?? 0);
    return [
      considered > 0
        ? `Olhei seus ${considered} registro${considered > 1 ? "s" : ""} de humor com gasto no mesmo período e ainda não há associação forte o bastante para eu afirmar algo.`
        : "Ainda não há registros suficientes para eu falar de padrão com honestidade.",
      "Comparo sempre com o seu próprio padrão para o mesmo dia da semana, e prefiro dizer que não sei a arriscar uma leitura frágil.",
    ].join("\n\n");
  }

  const lines = material.slice(0, 3).map((p) => `• ${p.sentence}`);
  const composites = (result?.composites ?? []) as any[];
  const extra = composites.length > 0
    ? `\nQuando junto com o contexto: ${composites[0].sentence}`
    : "";

  return [
    "Isto é o que aparece no seu histórico:",
    lines.join("\n"),
    extra.trim(),
    "São associações observadas nos seus registros, não uma explicação do motivo.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Resposta do motor `goal_performance_assessment.v1` em voz humana:
 * CONCLUSÃO primeiro, depois o porquê categoria por categoria, e o total só
 * das categorias com meta (nunca o gasto global).
 *
 * Nenhum número é recalculado aqui e nenhuma conclusão é inventada: o estado
 * agregado vem do InterpretationResolver e os valores vêm do motor.
 */
export function formatGoalPerformance(
  assessment: any,
  interpretation: { conclusion: string; priority?: { category_name: string; reason: string } | null },
  opts: { comparison_requested: boolean; disclosure?: string | null } = { comparison_requested: true },
): string {
  const categories = Array.isArray(assessment?.categories) ? assessment.categories : [];
  if (!categories.length) {
    return "Você ainda não tem meta por categoria ativa. Se quiser, eu defino um teto com base no seu próprio histórico.";
  }

  const lines: string[] = [interpretation.conclusion];

  for (const c of categories.slice(0, 8)) {
    const goalPart = c.goal?.status === "achieved"
      ? `dentro do teto (${money(c.goal.actual)} de ${money(c.goal.target)})`
      : `acima do teto em ${money(Math.abs(Number(c.goal?.actual ?? 0) - Number(c.goal?.target ?? 0)))} (${money(c.goal?.actual)} de ${money(c.goal?.target)})`;
    const direction = String(c.historical?.direction ?? "equal");
    const immaterial = c.historical?.materiality === "immaterial_change";
    const qualifier = immaterial && direction !== "equal" ? " (variação pequena)" : "";
    const incompatiblePeriod = c.period_compatibility === "incompatible";
    const trendPart = incompatiblePeriod
      ? `; a meta cobre ${datePt(c.goal_period?.from)} a ${datePt(c.goal_period?.to)}, diferente do recorte comparado, então não misturei as duas leituras`
      : !opts.comparison_requested || c.historical?.trend === "insufficient_data"
      ? ""
      : direction === "below"
        ? `, e ${money(Math.abs(Number(c.historical.delta)))} menos que no período anterior${qualifier}`
        : direction === "above"
          ? `, e ${money(Math.abs(Number(c.historical.delta)))} mais que no período anterior${qualifier}`
          : `, praticamente igual ao período anterior`;
    lines.push(`• ${c.category_name}: ${goalPart}${trendPart}.`);
  }

  const agg = assessment?.aggregate;
  if (agg && Number(agg.total_target ?? 0) > 0) {
    const aggregateDirection = String(agg.direction ?? "equal");
    const aggregateDelta = Math.abs(Number(agg.vs_previous ?? 0));
    const aggregateComparison = aggregateDirection === "below"
      ? `${money(aggregateDelta)} menos`
      : aggregateDirection === "above"
        ? `${money(aggregateDelta)} mais`
        : "o mesmo valor";
    const versus = opts.comparison_requested && Number(agg.previous_spend ?? 0) > 0
      ? ` — ${aggregateComparison} que os ${money(agg.previous_spend)} do período anterior`
      : "";
    lines.push(`No conjunto dessas categorias: ${money(agg.current_spend)} de ${money(agg.total_target)} de teto${versus}.`);
  }

  if (interpretation.priority) {
    lines.push(`Onde eu olharia primeiro: ${interpretation.priority.category_name} — ${interpretation.priority.reason}`);
  }
  if (opts.disclosure) lines.push(opts.disclosure);

  return lines.join("\n");
}
