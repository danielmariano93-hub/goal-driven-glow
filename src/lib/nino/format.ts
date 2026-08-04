// Formatação canônica pt-BR para as superfícies do Nino.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valor em Reais no padrão brasileiro: R$ 1.170,54 */
export function brl(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return BRL.format(n);
}

/** Corrige textos gerados com separadores americanos (1,170.54 -> 1.170,54). */
export function fixMoneyLocale(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}(?!\d)/g, (match) => {
    if (/,\d{3}/.test(match)) {
      const [int, dec] = match.split(".");
      const intBr = int.replace(/,/g, ".");
      return dec ? `${intBr},${dec}` : intBr;
    }
    return match.replace(".", ",");
  });
}

/** Hora curta: 21:07 */
export function hourBR(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Data curta: 04/08 */
export function dayMonthBR(value: string | number | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** "Atualizado às 21:07 de 04/08" */
export function updatedAtLabel(value: string | number | Date | null | undefined): string {
  const h = hourBR(value);
  const d = dayMonthBR(value);
  if (!h) return "";
  return `Atualizado às ${h} de ${d}`;
}
