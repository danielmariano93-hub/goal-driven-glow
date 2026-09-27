// GoalLifecycleTools — atomic goal creation lifecycle adapter.
// A goal and its optional initial contribution are represented by ONE pending
// confirmation, so confirmation commits both or neither.
// deno-lint-ignore-file no-explicit-any

import type { ToolContext, ToolResult } from "../tools.ts";
import { localDate } from "../../finance-core/ninoClock.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  raw = raw.replace(/r\$/ig, "").replace(/\s/g, "");
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function dateValue(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : null;
}

async function createGoalDraft(ctx: ToolContext, args: any): Promise<ToolResult> {
  const name = String(args.name ?? args.goal ?? "").trim();
  const targetAmount = numberValue(args.target_amount ?? args.amount);
  const initialContribution = numberValue(args.initial_contribution ?? args.contribution_amount);
  const priorityRaw = args.priority == null ? 3 : Number(args.priority);
  const priority = Number.isInteger(priorityRaw) ? priorityRaw : 3;

  if (!name) return { ok: false, error: "goal_name_required" };
  if (targetAmount == null || targetAmount <= 0) return { ok: false, error: "goal_target_amount_required" };
  if (priority < 1 || priority > 5) return { ok: false, error: "goal_priority_invalid" };
  if (initialContribution != null && initialContribution <= 0) return { ok: false, error: "goal_initial_contribution_invalid" };

  const payload = {
    name,
    target_amount: targetAmount,
    target_date: dateValue(args.target_date ?? args.date),
    priority,
    initial_contribution: initialContribution,
    contribution_date: initialContribution != null
      ? (dateValue(args.contribution_date ?? args.occurred_at) ?? localDate())
      : null,
  };

  const summary = initialContribution != null
    ? `Criar a meta “${name}” de ${BRL.format(targetAmount)} e já registrar ${BRL.format(initialContribution)} nela.`
    : `Criar a meta “${name}” de ${BRL.format(targetAmount)}.`;

  const { data, error } = await ctx.sb.rpc("agent_upsert_draft", {
    p_user_id: ctx.user_id,
    p_conversation_id: ctx.conversation_id,
    p_kind: "goal_create",
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 15,
  });
  if (error || !data) return { ok: false, error: `draft_persistence_failed:${error?.message ?? "empty_id"}` };
  return { ok: true, result: { draft_id: String(data), summary } };
}

export function goalLifecycleToolByName(name: string): { execute: (ctx: ToolContext, args: any) => Promise<ToolResult> } | null {
  return name === "lifecycle_goal_create_draft" ? { execute: createGoalDraft } : null;
}
