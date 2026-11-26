// Formatação pt-BR determinística (sem Intl, para sair igual no Deno e no Node).
import type { Tone } from "./types.ts";

export const toCents = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** R$ 1.234,56 (centavos sempre). `-R$ 12,00` no negativo. */
export function brl(cents: number, opts: { sign?: boolean; noCents?: boolean } = {}): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  const body = opts.noCents ? `R$ ${group(String(Math.round(abs / 100)))}` : `R$ ${group(String(int))},${dec}`;
  if (neg) return `-${body}`;
  return opts.sign && abs > 0 ? `+${body}` : body;
}

export function pct(p: number, sign = true): string {
  const v = Math.round(p * 100);
  return `${sign && v > 0 ? "+" : ""}${v}%`;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
export const monthLabel = (ym: string) => `${monthName(ym).replace(/^./, (c) => c.toUpperCase())} de ${ym.slice(0, 4)}`;
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
export const shiftMonth = (ym: string, d: number) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
export const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
/** Segunda-feira da semana (ISO) que contém a data. */
export const mondayOf = (iso: string) => { const dow = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7; return addDays(iso, -dow); };

/** "16 a 22/11" ou "28/10 a 03/11" (mês/ano diferentes). */
export function rangeLabel(start: string, endInclusive: string): string {
  if (start.slice(0, 4) !== endInclusive.slice(0, 4)) return `${ddmmyyyy(start)} a ${ddmmyyyy(endInclusive)}`;
  if (start.slice(5, 7) !== endInclusive.slice(5, 7)) return `${ddmm(start)} a ${ddmm(endInclusive)}`;
  return `${start.slice(8, 10)} a ${ddmm(endInclusive)}`;
}

/** Corta no limite sem quebrar palavra (rede de proteção; as frases já nascem dentro do limite). */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Preenche {chaves}; chave ausente quebra (frase nunca sai com lacuna). */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`summary_phrase_missing_var:${k}`);
    return String(vars[k]);
  });
}

export const toneColor: Record<Tone, string> = { neutral: "#21164F", good: "#168361", risk: "#B52D46", attention: "#946000" };
