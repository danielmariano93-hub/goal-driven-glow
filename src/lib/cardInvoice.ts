const PURCHASE_KINDS = ["purchase", "installment"];
const CREDIT_KINDS = ["payment", "refund"];
const SERVICE_KINDS = ["interest", "fee"];

/** Resumo no formato do app do banco. A soma das linhas é o total da fatura. */
export function summarizeInvoiceItems(items: Array<{ item_kind: string; amount: number | string }>) {
  let credits = 0;
  let purchases = 0;
  let services = 0;
  let adjustments = 0;
  for (const it of items) {
    const amount = Number(it.amount || 0);
    if (CREDIT_KINDS.includes(it.item_kind)) credits += amount;
    else if (PURCHASE_KINDS.includes(it.item_kind)) purchases += amount;
    else if (SERVICE_KINDS.includes(it.item_kind)) services += amount;
    else adjustments += amount;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    credits: r(credits), purchases: r(purchases), services: r(services), adjustments: r(adjustments),
    total: r(credits + purchases + services + adjustments),
  };
}

/** Data de fechamento da fatura que vence em `dueDate` (ex.: vence 01/12, fecha dia 24 → 24/11). */
export function closingDateOf(dueDate: string, closingDay: number, dueDay: number): string {
  const [y, m] = dueDate.split("-").map(Number);
  const back = dueDay <= closingDay ? 1 : 0;
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(closingDay, last);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface InvoicePoint { x: number; y: number }

/** Pontos do gráfico: x no centro de cada coluna; y proporcional ao valor dentro da faixa [top, bottom]. */
export function invoicePoints(values: number[], opts: { tileW: number; gap: number; top: number; bottom: number }): InvoicePoint[] {
  const max = Math.max(1, ...values.map((v) => Math.max(0, v)));
  return values.map((v, i) => ({
    x: i * (opts.tileW + opts.gap) + opts.tileW / 2,
    y: opts.bottom - (Math.max(0, v) / max) * (opts.bottom - opts.top),
  }));
}

/** Curva suave (Bézier com tangentes horizontais) por todos os pontos. */
export function smoothPath(points: InvoicePoint[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}
