// TimeSpec: álgebra de tempo ÚNICA do Nino.
//
// Princípio: o MODELO escolhe um tipo de janela de um vocabulário FECHADO (entende paráfrase, gíria e erro de
// digitação); o CÓDIGO calcula as datas. Nenhuma regex adivinha frase aqui, e nenhuma data sai do modelo.
// Puro e sem relógio global: recebe a data civil de hoje (America/Sao_Paulo) como parâmetro.
import { daysInMonth, shift, today as localToday } from "../finance-core/ninoClock.ts";
import type { ResolvedPeriod } from "../analytics/periodResolver.ts";

export const TIME_SPEC_KINDS = [
  "today", "yesterday",
  "calendar_month",            // offset 0 = este mês, -1 = mês passado, -2 = retrasado...
  "same_days_previous_month",  // os MESMOS dias já decorridos do mês anterior (01/10–18/10 se hoje é 18/11)
  "named_month",               // "outubro", "setembro de 2025"
  "rolling_days",              // últimos N dias, terminando hoje
  "previous_rolling_days",     // os N dias imediatamente ANTES dos últimos N
  "day_range",                 // "do dia 1 ao dia 15" (offset = mês: 0 este, -1 passado)
  "since_day",                 // "desde o dia 5" até hoje, neste mês
  "week",                      // offset 0 = esta semana (seg até hoje), -1 = semana passada
  "year",                      // offset 0 = este ano, -1 = ano passado
  "explicit_range",            // datas citadas literalmente
] as const;
export type TimeSpecKind = typeof TIME_SPEC_KINDS[number];
export const TIME_SPEC_EXTENTS = ["to_date", "whole"] as const;
export type TimeSpecExtent = typeof TIME_SPEC_EXTENTS[number];

/** Forma plana (todos os campos presentes) para caber em esquema estrito de saída estruturada. */
export type TimeSpec = {
  kind: TimeSpecKind;
  offset: number | null;
  extent: TimeSpecExtent | null;
  month: number | null;
  year: number | null;
  days: number | null;
  from_day: number | null;
  to_day: number | null;
  from: string | null;
  to: string | null;
};

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const validIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v)
  && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

function monthKeyOffset(todayIso: string, offset: number): string {
  const [y, m] = todayIso.split("-").map(Number);
  const idx = y * 12 + (m - 1) + offset;
  return `${Math.floor(idx / 12)}-${pad(((idx % 12) + 12) % 12 + 1)}`;
}
const monthLabel = (key: string) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function out(from: string, to: string, label: string, kind: ResolvedPeriod["kind"], spec: TimeSpec, complete: boolean): ResolvedPeriod {
  return { from, to, label, matched: spec.kind, complete, kind };
}

/** Janela do mês `key` ("AAAA-MM"): inteira, ou até `cap` (dia do mês) quando pedido. */
function monthWindow(key: string, todayIso: string, extent: TimeSpecExtent, spec: TimeSpec): ResolvedPeriod {
  const last = daysInMonth(key);
  const isCurrent = key === todayIso.slice(0, 7);
  const from = `${key}-01`;
  if (extent === "to_date") {
    const elapsed = isCurrent ? Number(todayIso.slice(8, 10)) : Math.min(Number(todayIso.slice(8, 10)), last);
    const to = `${key}-${pad(Math.min(elapsed, last))}`;
    return out(from, to, isCurrent ? "este mês até hoje" : `${dmy(from)} a ${dmy(to)}`, "month", spec, to === `${key}-${pad(last)}`);
  }
  const to = `${key}-${pad(last)}`;
  return out(from, to, monthLabel(key), "month", spec, true);
}

/**
 * Resolve um TimeSpec em datas, dado o dia civil de hoje. Devolve `null` quando o spec é inválido ou incoerente
 * (o chamador cai no caminho legado ou pede esclarecimento; nunca inventa janela).
 */
export function resolveTimeSpec(spec: TimeSpec | null | undefined, todayIso: string): ResolvedPeriod | null {
  if (!spec || !validIso(todayIso)) return null;
  const offset = int(spec.offset);
  const extent = spec.extent;
  switch (spec.kind) {
    case "today": return out(todayIso, todayIso, "hoje", "day", spec, true);
    case "yesterday": { const d = shift(todayIso, -1); return out(d, d, "ontem", "day", spec, true); }
    case "calendar_month": {
      const off = offset ?? 0;
      if (off > 0 || off < -60) return null;
      const key = monthKeyOffset(todayIso, off);
      // O mês corrente é "até hoje" por padrão; meses passados são inteiros, salvo pedido de "mesmos dias".
      const ext: TimeSpecExtent = extent ?? (off === 0 ? "to_date" : "whole");
      if (off === 0 && ext === "whole") return monthWindow(key, todayIso, "whole", spec);
      return monthWindow(key, todayIso, ext, spec);
    }
    case "same_days_previous_month": {
      const key = monthKeyOffset(todayIso, -1);
      const r = monthWindow(key, todayIso, "to_date", spec);
      return { ...r, label: "mesmos dias do mês anterior" };
    }
    case "named_month": {
      const m = int(spec.month);
      if (!m || m < 1 || m > 12) return null;
      const [ty, tm] = todayIso.split("-").map(Number);
      const y = int(spec.year) ?? (m > tm ? ty - 1 : ty);
      if (y < 2000 || y > ty + 1) return null;
      const key = `${y}-${pad(m)}`;
      if (key > todayIso.slice(0, 7)) return null;
      const isCurrent = key === todayIso.slice(0, 7);
      return monthWindow(key, todayIso, extent ?? (isCurrent ? "to_date" : "whole"), spec);
    }
    case "rolling_days": {
      const n = int(spec.days);
      if (!n || n < 1 || n > 730) return null;
      return out(shift(todayIso, -(n - 1)), todayIso, `últimos ${n} dias`, "rolling", spec, true);
    }
    case "previous_rolling_days": {
      const n = int(spec.days);
      if (!n || n < 1 || n > 365) return null;
      return out(shift(todayIso, -(2 * n - 1)), shift(todayIso, -n), `${n} dias anteriores`, "range", spec, true);
    }
    case "day_range": {
      const a = int(spec.from_day), b = int(spec.to_day);
      const off = offset ?? 0;
      if (!a || !b || a < 1 || b < a || b > 31 || off > 0 || off < -60) return null;
      const key = monthKeyOffset(todayIso, off);
      const last = daysInMonth(key);
      if (a > last) return null;
      const from = `${key}-${pad(a)}`;
      const to = `${key}-${pad(Math.min(b, last))}`;
      if (from > todayIso) return null;
      return out(from, to > todayIso ? todayIso : to, `${dmy(from)} a ${dmy(to > todayIso ? todayIso : to)}`, "range", spec, to <= todayIso);
    }
    case "since_day": {
      const d = int(spec.from_day) ?? int(spec.days);
      const dom = Number(todayIso.slice(8, 10));
      if (!d || d < 1 || d > dom) return null;
      const from = `${todayIso.slice(0, 7)}-${pad(d)}`;
      return out(from, todayIso, `dia ${d} até hoje`, "range", spec, false);
    }
    case "week": {
      const off = offset ?? 0;
      if (off > 0 || off < -12) return null;
      const dow = new Date(`${todayIso}T12:00:00Z`).getUTCDay();
      const thisMonday = shift(todayIso, -((dow + 6) % 7));
      if (off === 0) return out(thisMonday, todayIso, "esta semana", "week", spec, false);
      const monday = shift(thisMonday, 7 * off);
      return out(monday, shift(monday, 6), off === -1 ? "semana passada" : `${-off} semanas atrás`, "week", spec, true);
    }
    case "year": {
      const off = offset ?? 0;
      if (off > 0 || off < -20) return null;
      const y = Number(todayIso.slice(0, 4)) + off;
      if (off === 0 && (extent ?? "to_date") === "to_date") return out(`${y}-01-01`, todayIso, "este ano até hoje", "range", spec, false);
      return out(`${y}-01-01`, `${y}-12-31`, String(y), "range", spec, true);
    }
    case "explicit_range": {
      if (!validIso(spec.from) || !validIso(spec.to) || spec.from > spec.to) return null;
      return out(spec.from, spec.to, `${dmy(spec.from)} a ${dmy(spec.to)}`, "range", spec, spec.to <= todayIso);
    }
    default: return null;
  }
}

/** Conveniência: usa o relógio civil de São Paulo. */
export function resolveTimeSpecAt(spec: TimeSpec | null | undefined, now: Date = new Date()): ResolvedPeriod | null {
  return resolveTimeSpec(spec, localToday(null, now));
}

/** Valida a forma vinda do modelo e normaliza para o tipo estrito (campos ausentes viram null). */
export function parseTimeSpec(raw: unknown): TimeSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!TIME_SPEC_KINDS.includes(r.kind as TimeSpecKind)) return null;
  const extent = r.extent == null ? null : (TIME_SPEC_EXTENTS.includes(r.extent as TimeSpecExtent) ? r.extent as TimeSpecExtent : undefined);
  if (extent === undefined) return null;
  const num = (v: unknown) => (v == null ? null : (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined));
  const fields = { offset: num(r.offset), month: num(r.month), year: num(r.year), days: num(r.days), from_day: num(r.from_day), to_day: num(r.to_day) };
  if (Object.values(fields).some((v) => v === undefined)) return null;
  const str = (v: unknown) => (v == null ? null : (typeof v === "string" ? v : undefined));
  const from = str(r.from), to = str(r.to);
  if (from === undefined || to === undefined) return null;
  return { kind: r.kind as TimeSpecKind, extent, from, to, ...(fields as { offset: number | null; month: number | null; year: number | null; days: number | null; from_day: number | null; to_day: number | null }) };
}

/** Esquema JSON estrito do TimeSpec, para o contrato de saída do interpretador. */
export const TIME_SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "offset", "extent", "month", "year", "days", "from_day", "to_day", "from", "to"],
  properties: {
    kind: { type: "string", enum: [...TIME_SPEC_KINDS] },
    offset: { anyOf: [{ type: "integer", minimum: -60, maximum: 0 }, { type: "null" }] },
    extent: { anyOf: [{ type: "string", enum: [...TIME_SPEC_EXTENTS] }, { type: "null" }] },
    month: { anyOf: [{ type: "integer", minimum: 1, maximum: 12 }, { type: "null" }] },
    year: { anyOf: [{ type: "integer", minimum: 2000, maximum: 2100 }, { type: "null" }] },
    days: { anyOf: [{ type: "integer", minimum: 1, maximum: 730 }, { type: "null" }] },
    from_day: { anyOf: [{ type: "integer", minimum: 1, maximum: 31 }, { type: "null" }] },
    to_day: { anyOf: [{ type: "integer", minimum: 1, maximum: 31 }, { type: "null" }] },
    from: { anyOf: [{ type: "string" }, { type: "null" }] },
    to: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;
