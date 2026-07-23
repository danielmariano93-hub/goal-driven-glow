// Reconciliation — invariantes contábeis obrigatórias antes de qualquer
// número sair do motor analítico. Cada regra retorna violações estruturadas
// (kind, entity_id, severity, details) para que a LLM narre o problema em vez
// de inventar valor. Também alimenta reconciliation_issues.
import type { TransactionRow } from "./facts.ts";

export type Violation = {
  kind:
    | "transfer_unbalanced"
    | "transfer_legs_invalid"
    | "transfer_same_account"
    | "card_cycle_mismatch"
    | "refund_exceeds_original"
    | "sign_negative_amount"
    | "investment_negative_balance";
  entity_id: string | null;
  severity: "low" | "medium" | "high" | "critical";
  details: Record<string, unknown>;
};

export type ReconciliationResult = {
  ok: boolean;
  violations: Violation[];
  invariants_checked: string[];
};

export function assertInvariants(txs: TransactionRow[]): ReconciliationResult {
  const violations: Violation[] = [];

  // 1. Sinal — amount sempre positivo
  for (const t of txs) {
    if (Number(t.amount) < 0) {
      violations.push({
        kind: "sign_negative_amount",
        entity_id: (t as any).id ?? null,
        severity: "high",
        details: { amount: t.amount, type: t.type },
      });
    }
  }

  // 2. Transferências — soma por grupo = 0, exatamente 2 pernas, contas distintas
  const byGroup = new Map<string, TransactionRow[]>();
  for (const t of txs) {
    const g = (t as any).transfer_group_id;
    if (!g) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(t);
  }
  for (const [g, legs] of byGroup) {
    if (legs.length !== 2) {
      violations.push({
        kind: "transfer_legs_invalid",
        entity_id: g,
        severity: "high",
        details: { legs_count: legs.length },
      });
      continue;
    }
    const [a, b] = legs;
    const kinds = new Set([a.type, b.type]);
    if (!(kinds.has("expense") && kinds.has("income"))) {
      violations.push({ kind: "transfer_legs_invalid", entity_id: g, severity: "high", details: { types: [a.type, b.type] } });
    }
    if ((a as any).account_id && (b as any).account_id && (a as any).account_id === (b as any).account_id) {
      violations.push({ kind: "transfer_same_account", entity_id: g, severity: "high", details: { account_id: (a as any).account_id } });
    }
    const diff = Math.abs(Number(a.amount) - Number(b.amount));
    if (diff > 0.01) {
      violations.push({
        kind: "transfer_unbalanced",
        entity_id: g,
        severity: "critical",
        details: { leg_a: a.amount, leg_b: b.amount, diff },
      });
    }
  }

  // 3. Cartões — soma das compras do ciclo = pagamento que quita
  const cardPayments = txs.filter(t => (t as any).movement_kind === "card_payment" && (t as any).settles_card_id);
  for (const p of cardPayments) {
    const cardId = (p as any).settles_card_id;
    const cycleDate = ((p as any).competence_date ?? (p as any).occurred_at ?? "").slice(0, 7);
    if (!cardId || !cycleDate) continue;
    const cycleTxs = txs.filter(t =>
      (t as any).credit_card_id === cardId &&
      (t as any).payment_method === "credit_card" &&
      String((t as any).competence_date ?? "").slice(0, 7) === cycleDate,
    );
    if (cycleTxs.length === 0) continue; // sem contexto suficiente
    const sum = cycleTxs.reduce((s, t) => s + Number(t.amount), 0);
    const diff = Math.abs(sum - Number(p.amount));
    if (diff > 0.01) {
      violations.push({
        kind: "card_cycle_mismatch",
        entity_id: (p as any).id ?? cardId,
        severity: "high",
        details: { card_id: cardId, cycle: cycleDate, cycle_sum: sum, payment: p.amount, diff },
      });
    }
  }

  // 4. Reembolsos — não excedem original
  const refunds = txs.filter(t => (t as any).movement_kind === "refund");
  for (const r of refunds) {
    const ref = (r as any).refunds_transaction_id ?? (r as any).original_transaction_id;
    if (!ref) continue;
    const original = txs.find(t => (t as any).id === ref);
    if (!original) continue;
    if (Number(r.amount) > Number(original.amount) + 0.01) {
      violations.push({
        kind: "refund_exceeds_original",
        entity_id: (r as any).id ?? null,
        severity: "high",
        details: { refund: r.amount, original: original.amount },
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    invariants_checked: ["signs", "transfers", "card_cycles", "refunds"],
  };
}

/** Gate helper — retorna erro estruturado quando invariantes falham. */
export function reconciliationGate(txs: TransactionRow[]): { ok: true } | { ok: false; error: string; violations: Violation[] } {
  const r = assertInvariants(txs);
  if (r.ok) return { ok: true };
  return { ok: false, error: "reconciliation_failed", violations: r.violations };
}
