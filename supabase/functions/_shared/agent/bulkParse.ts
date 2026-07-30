// Parser puro (sem dependências) para registro em lote.
// Usado pelo AgentCore (Deno) e pelos testes (vitest).

export type BulkItem = { description: string; amount: number };
export type BulkParseResult = {
  items: BulkItem[];
  skipped: number;
  source: "json" | "lines" | "none";
};

const MONEY_RX = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+\.\d{1,2}|\d+)\s*$/i;

export function parseBrAmountLoose(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  let s = String(raw ?? "").trim().replace(/^r\$\s*/i, "").replace(/\s/g, "");
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanDesc(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[•\-–—*·]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}

function fromJson(text: string): BulkItem[] | null {
  const start = text.indexOf("{");
  const startArr = text.indexOf("[");
  const first = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (first === -1) return null;
  const last = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (last <= first) return null;
  let parsed: any;
  try { parsed = JSON.parse(text.slice(first, last + 1)); } catch { return null; }
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed?.lancamentos ?? parsed?.lançamentos ?? parsed?.itens ?? parsed?.items ?? parsed?.transacoes ?? parsed?.transactions ?? parsed?.i ?? parsed?.gastos ?? parsed?.despesas;
  if (!Array.isArray(arr)) return null;
  const items: BulkItem[] = [];
  for (const row of arr) {
    // Linhas compactas [tipo,data,valor,descrição,...] (formato do extrator).
    if (Array.isArray(row)) {
      const description = cleanDesc(row[3]);
      const amount = parseBrAmountLoose(row[2]);
      if (description && amount !== null) items.push({ description, amount });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const description = cleanDesc(
      (row as any).descricao ?? (row as any).descrição ?? (row as any).description ?? (row as any).estabelecimento ?? (row as any).titulo ?? (row as any).title,
    );
    const amount = parseBrAmountLoose(
      (row as any).valor ?? (row as any).amount ?? (row as any).value ?? (row as any).total,
    );
    if (!description || amount === null) continue;
    items.push({ description, amount });
  }
  return items.length ? items : null;
}

function fromLines(text: string): BulkItem[] {
  const items: BulkItem[] = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length < 4) continue;
    const m = line.match(MONEY_RX);
    if (!m) continue;
    const amount = parseBrAmountLoose(m[1]);
    if (amount === null) continue;
    const description = cleanDesc(line.slice(0, line.length - m[0].length).replace(/[:;,|]+$/, ""));
    if (!description || /^total/i.test(description)) continue;
    items.push({ description, amount });
  }
  return items;
}

/** Detecta uma lista de lançamentos (JSON ou linhas "Descrição R$ 12,34"). */
export function parseBulkItems(text: string, minItems = 3): BulkParseResult {
  const raw = String(text ?? "");
  const json = fromJson(raw);
  if (json && json.length >= minItems) return { items: json, skipped: 0, source: "json" };
  const lines = fromLines(raw);
  if (lines.length >= minItems) {
    const totalLines = raw.split(/\r?\n/).filter(l => l.trim().length > 3).length;
    return { items: lines, skipped: Math.max(0, totalLines - lines.length), source: "lines" };
  }
  return { items: [], skipped: 0, source: "none" };
}

export function sumItems(items: BulkItem[]): number {
  return items.reduce((acc, i) => acc + i.amount, 0);
}
