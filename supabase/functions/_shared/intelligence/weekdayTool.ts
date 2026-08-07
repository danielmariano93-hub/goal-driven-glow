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
  const queryStart = new Date(`${from}T12:00:00Z`);
  queryStart.setUTCDate(queryStart.getUTCDate() - 3);
  const queryEnd = new Date(`${to}T12:00:00Z`);
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 3);
  // Janela de postagem ampliada: uma compra de sexta pode aparecer no banco
  // na segunda. O motor abaixo volta para `behavioral_day` e recorta o
  // período real, sem atribuir o gasto ao dia útil de postagem. Paginação é
  // obrigatória para não formar um padrão sobre uma amostra truncada.
  const data: any[] = [];
  const pageSize = 1_000;
  for (let page = 0; page < 100; page += 1) {
    const start = page * pageSize;
    const { data: chunk, error } = await args.sb.from("transactions")
      .select("id,account_id,category_id,type,status,amount,occurred_at,behavioral_day,behavior_date_source,behavior_date_confidence,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind")
      .eq("user_id", args.user_id)
      .gte("occurred_at", queryStart.toISOString().slice(0, 10))
      .lte("occurred_at", queryEnd.toISOString().slice(0, 10))
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw new Error(`weekday_source_transactions:${error.message}`);
    data.push(...(chunk ?? []));
    if ((chunk ?? []).length < pageSize) break;
    if (page === 99) throw new Error("weekday_source_transactions:limit_exceeded");
  }
  const result = computeWeekdayPattern({ transactions: data as any, to, weeks: args.query.period.value });
  result.metric_key = args.query.metric_key;
  return {
    result,
    evidence: asEvidence(result),
    reply: composeWeekdayPatternReply(result, args.query),
  };
}
