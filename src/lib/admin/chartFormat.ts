// Eixo de tempo dos gráficos do admin: uma só regra, para a data nunca aparecer como "2026-10-24" nem sumir.
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

/** "2026-10-24" → "24/10"; "2026-10" → "out/26"; qualquer outro texto fica como veio. */
export function dayTick(value: unknown): string {
  const s = String(value ?? "");
  const d = ISO_DAY.exec(s);
  if (d) return `${d[3]}/${d[2]}`;
  const m = ISO_MONTH.exec(s);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]}/${m[1].slice(2)}`;
  return s;
}

/** Rótulo completo para a dica do gráfico: "qui, 24/10/2026". */
export function dayFull(value: unknown): string {
  const s = String(value ?? "");
  const d = ISO_DAY.exec(s);
  if (d) {
    const weekday = WEEKDAYS[new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))).getUTCDay()];
    return `${weekday}, ${d[3]}/${d[2]}/${d[1]}`;
  }
  const m = ISO_MONTH.exec(s);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
  return s;
}

/** Quantos rótulos cabem: poucos pontos mostram todos; muitos mostram os extremos e alguns do meio, sem sobrepor. */
export function xAxisProps(points: number) {
  return {
    tickLine: false,
    axisLine: false,
    tickMargin: 8,
    height: 30,
    interval: (points <= 8 ? 0 : "preserveStartEnd") as number | "preserveStartEnd",
    minTickGap: 14,
  };
}
