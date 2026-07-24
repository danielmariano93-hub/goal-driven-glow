export function rate(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator === null || numerator === undefined || !denominator || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

export function formatRate(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits).replace(/\.0$/, "")}%`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function sampleLabel(size: number | null | undefined) {
  if (!size || size < 10) return "Amostra insuficiente";
  if (size < 20) return "Sinal inicial";
  return null;
}
