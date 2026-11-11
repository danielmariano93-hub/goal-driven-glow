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

/** Em que parte do dia um texto livre costuma cair. Nulo quando não dá para saber ("no domingo", "quando o salário cair"). */
export function periodOfText(text: string): PeriodId | null {
  const l = text.toLowerCase();
  if (/ao longo do dia|durante o dia|o dia todo/.test(l)) return "Durante o dia";
  if (/acordar|caf[eé]|manh[ãa]|começar o dia|comecar o dia|antes de sair/.test(l)) return "Manhã";
  if (/almo[çc]o|tarde|intervalo/.test(l)) return "Tarde";
  if (/trabalho|dormir|noite|jantar|escovar|deitar|chegar em casa/.test(l)) return "Noite";
  return null;
}

/** Sugestões de "ligar a algo que você já faz" para cada parte do dia. */
export const ANCHORS: Record<PeriodId, string[]> = {
  "Manhã": ["ao acordar", "depois do café", "antes de sair de casa"],
  "Tarde": ["depois do almoço", "no intervalo", "no meio da tarde"],
  "Noite": ["depois do trabalho", "depois do jantar", "antes de dormir"],
  "Durante o dia": [],
};

/** Troca a parte do dia sem deixar um detalhe de outro período (ex.: "Manhã · antes de dormir"). */
export function switchPeriod(cue: string, period: PeriodId): string {
  const { anchor } = splitCue(cue);
  const of = anchor ? periodOfText(anchor) : null;
  const keep = anchor && (of === null || of === period);
  return composeCue(period, keep ? anchor : "");
}

/** Texto livre (de uma sugestão ou de um hábito antigo) vira "Período · detalhe". */
export function normalizeCue(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  if (splitCue(t).period) return t;
  const period = periodOfText(t) ?? "Durante o dia";
  if (period === "Durante o dia" && /ao longo do dia|durante o dia|o dia todo/.test(t.toLowerCase())) return "Durante o dia";
  return composeCue(period, t);
}
