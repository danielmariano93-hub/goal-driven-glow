// "E no mês seguinte?" / "e no mês anterior?" deslocam o período do turno ANTERIOR, não o de hoje. O modelo errava
// isso (repetia o mês ou caía no mês atual). Aqui o deslocamento é calculado em código e entregue ao interpretador
// como fato pronto, junto do contexto da conversa.

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const plain = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** "mês seguinte/anterior" do turno atual: +1, -1 ou null. "mês passado" e "próximo mês" são relativos a HOJE e ficam de fora. */
export function periodShiftDirection(text: string): 1 | -1 | null {
  const t = plain(text);
  if (/\b(?:no|pro|para o|do|ao)\s+(?:mes\s+)?(?:seguinte|posterior|depois)\b|\bmes\s+(?:seguinte|posterior)\b/.test(t)) return 1;
  if (/\b(?:no|pro|para o|do|ao)\s+(?:mes\s+)?anterior\b|\bmes\s+anterior\b/.test(t)) return -1;
  return null;
}

function monthOf(isoDate: string): { y: number; m: number } | null {
  const hit = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate ?? "");
  return hit ? { y: Number(hit[1]), m: Number(hit[2]) } : null;
}

function shifted({ y, m }: { y: number; m: number }, by: number): { y: number; m: number } {
  const index = y * 12 + (m - 1) + by;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

const label = ({ y, m }: { y: number; m: number }) => `${MONTHS[m - 1]} de ${y}`;
const range = ({ y, m }: { y: number; m: number }) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return `${y}-${mm}-01..${y}-${mm}-${String(last).padStart(2, "0")}`;
};

/**
 * Dica para o interpretador: o período do turno anterior, o mês resultante do deslocamento e a janela exata.
 * Devolve null quando a frase não desloca período ou não há período confiável na memória.
 */
export function periodShiftHint(
  text: string,
  previous: { from?: string | null; to?: string | null } | null | undefined,
): { previous_period: string; direction: "next_month" | "previous_month"; target_month: string; target_window: string; instruction: string } | null {
  const direction = periodShiftDirection(text);
  if (!direction || !previous?.from) return null;
  const base = monthOf(previous.from);
  if (!base) return null;
  const target = shifted(base, direction);
  return {
    previous_period: `${label(base)} (${previous.from}..${previous.to ?? previous.from})`,
    direction: direction === 1 ? "next_month" : "previous_month",
    target_month: label(target),
    target_window: range(target),
    instruction: `A frase desloca o período do turno anterior. Use EXATAMENTE "${label(target)}" como período; NÃO use o mês atual nem repita ${label(base)}.`,
  };
}
