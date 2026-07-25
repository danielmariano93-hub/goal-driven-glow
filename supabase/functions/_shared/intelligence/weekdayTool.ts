// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeWeekdayPattern } from "../analytics/weekdayPattern.ts";
import { asEvidence, composeWeekdayPatternReply } from "./evidence.ts";
import type { SemanticQuery } from "./contracts.ts";

export async function executeWeekdayPattern(args: {
  sb: SupabaseClient;
  user_id: string;
  query: SemanticQuery;
}) {
  const to = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const d = new Date(`${to}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - args.query.period.value * 7 + 1);
  const from = d.toISOString().slice(0, 10);
  const { data, error } = await args.sb.from("transactions")
    .select("id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind")
    .eq("user_id", args.user_id)
    .gte("occurred_at", from)
    .lte("occurred_at", to)
    .order("occurred_at", { ascending: true });
  if (error) throw new Error(error.message);
  const result = computeWeekdayPattern({ transactions: (data ?? []) as any, to, weeks: args.query.period.value });
  result.metric_key = args.query.metric_key;
  return {
    result,
    evidence: asEvidence(result),
    reply: composeWeekdayPatternReply(result, args.query),
  };
}
