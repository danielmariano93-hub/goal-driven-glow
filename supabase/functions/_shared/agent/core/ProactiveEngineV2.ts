// ProactiveEngineV2 — production-safe scanner with true dry-run support,
// explicit source-query failures and actionable detail routes.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadProfile } from "./UserProfile.ts";
import { runAllDetectors, rank, type Insight, type DetectorCtx } from "./InsightsEngine.ts";
import { emotionalReminderDue, EMOTIONAL_REMINDER_KIND } from "../../intelligence/emotionalReminder.ts";
import { DIAGNOSIS_OWNED_KINDS } from "../../intelligence/insightValue.ts";

export type ProactiveSuggestion = {
  id?: string;
  user_id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  action?: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
  channel_ready: "app" | "whatsapp" | "both";
  dedup_key: string;
  expires_at?: string | null;
};

export type ScanOptions = {
  persist?: boolean;
  maxSuggestions?: number;
};

function assertQuery(name: string, error: { message?: string } | null | undefined): void {
  if (error) throw new Error(`${name}:${error.message ?? "query_failed"}`);
}

function fixedCategoryMessage(insight: Insight): Insight {
  if (insight.kind !== "concentration_risk") return insight;
  const category = String(insight.evidence?.category ?? "");
  const fixed = ["moradia", "aluguel", "condomínio", "condominio", "dívidas e empréstimos", "dividas e emprestimos"]
    .includes(category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  if (!fixed) return insight;
  return {
    ...insight,
    title: `${Math.round(Number(insight.evidence?.share ?? 0) * 100)}% das despesas estão em ${category}`,
    body: `${category} parece uma despesa predominantemente fixa. O Nino não recomenda cortar automaticamente; primeiro confirme a composição e identifique somente itens pontuais ou ajustáveis.`,
    evidence: { ...insight.evidence, fixed_category_guard: true },
  };
}

function enrichInsight(insight: Insight): Insight {
  const improved = fixedCategoryMessage(insight);
  if (improved.kind === "goal_at_risk") {
    return {
      ...improved,
      body: `${improved.body} Abra os detalhes para comparar o ritmo necessário com o saldo realmente disponível antes de alterar a meta.`,
      action: { type: "review_goal" },
    };
  }
  if (improved.kind === "forgotten_bill") {
    return { ...improved, action: { type: "review_bill" } };
  }
  return improved;
}

export async function scanUser(
  sb: SupabaseClient,
  userId: string,
  options: ScanOptions = {},
): Promise<ProactiveSuggestion[]> {
  const persist = options.persist !== false;
  const profile = await loadProfile(sb, userId);

  const [txResp, goalsResp, recResp, runsResp, emotionalResp, surfaceResp] = await Promise.all([
    sb.from("transactions")
      .select("id,amount,description,category_id,occurred_at,type,movement_kind")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("occurred_at", new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10))
      .limit(1000),
    sb.from("goals").select("id,name,target_amount,target_date,status").eq("user_id", userId).eq("status", "active"),
    sb.from("recurring_occurrences")
      .select("id,due_date,status,recurring_rules(name,amount)")
      .eq("user_id", userId)
      .gte("due_date", new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10))
      .lte("due_date", new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10))
      .limit(50),
    sb.from("agent_runs")
      // `agent_runs` não tem created_at: a coluna canônica é started_at.
      .select("started_at")
      .eq("user_id", userId)
      .gte("started_at", new Date(Date.now() - 75 * 86400000).toISOString())
      .limit(1000),
    sb.from("emotional_checkins")
      .select("occurred_at").eq("user_id", userId)
      .gte("occurred_at", new Date(Date.now() - 2 * 86400000).toISOString()),
    sb.from("nino_surface_state")
      .select("last_seen_at").eq("user_id", userId).eq("surface", "nino").maybeSingle(),

  ]);
  assertQuery("transactions", txResp.error);
  assertQuery("goals", goalsResp.error);
  assertQuery("recurring_occurrences", recResp.error);
  assertQuery("agent_runs", runsResp.error);
  assertQuery("emotional_checkins", emotionalResp.error);
  assertQuery("nino_surface_state", surfaceResp.error);

  const goalIds = ((goalsResp.data as any[] | null) ?? []).map((goal) => goal.id);
  const contributionByGoal = new Map<string, number>();
  if (goalIds.length > 0) {
    const { data: contributions, error } = await sb.from("goal_contributions")
      .select("goal_id,amount").eq("user_id", userId).in("goal_id", goalIds);
    assertQuery("goal_contributions", error);
    for (const row of (contributions as any[] | null) ?? []) {
      contributionByGoal.set(row.goal_id, (contributionByGoal.get(row.goal_id) ?? 0) + Number(row.amount || 0));
    }
  }

  const activityDates = [
    ...((txResp.data as any[] | null) ?? []).map((row) => String(row.occurred_at)),
    ...((runsResp.data as any[] | null) ?? []).map((row) => String(row.started_at)),
  ].filter(Boolean);
  const uniqueDays = new Set(activityDates.map((value) => value.slice(0, 10)));
  const currentStart = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const previousStart = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const lastActivityAt = activityDates.sort().at(-1) ?? null;

  const ctx: DetectorCtx = {
    transactions: ((txResp.data as any[] | null) ?? []).map((row) => ({
      id: row.id,
      amount: Number(row.amount) || 0,
      description: row.description,
      category_id: row.category_id,
      occurred_at: row.occurred_at,
      type: row.type,
      movement_kind: row.movement_kind,
    })),
    goals: ((goalsResp.data as any[] | null) ?? []).map((goal) => ({
      id: goal.id,
      name: goal.name,
      target: Number(goal.target_amount) || 0,
      current: contributionByGoal.get(goal.id) ?? 0,
      deadline: goal.target_date,
    })),
    bills: ((recResp.data as any[] | null) ?? []).map((row) => ({
      id: row.id,
      name: row.recurring_rules?.name ?? "Conta",
      due_date: row.due_date,
      amount: Number(row.recurring_rules?.amount) || 0,
      paid: row.status === "paid",
    })),
    activity: {
      last_30_days: [...uniqueDays].filter((day) => day >= currentStart).length,
      previous_30_days: [...uniqueDays].filter((day) => day >= previousStart && day < currentStart).length,
      days_since_last_activity: lastActivityAt
        ? Math.max(0, Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86400000))
        : null,
      last_activity_at: lastActivityAt,
    },
  };

  const { data: recentDeliveries, error: deliveryError } = await sb.from("communication_deliveries")
    .select("dedup_key")
    .eq("user_id", userId)
    .in("status", ["queued", "sent", "delivered", "acted"])
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString());
  assertQuery("communication_deliveries", deliveryError);
  const { data: openSuggestions, error: suggestionError } = await sb.from("pending_proactive_suggestions")
    .select("dedup_key").eq("user_id", userId).in("status", ["pending", "dispatched"])
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString());
  assertQuery("pending_proactive_suggestions", suggestionError);
  const { data: feedbackRows, error: feedbackError } = await sb.from("communication_feedback")
    .select("dedup_key,feedback")
    .eq("user_id", userId)
    .in("feedback", ["not_useful", "dismissed"])
    .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
  assertQuery("communication_feedback", feedbackError);
  ctx.cooldowns = new Set([
    ...((recentDeliveries as Array<{ dedup_key: string | null }> | null) ?? []).map((row) => row.dedup_key).filter(Boolean),
    ...((openSuggestions as Array<{ dedup_key: string }> | null) ?? []).map((row) => row.dedup_key),
    ...((feedbackRows as Array<{ dedup_key: string | null }> | null) ?? []).map((row) => row.dedup_key).filter(Boolean),
  ] as string[]);

  // Conteúdo financeiro pertence ao diagnóstico canônico (fonte única). Aqui
  // ficam apenas sinais operacionais, comportamentais e de engajamento.
  const base = runAllDetectors(profile, ctx)
    .filter((insight) => !DIAGNOSIS_OWNED_KINDS.has(insight.kind))
    .map(enrichInsight);
  const insights = rank(base, ctx);
  const max = Math.max(1, Math.min(options.maxSuggestions ?? 8, 20));

  const suggestions: ProactiveSuggestion[] = insights.slice(0, max).map((insight) => {
    const reviewRoute = insight.kind.startsWith("advisor_review")
      ? "/app/assessor/acompanhamento"
      : `/app/alertas/${encodeURIComponent(insight.dedup_key)}`;
    return {
      user_id: userId,
      kind: insight.kind,
      severity: insight.severity,
      title: insight.title,
      body: insight.body,
      action: { ...(insight.action ?? {}), route: reviewRoute },
      evidence: insight.evidence,
      channel_ready: "both", // política (severidade, catálogo, quiet hours) decide o canal
      dedup_key: insight.dedup_key,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
  });

  // Configuração de lembretes é do produto (painel admin), não constante de código.
  const { data: reminderSettings } = await sb.from("proactive_reminder_settings")
    .select("emotional_enabled,emotional_hour,emotional_requires_activity").maybeSingle();

  // Atividade vale em qualquer canal: quem só usa o WhatsApp também é lembrado.
  const surfaceSeenAt = (surfaceResp.data as { last_seen_at?: string | null } | null)?.last_seen_at ?? null;
  const activityAt = [lastActivityAt, surfaceSeenAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const reminder = emotionalReminderDue({
    now: new Date(),
    timezone: (profile as { timezone?: string | null }).timezone ?? "America/Sao_Paulo",
    lastActivityAt: activityAt,
    checkinDates: ((emotionalResp.data as Array<{ occurred_at: string }> | null) ?? []).map((row) => row.occurred_at),
    settings: {
      enabled: (reminderSettings as any)?.emotional_enabled ?? true,
      hour: Number((reminderSettings as any)?.emotional_hour ?? 19),
      requiresActivity: (reminderSettings as any)?.emotional_requires_activity ?? false,
    },
  });
  if (reminder.due && !ctx.cooldowns?.has(`emotional-checkin:${reminder.localDate}`)) {
    suggestions.unshift({
      user_id: userId,
      kind: EMOTIONAL_REMINDER_KIND,
      severity: "info",
      title: "Como foi o seu dia?",
      body: "Se quiser, me conta em uma palavra como você se sentiu hoje — tranquilo, ansioso, cansado, animado. Pode responder aqui mesmo que eu registro pra você, sem julgamento.",
      action: { type: "emotional_checkin", route: "/app/emocoes" },
      evidence: { local_date: reminder.localDate, reason: reminder.reason },
      channel_ready: "both",
      dedup_key: `emotional-checkin:${reminder.localDate}`,
      expires_at: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
  }

  if (!persist || suggestions.length === 0) return suggestions;
  const { data: persisted, error: persistError } = await sb.from("pending_proactive_suggestions")
    .upsert(suggestions, { onConflict: "user_id,dedup_key" })
    .select("id,user_id,kind,severity,title,body,action,evidence,channel_ready,dedup_key,expires_at");
  assertQuery("pending_proactive_suggestions_upsert", persistError);
  return ((persisted as ProactiveSuggestion[] | null) ?? suggestions);
}
