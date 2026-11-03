// nino_benefit_alerts.v1 — avisos do Ticket Alimentação por MUDANÇA, sem teto semanal fixo.
// O identificador (fingerprint) carrega o estado (situação + faixa de esgotamento + ciclo): o mesmo estado não
// volta dentro da janela de repetição, e um estado novo (a projeção piorou, a data se deslocou 2+ dias) vira
// aviso novo. Quem controla horário de silêncio, consentimento e prioridade é o pipeline existente.
// Função pura + um carregador; os números vêm do mesmo motor da tela e do agente.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeBenefitState, type BenefitEntry, type BenefitKind, type BenefitState } from "../finance-core/benefitWallet.ts";
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { brlPt } from "./presentation.ts";
import { saoPauloHour } from "./weekdayNudge.ts";

export const BENEFIT_ALERTS_VERSION = "nino_benefit_alerts.v1";

export const BENEFIT_ALERT_RULES = {
  /** Janela de envio (hora local): o silêncio da noite é respeitado já aqui, além do que a política faz. */
  sendFromHour: 8,
  sendUntilHour: 20,
  /** A data de esgotamento precisa se deslocar pelo menos isto (dias) para gerar um aviso novo. */
  shiftBucketDays: 2,
  /** Leitura de saldo mais antiga que isto (dias), com gastos lançados depois, pede uma nova leitura. */
  staleReadingDays: 10,
} as const;

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const days = (n: number) => `${Math.round(n)} ${Math.round(n) === 1 ? "dia" : "dias"}`;

export function isBenefitAlertWindow(now: Date): boolean {
  const hour = saoPauloHour(now);
  return hour >= BENEFIT_ALERT_RULES.sendFromHour && hour < BENEFIT_ALERT_RULES.sendUntilHour;
}

type Ctx = Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">;

export function benefitSituations(state: BenefitState, ctx: Ctx, now: Date): FinancialSituation[] {
  if (!isBenefitAlertWindow(now)) return [];
  const out: FinancialSituation[] = [];
  const base = { primary_domain: "cash" as const, domains: ["cash" as const], signals: [], route: "/app/ticket", priority_score: 0, score_reasons: [] as string[], actionable: true };
  const evidenceBase = { version: BENEFIT_ALERTS_VERSION, as_of: ctx.as_of, reconciliation_id: ctx.snapshot_ref?.reconciliation_id ?? null };

  const p = state.projection;
  if (state.balance !== null && p && (p.status === "short" || p.status === "tight")) {
    const bucket = Math.floor(p.uncovered_days / BENEFIT_ALERT_RULES.shiftBucketDays);
    const critical = p.status === "short";
    const until = p.depletion_date ? dm(p.depletion_date) : dm(state.cycle.next);
    const body = [
      `Seu Ticket acaba em ${until}, ${days(p.uncovered_days)} antes do próximo crédito (${dm(state.cycle.next)}).`,
      `No seu ritmo de ${brlPt(state.rate.per_day)} por dia, faltam cerca de ${brlPt(p.shortfall)} até lá, e isso sai do seu bolso.`,
      state.ideal_per_day ? `Gastando até ${brlPt(state.ideal_per_day)} por dia, o saldo fecha o ciclo.` : "",
    ].filter(Boolean).join(" ");
    out.push({
      ...base,
      fingerprint: `${BENEFIT_ALERTS_VERSION}:projection:${state.cycle.start}:${p.status}:${bucket}`,
      type: "benefit_projection",
      communication_kind: "benefit_projection",
      severity: critical ? "attention" : "info",
      title: critical ? `Seu Ticket deve acabar em ${until}` : "Seu Ticket está no limite até o próximo crédito",
      body,
      impact_amount: p.shortfall,
      days_until: state.cycle.days_left,
      confidence: state.estimated ? 0.7 : 0.85,
      evidence: {
        ...evidenceBase, status: p.status, depletion_date: p.depletion_date, uncovered_days: p.uncovered_days, shortfall: p.shortfall,
        balance: state.balance, rate_per_day: state.rate.per_day, ideal_per_day: state.ideal_per_day, next_credit: state.cycle.next,
      },
    });
  }

  if (state.reading_age_days !== null && state.reading_age_days >= BENEFIT_ALERT_RULES.staleReadingDays && state.spent_in_cycle > 0) {
    out.push({
      ...base,
      fingerprint: `${BENEFIT_ALERTS_VERSION}:stale_reading:${state.cycle.start}:${Math.floor(state.reading_age_days / 7)}`,
      type: "benefit_stale_reading",
      communication_kind: "benefit_stale_reading",
      severity: "info",
      title: "Atualize o saldo do seu Ticket",
      body: `Faz ${days(state.reading_age_days)} que você não confere o saldo do Ticket, então a conta é uma estimativa. Me mande o saldo de hoje (ex.: “ticket 412,40”) para eu ajustar a projeção.`,
      impact_amount: 0,
      days_until: null,
      confidence: 0.6,
      evidence: { ...evidenceBase, reading_age_days: state.reading_age_days },
    });
  }
  return out;
}

/** Lê carteira + lançamentos de quem tem o recurso liberado; sem acesso ou sem carteira, nada. */
export async function loadBenefitState(sb: SupabaseClient, userId: string, today: string): Promise<BenefitState | null> {
  const access = await sb.from("benefit_wallet_access").select("user_id").eq("user_id", userId).maybeSingle();
  if (access.error || !access.data) return null;
  const wallet = await sb.from("benefit_wallets").select("id,monthly_credit,credit_day,carries_over").eq("user_id", userId).eq("active", true).maybeSingle();
  if (wallet.error || !wallet.data) return null;
  const w = wallet.data as any;
  const rows = await sb.from("benefit_entries").select("id,kind,amount,occurred_on,merchant").eq("wallet_id", w.id)
    .order("occurred_on", { ascending: true }).limit(5000);
  if (rows.error) return null;
  const entries: BenefitEntry[] = ((rows.data ?? []) as any[]).map((r) => ({
    id: String(r.id), kind: r.kind as BenefitKind, amount: Number(r.amount),
    occurred_on: String(r.occurred_on).slice(0, 10), merchant: r.merchant ?? null,
  }));
  return computeBenefitState({ monthly_credit: Number(w.monthly_credit), credit_day: Number(w.credit_day), carries_over: w.carries_over === true }, entries, today);
}
