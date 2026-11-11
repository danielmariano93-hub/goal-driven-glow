// Momento do dia de um hábito: Manhã, Tarde, Noite ou Durante o dia, com um "depois de..." opcional.
// Fica guardado em `cue_text` como "Manhã" ou "Manhã · depois do café", então hábitos antigos continuam legíveis.
export const PERIODS = [
  { id: "Manhã", hint: "Até o almoço" },
  { id: "Tarde", hint: "Pós-almoço" },
  { id: "Noite", hint: "Fim do dia" },
  { id: "Durante o dia", hint: "Sem hora certa" },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function composeCue(period: PeriodId | null, anchor: string): string {
  const a = anchor.trim();
  if (!period) return "";
  return a ? `${period} · ${lowerFirst(a)}` : period;
}

export function splitCue(text: string | null | undefined): { period: PeriodId | null; anchor: string } {
  const t = (text ?? "").trim();
  for (const p of PERIODS) {
    if (t === p.id) return { period: p.id, anchor: "" };
    if (t.startsWith(`${p.id} · `)) return { period: p.id, anchor: t.slice(p.id.length + 3) };
  }
  return { period: null, anchor: t };
}

/** Texto livre (de uma sugestão ou de um hábito antigo) vira "Período · detalhe". */
export function normalizeCue(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const sp = splitCue(t);
  if (sp.period) return t;
  const l = t.toLowerCase();
  let period: PeriodId = "Durante o dia";
  if (/acordar|caf[eé]|manh[ãa]|começar o dia|comecar o dia/.test(l)) period = "Manhã";
  else if (/almo[çc]o|tarde/.test(l)) period = "Tarde";
  else if (/trabalho|dormir|noite|jantar|escovar|deitar/.test(l)) period = "Noite";
  else if (/ao longo do dia|durante o dia|o dia todo/.test(l)) return "Durante o dia";
  return composeCue(period, t);
}
