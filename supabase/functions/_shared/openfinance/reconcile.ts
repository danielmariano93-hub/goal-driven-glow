// open_finance_reconcile.v1 — conciliação do mês atual: lançamento PROVISÓRIO (WhatsApp, app)
// x movimento CONFIRMADO do banco. Função pura: não lê nem grava nada.
//
// Princípios acordados com o dono do produto:
//  • o que foi lançado por conversa/app continua valendo durante o dia (é provisório);
//  • quando o banco confirma, o lançamento provisório vira o conciliado — o valor do banco prevalece,
//    mas a categoria e as notas da pessoa ficam; não entra uma segunda linha;
//  • provisório que o banco não mostrou NUNCA é apagado: depois de 5 dias ganha o selo "não apareceu";
//  • o que já está no Nino por extrato (importação) ou já conciliado antes não é tocado.
import { merchantCanonical } from "../categorization/normalize.ts";
import type { ImportItem } from "../import/schema.ts";

export const NOT_SHOWN_AFTER_DAYS = 5;
export const MATCH_WINDOW_DAYS = 4;

export type Provisional = {
  id: string;
  occurred_at: string;
  amount: number;
  type: "income" | "expense";
  description: string | null;
  raw_description?: string | null;
  merchant_name?: string | null;
  origin: string | null;
  category_id?: string | null;
};

export type MatchLevel = "alta" | "valor_diferente" | "duvida";

export type Match = {
  bank: ImportItem;
  tx: Provisional;
  level: MatchLevel;
  amount_delta: number;
  day_delta: number;
};

export type Unmatched = { tx: Provisional; age_days: number; status: "aguardando" | "nao_apareceu" };

export type ReconcilePlan = {
  matches: Match[];
  new_items: ImportItem[];
  unmatched_provisional: Unmatched[];
};

const cents = (v: number) => Math.round(Number(v) * 100);

function dayDiff(a: string, b: string): number {
  const da = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(da) && Number.isFinite(db) ? Math.round((da - db) / 86_400_000) : Number.POSITIVE_INFINITY;
}

function merchantScore(bank: ImportItem, tx: Provisional): number {
  const a = merchantCanonical(bank.merchant ?? bank.raw_description ?? bank.description ?? "");
  const b = merchantCanonical(tx.merchant_name ?? tx.raw_description ?? tx.description ?? "");
  if (!a || !b) return 0;
  if (a === b) return 2;
  return a.includes(b) || b.includes(a) ? 1 : 0;
}

type Candidate = { bank: ImportItem; tx: Provisional; level: MatchLevel; score: number; amount_delta: number; day_delta: number };

function candidateFor(bank: ImportItem, tx: Provisional): Candidate | null {
  if (bank.type !== tx.type) return null;
  const bankDay = bank.posted_at ?? bank.occurred_at;
  const dayDelta = Math.min(
    Math.abs(dayDiff(bankDay ?? "", tx.occurred_at)),
    Math.abs(dayDiff(bank.occurred_at ?? "", tx.occurred_at)),
  );
  if (dayDelta > MATCH_WINDOW_DAYS) return null;

  const delta = (cents(bank.amount) - cents(tx.amount)) / 100;
  const exact = delta === 0;
  const close = Math.abs(delta) <= Math.max(1, bank.amount * 0.1);
  const merchant = merchantScore(bank, tx);

  let level: MatchLevel | null = null;
  if (exact && (dayDelta <= 1 || merchant >= 1)) level = "alta";
  else if (exact) level = "duvida";
  else if (close && merchant >= 1) level = "valor_diferente";
  if (!level) return null;

  const score = (exact ? 10 : 5) + merchant * 3 - dayDelta;
  return { bank, tx, level, score, amount_delta: delta, day_delta: dayDelta };
}

/**
 * Casa itens do banco com lançamentos provisórios. Cada provisório absorve UM item
 * (duas compras iguais no mesmo dia continuam sendo duas).
 */
export function planReconciliation(
  bankItems: ImportItem[],
  provisional: Provisional[],
  today: string,
): ReconcilePlan {
  const pairs: Candidate[] = [];
  for (const bank of bankItems) {
    for (const tx of provisional) {
      const c = candidateFor(bank, tx);
      if (c) pairs.push(c);
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.day_delta - b.day_delta);

  const usedBank = new Set<number>();
  const usedTx = new Set<string>();
  const matches: Match[] = [];
  for (const c of pairs) {
    if (usedBank.has(c.bank.ordinal) || usedTx.has(c.tx.id)) continue;
    usedBank.add(c.bank.ordinal);
    usedTx.add(c.tx.id);
    matches.push({ bank: c.bank, tx: c.tx, level: c.level, amount_delta: c.amount_delta, day_delta: c.day_delta });
  }

  const new_items = bankItems.filter((b) => !usedBank.has(b.ordinal));
  const unmatched_provisional: Unmatched[] = provisional
    .filter((tx) => !usedTx.has(tx.id))
    .map((tx) => {
      const age = Math.max(0, dayDiff(today, tx.occurred_at));
      return { tx, age_days: age, status: age >= NOT_SHOWN_AFTER_DAYS ? "nao_apareceu" as const : "aguardando" as const };
    });
  return { matches, new_items, unmatched_provisional };
}

/**
 * Duas contas do banco podem trazer os MESMOS movimentos (ex.: duas contas com o mesmo final).
 * Se pelo menos metade de um lote já veio num lote anterior, o lote inteiro é tratado como a
 * mesma conta e descartado (coincidências pontuais entre contas diferentes são legítimas).
 */
export function dedupeAcrossAccounts<T extends { id: string; items: ImportItem[] }>(batches: T[]): {
  batches: T[];
  overlaps: Array<{ kept: string; dropped: string; shared: number }>;
} {
  const key = (i: ImportItem) =>
    `${i.posted_at ?? i.occurred_at}|${cents(i.amount)}|${i.type}|${String(i.raw_description ?? i.description).toLowerCase().replace(/\s+/g, " ").trim()}`;
  const owner = new Map<string, string>();
  const overlaps: Array<{ kept: string; dropped: string; shared: number }> = [];
  const out: T[] = [];
  for (const batch of batches) {
    const sharedBy = new Map<string, number>();
    for (const i of batch.items) {
      const o = owner.get(key(i));
      if (o) sharedBy.set(o, (sharedBy.get(o) ?? 0) + 1);
    }
    const top = [...sharedBy.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && batch.items.length > 0 && top[1] / batch.items.length >= 0.5) {
      overlaps.push({ kept: top[0], dropped: batch.id, shared: top[1] });
      out.push({ ...batch, items: [] });
      continue;
    }
    for (const i of batch.items) if (!owner.has(key(i))) owner.set(key(i), batch.id);
    out.push(batch);
  }
  return { batches: out, overlaps };
}
