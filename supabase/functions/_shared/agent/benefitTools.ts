// Ticket Alimentação — leitura para o agente (contexto SEPARADO do livro-razão).
// Determinística: nenhum número nasce do modelo; tudo vem de `benefitWallet.ts` (mesmo motor da tela).
import {
  computeBenefitState, merchantBreakdown, weekdayPattern, whatIf,
  type BenefitEntry, type BenefitKind, type BenefitWalletConfig,
} from "../finance-core/benefitWallet.ts";
import { todaySaoPaulo } from "./parser.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

const KINDS = new Set<string>(["credit", "spend", "balance_reading", "adjustment"]);

export async function get_benefit_status(ctx: ToolContext, args?: { per_day?: number }): Promise<ToolResult> {
  const today = todaySaoPaulo();
  // Acesso por usuário (mesmo padrão `<feature>_access`): sem liberação o recurso "não existe".
  const access = await ctx.sb.from("benefit_wallet_access").select("user_id").eq("user_id", ctx.user_id).maybeSingle();
  if (access.error) return { ok: false, error: `benefit_access_failed:${access.error.message}` };
  if (!access.data) {
    return { ok: true, result: { engine: "get_benefit_status", enabled: false, answer_format: { headline: "O acompanhamento do Ticket Alimentação ainda não está liberado para a sua conta." } } };
  }
  const walletRes = await ctx.sb.from("benefit_wallets")
    .select("id,name,monthly_credit,credit_day,carries_over").eq("user_id", ctx.user_id).eq("active", true).maybeSingle();
  if (walletRes.error) return { ok: false, error: `benefit_wallet_failed:${walletRes.error.message}` };
  const w = walletRes.data as Record<string, unknown> | null;
  if (!w) {
    return { ok: true, result: { engine: "get_benefit_status", enabled: true, configured: false, answer_format: { headline: "Você ainda não cadastrou o seu Ticket Alimentação. Abra Ticket Alimentação no app, informe o valor, o dia em que ele cai e o saldo de hoje." } } };
  }
  const entriesRes = await ctx.sb.from("benefit_entries")
    .select("id,kind,amount,occurred_on,merchant").eq("wallet_id", String(w.id)).eq("user_id", ctx.user_id)
    .order("occurred_on", { ascending: true }).limit(5000);
  if (entriesRes.error) return { ok: false, error: `benefit_entries_failed:${entriesRes.error.message}` };
  const entries: BenefitEntry[] = ((entriesRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => KINDS.has(String(r.kind)))
    .map((r) => ({
      id: String(r.id), kind: r.kind as BenefitKind, amount: Number(r.amount),
      occurred_on: String(r.occurred_on).slice(0, 10), merchant: (r.merchant as string | null) ?? null,
    }));
  const cfg: BenefitWalletConfig = { monthly_credit: Number(w.monthly_credit), credit_day: Number(w.credit_day), carries_over: w.carries_over === true };
  const state = computeBenefitState(cfg, entries, today);
  const pattern = weekdayPattern(entries, today);
  const merchants = merchantBreakdown(entries, state.cycle.start, today, 3);
  const perDay = Number(args?.per_day);
  const scenario = state.balance !== null && Number.isFinite(perDay) && perDay > 0 ? { per_day: perDay, ...whatIf(state, perDay) } : null;
  return {
    ok: true,
    result: {
      engine: "get_benefit_status",
      enabled: true,
      configured: true,
      wallet: { name: String(w.name), monthly_credit: cfg.monthly_credit, credit_day: cfg.credit_day, carries_over: cfg.carries_over },
      today,
      cycle: state.cycle,
      balance: state.balance,
      estimated: state.estimated,
      needs_reading: state.needs_reading,
      inconsistent: state.inconsistent,
      reading_age_days: state.reading_age_days,
      spent_in_cycle: state.spent_in_cycle,
      carry_in: state.carry_in,
      rate_per_day: state.rate.per_day,
      ideal_per_day: state.ideal_per_day,
      projection: state.projection,
      weekday_peak: pattern.peak ? { ...pattern.peak, confidence: pattern.confidence, days_observed: pattern.days_observed } : null,
      top_merchants: merchants.map((m) => ({ merchant: m.merchant, total: m.total, share_pct: m.share_pct })),
      scenario,
    },
  };
}
