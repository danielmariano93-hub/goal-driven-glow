// GERADO POR scripts/sync-habits-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/habits/engine/<module>.ts (habits_contract.v1)
// Datas civis "AAAA-MM-DD" (sem fuso). Todas as contas usam meio-dia UTC para fugir de virada de horário de verão.

const parse = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const fmt = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

/** Diferença em dias (b − a). */
export const diffDays = (a: string, b: string): number => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

/** 0 = domingo … 6 = sábado. */
export const dow = (iso: string): number => parse(iso).getUTCDay();

/** Segunda-feira da semana ISO que contém a data. */
export const weekStart = (iso: string): string => {
  const wd = dow(iso);
  return addDays(iso, -((wd + 6) % 7));
};

/** Lista de dias de `from` a `to`, inclusive. Vazia se `to` < `from`. */
export const eachDay = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

export const maxDate = (a: string, b: string): string => (a >= b ? a : b);
