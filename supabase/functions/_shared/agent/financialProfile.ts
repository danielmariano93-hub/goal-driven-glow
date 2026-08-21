// Financial Profile Learning (`financial_profile.v1`)
// ==================================================
// Persiste o PERFIL FINANCEIRO LONGITUDINAL do usuário: baselines pessoais,
// tendências, ponto de virada, meses atípicos e capacidade sustentável de
// poupança. É memória, não cache de conveniência:
//
//  - a chave de frescor é o HASH do histórico considerado (`transactions_hash`);
//    histórico novo ⇒ hash diferente ⇒ o perfil é recalculado e reescrito;
//  - nunca reescreve números: só grava o que os motores determinísticos
//    (`longitudinal.v1` + `wealth_opportunity.v1`) já produziram;
//  - leitura falha nunca vira perfil parcial: quem chama recebe null e segue
//    com o cálculo ao vivo.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { LongitudinalFacts } from "../finance-core/longitudinal.ts";
import type { WealthOpportunityFacts, WealthSource } from "../finance-core/wealthOpportunity.ts";

export const FINANCIAL_PROFILE_VERSION = "financial_profile.v1";

export interface FinancialProfileWrite {
  userId: string;
  asOf: string;
  period: { from: string; to: string };
  longitudinal: LongitudinalFacts;
  wealth: WealthOpportunityFacts;
  sources: WealthSource[];
  netWorth: number;
  confidence?: string | null;
  /** Identidade do histórico considerado (contagem + último movimento + soma). */
  transactionsHash: string;
}

/** Assinatura estável do histórico: muda sempre que entra/sai movimento. */
export function historyFingerprint(
  txs: Array<{ id?: string; occurred_at?: string | null; amount?: number | string | null; updated_at?: string | null }>,
): string {
  let sum = 0;
  let last = "";
  for (const t of txs) {
    sum += Math.round(Number(t.amount ?? 0) * 100);
    const stamp = String(t.updated_at ?? t.occurred_at ?? "");
    if (stamp > last) last = stamp;
  }
  return `${txs.length}:${sum}:${last}`;
}

function medianSavingsRate(facts: LongitudinalFacts): number | null {
  const rates = facts.closed_months
    .map((m) => m.savings_rate)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (rates.length === 0) return null;
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 ? rates[mid] : Math.round(((rates[mid - 1] + rates[mid]) / 2) * 10000) / 10000;
}

function structuralBaseline(facts: LongitudinalFacts): number {
  const closed = facts.closed_months;
  if (closed.length === 0) return 0;
  const total = closed.reduce((a, m) => a + m.structural_expense, 0);
  return Math.round((total / closed.length) * 100) / 100;
}

function incomeBaseline(facts: LongitudinalFacts): number {
  const closed = facts.closed_months;
  if (closed.length === 0) return 0;
  const total = closed.reduce((a, m) => a + (m.income_normalized ?? m.income), 0);
  return Math.round((total / closed.length) * 100) / 100;
}

/**
 * Grava/atualiza o perfil longitudinal. Best-effort: falha de escrita é
 * registrada pelo chamador e nunca interrompe a resposta ao usuário.
 */
export async function persistFinancialProfile(
  sb: SupabaseClient,
  input: FinancialProfileWrite,
): Promise<{ ok: boolean; error?: string }> {
  const row = {
    user_id: input.userId,
    as_of: input.asOf,
    period_from: input.period.from,
    period_to: input.period.to,
    closed_months_analyzed: input.longitudinal.closed_months_analyzed,
    income_baseline: incomeBaseline(input.longitudinal),
    flexible_baseline: input.longitudinal.flexible_median,
    structural_baseline: structuralBaseline(input.longitudinal),
    savings_rate_median: medianSavingsRate(input.longitudinal),
    sustainable_monthly_saving: input.wealth.sustainable_monthly_saving,
    recoverable_monthly: input.wealth.recoverable_monthly,
    net_worth: input.netWorth,
    result_trend: input.longitudinal.result_trend?.direction ?? null,
    behavior_trend: input.longitudinal.behavior_trend?.direction ?? null,
    change_point: input.longitudinal.change_point ?? null,
    extraordinary_months: input.longitudinal.extraordinary_months ?? [],
    flexible_sources: input.sources ?? [],
    months: input.longitudinal.closed_months ?? [],
    transactions_hash: input.transactionsHash,
    formula_version: FINANCIAL_PROFILE_VERSION,
    confidence: input.confidence ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb
    .from("financial_profile_snapshots")
    .upsert(row, { onConflict: "user_id,as_of,period_from,period_to" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Lê o perfil mais recente do usuário. `expectedHash` garante frescor: quando o
 * histórico mudou, devolve null para forçar o recálculo (reprocessamento após
 * histórico novo, sem depender de job externo).
 */
export async function loadFinancialProfile(
  sb: SupabaseClient,
  userId: string,
  expectedHash?: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb
    .from("financial_profile_snapshots")
    .select("*")
    .eq("user_id", userId)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  if (expectedHash && String((data as any).transactions_hash ?? "") !== expectedHash) return null;
  return data as Record<string, unknown>;
}
