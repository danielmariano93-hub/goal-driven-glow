// Formatação executiva pt-BR (`nino_executive_insights.v1`).
// Número sempre em reais brasileiros; valores grandes em forma compacta no
// título ("R$ 16,5 mil") e exatos na evidência ("R$ 16.482,31").

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function brl(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).replace(/ /g, " ");
}

/** "R$ 697", "R$ 1,6 mil", "R$ 16,5 mil", "R$ 1,2 mi". */
export function compact(value: number): string {
  const abs = Math.abs(Number(value || 0));
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${sign}R$ ${Math.round(abs).toLocaleString("pt-BR")}`;
}

export function signedCompact(value: number): string {
  return value > 0 ? `+${compact(value)}` : compact(value);
}

export function pct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}

export function monthName(ym: string): string {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
}

export function monthNameCap(ym: string): string {
  const name = monthName(ym);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function monthShort(ym: string): string {
  return MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] ?? ym;
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}

/** "Moradia, Transporte e Assinaturas". */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
