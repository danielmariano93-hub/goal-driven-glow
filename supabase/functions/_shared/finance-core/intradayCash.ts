// bank_cash_truth.v2 — intraday reconciliation for live writes.
//
// A bank statement anchor is authoritative for what existed at the instant the
// statement was issued. A transaction entered later on the same calendar day
// must still move current cash. The legacy engine only had `balance_date` and
// therefore swallowed every same-day write. This adapter adjusts ONLY the
// latest exact bank anchor; the canonical engine remains responsible for all
// dates before/after the anchor.

export type IntradayAnchor = {
  account_id: string;
  balance_date: string;
  balance: number;
  status?: string | null;
  anchor_kind?: string | null;
  anchor_observed_at?: string | null;
  [key: string]: unknown;
};

export type IntradayTransaction = {
  id: string;
  account_id?: string | null;
  type: string;
  status: string;
  amount: number;
  occurred_at: string;
  competence_date?: string | null;
  posted_at?: string | null;
  posted_at_source?: string | null;
  payment_method?: string | null;
  credit_card_id?: string | null;
  created_at?: string | null;
  local_occurred_at?: string | null;
  origin?: string | null;
  [key: string]: unknown;
};

const BANK_POSTING_SOURCES = new Set(["statement", "bank", "ofx", "reconciliation"]);
const LIVE_ORIGINS = new Set(["agent", "manual"]);

function validInstant(value: unknown): number | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function saoPauloDate(value: string): string | null {
  const ms = validInstant(value);
  if (ms == null) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((row) => row.type === type)?.value ?? "";
  const y = part("year");
  const m = part("month");
  const d = part("day");
  return y && m && d ? `${y}-${m}-${d}` : null;
}

function hasBankPosting(tx: IntradayTransaction): boolean {
  return Boolean(tx.posted_at) && BANK_POSTING_SOURCES.has(String(tx.posted_at_source ?? ""));
}

function cashDate(tx: IntradayTransaction): string {
  if (hasBankPosting(tx)) return String(tx.posted_at).slice(0, 10);
  return String(tx.competence_date || tx.occurred_at).slice(0, 10);
}

export function liveTransactionObservedAt(tx: IntradayTransaction): string | null {
  if (validInstant(tx.local_occurred_at) != null) return String(tx.local_occurred_at);
  if (!LIVE_ORIGINS.has(String(tx.origin ?? ""))) return null;
  if (validInstant(tx.created_at) == null) return null;
  if (saoPauloDate(String(tx.created_at)) !== cashDate(tx)) return null;
  return String(tx.created_at);
}

function isAccountMovement(tx: IntradayTransaction): boolean {
  if (tx.status !== "confirmed") return false;
  if (tx.type !== "income" && tx.type !== "expense") return false;
  if (!tx.account_id) return false;
  if (tx.credit_card_id) return false;
  return String(tx.payment_method ?? "").toLowerCase() !== "credit_card";
}

export function applyIntradayBankAnchorAdjustments<T extends IntradayAnchor>(
  snapshots: T[],
  transactions: IntradayTransaction[],
): T[] {
  const latestByAccount = new Map<string, { index: number; date: string; observedMs: number }>();

  snapshots.forEach((snapshot, index) => {
    if (snapshot.status && snapshot.status !== "confirmed") return;
    if (snapshot.anchor_kind !== "bank_confirmed") return;
    const observedMs = validInstant(snapshot.anchor_observed_at);
    if (observedMs == null) return;
    const current = latestByAccount.get(snapshot.account_id);
    if (!current || snapshot.balance_date > current.date ||
      (snapshot.balance_date === current.date && observedMs > current.observedMs)) {
      latestByAccount.set(snapshot.account_id, { index, date: snapshot.balance_date, observedMs });
    }
  });

  if (latestByAccount.size === 0) return snapshots;

  const deltaByIndex = new Map<number, number>();
  for (const tx of transactions) {
    if (!isAccountMovement(tx)) continue;
    const anchor = latestByAccount.get(String(tx.account_id));
    if (!anchor) continue;
    if (cashDate(tx) !== anchor.date) continue;
    const txObservedMs = validInstant(liveTransactionObservedAt(tx));
    if (txObservedMs == null || txObservedMs <= anchor.observedMs) continue;
    const signed = tx.type === "income" ? Number(tx.amount || 0) : -Number(tx.amount || 0);
    deltaByIndex.set(anchor.index, (deltaByIndex.get(anchor.index) ?? 0) + signed);
  }

  if (deltaByIndex.size === 0) return snapshots;
  return snapshots.map((snapshot, index) => {
    const delta = deltaByIndex.get(index);
    if (delta == null || Math.abs(delta) < 0.005) return snapshot;
    return {
      ...snapshot,
      balance: Math.round((Number(snapshot.balance || 0) + delta + Number.EPSILON) * 100) / 100,
      intraday_adjustment: Math.round((delta + Number.EPSILON) * 100) / 100,
    } as T;
  });
}
