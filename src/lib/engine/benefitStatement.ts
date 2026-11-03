// Leitura do extrato do Ticket (print): validação determinística do que o modelo de visão devolveu.
// O modelo só TRANSCREVE linhas; datas, valores e duplicados são decididos aqui, nunca pelo modelo.
import { daysBetween, type BenefitEntry } from "./benefitWallet";

export const BENEFIT_STATEMENT_VERSION = "benefit_statement.v1";

export interface BenefitStatementItem {
  kind: "spend" | "credit";
  amount: number;
  occurred_on: string;
  /** HH:MM quando o print mostra (serve de chave para não duplicar). */
  time: string | null;
  merchant: string | null;
}

export interface BenefitStatementParse {
  items: BenefitStatementItem[];
  /** Linhas descartadas por estarem inválidas (valor, data ou tipo). */
  discarded: number;
}

/** O app do ticket mostra o histórico recente; linha mais antiga que isso é leitura errada. */
export const MAX_STATEMENT_AGE_DAYS = 120;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

/** O extrato mostra "02 NOV." sem ano: usa o ano mais recente que não fica no futuro. */
export function inferStatementDate(day: number, month: number, today: string): string | null {
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return null;
  const year = Number(today.slice(0, 4));
  for (const y of [year, year - 1]) {
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) continue; // 31/02 etc.
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    if (iso <= today) return iso;
  }
  return null;
}

function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? round2(v) : null;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/**
 * Formato pedido ao modelo: {"i":[["gasto"|"credito","DD/MM","HH:MM"|null,123.45,"ESTABELECIMENTO"|null], …]}.
 * Aceita linhas fora do formato sem quebrar: descarta e conta.
 */
export function parseBenefitStatement(raw: unknown, today: string): BenefitStatementParse {
  const rows = Array.isArray((raw as { i?: unknown })?.i) ? ((raw as { i: unknown[] }).i) : [];
  const items: BenefitStatementItem[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  for (const row of rows.slice(0, 300)) {
    if (!Array.isArray(row)) { discarded++; continue; }
    const [k, dm, hm, a, m] = row;
    const kind = /^(gasto|spend|debito|débito)$/i.test(String(k)) ? "spend" : /^(credito|crédito|credit)$/i.test(String(k)) ? "credit" : null;
    const dmm = /^(\d{1,2})\/(\d{1,2})$/.exec(String(dm ?? "").trim());
    const amount = parseAmount(a);
    const date = dmm ? inferStatementDate(Number(dmm[1]), Number(dmm[2]), today) : null;
    if (!kind || !amount || !date || daysBetween(date, today) > MAX_STATEMENT_AGE_DAYS) { discarded++; continue; }
    const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hm ?? "").trim());
    const time = t ? `${pad(Number(t[1]))}:${t[2]}` : null;
    const merchant = String(m ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
    const key = [kind, date, time, amount, merchant?.toLowerCase()].join("|");
    if (seen.has(key)) continue; // a mesma linha lida duas vezes no mesmo print
    seen.add(key);
    items.push({ kind, amount, occurred_on: date, time, merchant });
  }
  return { items, discarded };
}

const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface BenefitStatementCandidate extends BenefitStatementItem {
  /** Já existe no Ticket (mesmo tipo, dia, valor e estabelecimento; a hora quando as duas têm). */
  already_recorded: boolean;
}

/** Marca o que já está lançado. Cada lançamento existente absorve no máximo uma linha do print. */
export function markKnownEntries(
  items: BenefitStatementItem[],
  existing: Array<BenefitEntry & { note?: string | null }>,
): BenefitStatementCandidate[] {
  const pool = existing.filter((e) => e.kind === "spend" || e.kind === "credit").map((e) => ({ e, used: false }));
  return items.map((it) => {
    const hit = pool.find((p) => !p.used
      && p.e.kind === it.kind && p.e.occurred_on === it.occurred_on && round2(p.e.amount) === it.amount
      && (it.kind === "credit" || norm(p.e.merchant) === norm(it.merchant))
      && (!it.time || !p.e.note || !/^\d{2}:\d{2}$/.test(p.e.note) || p.e.note === it.time));
    if (hit) hit.used = true;
    return { ...it, already_recorded: !!hit };
  });
}
