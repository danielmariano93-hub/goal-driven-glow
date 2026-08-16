// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { aggregateDailyFacts, buildTransactionFacts, type AnticipationTxRow } from "../anticipation/facts.ts";
import { assessDataQuality } from "../anticipation/qualityGates.ts";
import { computeWeekdayPatternFromDailyFacts } from "../analytics/weekdayPattern.ts";
import { asEvidence, composeWeekdayPatternReply } from "./evidence.ts";
import type { SemanticQuery } from "./contracts.ts";

const TX_FIELDS = "id,account_id,category_id,type,status,amount,occurred_at,behavioral_day,behavior_date_source,behavior_date_confidence,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,posted_at,competence_date,occurred_at_time,occurred_at_timezone,occurred_at_precision,category_source,category_confidence";

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

  const [categoriesResp] = await Promise.all([
    args.sb.from("categories")
      .select("id,name")
      .or(`user_id.eq.${args.user_id},user_id.is.null`)
      .is("archived_at", null),
  ]);
  if (categoriesResp.error) throw new Error(`weekday_source_categories:${categoriesResp.error.message}`);
  const categories = ((categoriesResp.data as any[] | null) ?? [])
    .map((c) => ({ id: String(c.id), name: String(c.name) }));

  // A mesma origem do motor de antecipação: lançamentos canônicos -> fatos por
  // lançamento -> fatos diários -> verdade semanal. Nada de fórmula paralela.
  const data: any[] = [];
  const pageSize = 1_000;
  for (let page = 0; page < 100; page += 1) {
    const start = page * pageSize;
    const { data: chunk, error } = await args.sb.from("transactions")
      .select(TX_FIELDS)
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

  const facts = buildTransactionFacts({
    userId: args.user_id,
    txs: data.map((row) => ({ ...row, amount: Number(row.amount ?? 0) })) as AnticipationTxRow[],
    categories,
  });
  const days = aggregateDailyFacts(facts).filter((day) => day.local_date >= from && day.local_date <= to);
  const quality = assessDataQuality(days, {
    minCoverage: 0.65,
    minWindowDays: Math.min(56, args.query.period.value * 7),
    minDaysWithData: 1,
  });

  // Transparência de precisão: quanto da base veio de data de extrato.
  const factById = new Map(facts.map((fact) => [fact.transaction_id, fact]));
  let baseTotal = 0;
  let bankTotal = 0;
  for (const row of data) {
    const fact = factById.get(String(row.id));
    if (!fact || !fact.is_consumption) continue;
    if (fact.local_date < from || fact.local_date > to) continue;
    const value = Math.max(0, Number(fact.amount_net ?? 0));
    baseTotal += value;
    if (String(row.behavior_date_source ?? "") === "bank_posting_date") bankTotal += value;
  }
  const bankPostingShare = baseTotal > 0 ? bankTotal / baseTotal : 0;


  const result = computeWeekdayPatternFromDailyFacts({
    days,
    from,
    to,
    coverage: quality.coverage,
    metricBase: "total_consumption",
    bankPostingShare,
  });
  result.metric_key = args.query.metric_key;
  if (!quality.ok) {
    result.limitations.push(...quality.reasons.map((reason) => `Qualidade dos dados: ${reason}.`));
  }

  return {
    result,
    evidence: asEvidence(result),
    reply: composeWeekdayPatternReply(result, args.query),
  };
}

