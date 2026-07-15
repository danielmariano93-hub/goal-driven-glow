/** Parser CSV BR simples (sem dependência externa). Suporta ; ou , como separador. */

export interface CsvRow {
  raw: Record<string, string>;
  occurred_at: string | null;
  amount: number | null;
  description: string;
  external_id: string;
  errors: string[];
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
  separator: string;
}

function detectSeparator(firstLine: string): string {
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  return semi >= comma ? ";" : ",";
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseBrNumber(v: string): number | null {
  if (!v) return null;
  const cleaned = v.replace(/\s/g, "").replace(/R\$/gi, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseBrDate(v: string): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

export interface ColumnMap {
  date: string;
  amount: string;
  description: string;
}

export function parseCsv(text: string, columnMap: ColumnMap): CsvParseResult {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], separator: "," };
  const sep = detectSeparator(lines[0]);
  const headers = splitCsvLine(lines[0], sep);
  const rows: CsvRow[] = lines.slice(1).map((line, idx) => {
    const cells = splitCsvLine(line, sep);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { raw[h] = cells[i] ?? ""; });
    const errors: string[] = [];
    const amount = parseBrNumber(raw[columnMap.amount] ?? "");
    const occurred_at = parseBrDate(raw[columnMap.date] ?? "");
    if (amount == null) errors.push("valor_invalido");
    if (!occurred_at) errors.push("data_invalida");
    const description = (raw[columnMap.description] ?? "").slice(0, 240);
    const external_id = `csv:${idx}:${occurred_at ?? ""}:${amount ?? ""}:${description.slice(0, 40)}`;
    return { raw, occurred_at, amount, description, external_id, errors };
  });
  return { headers, rows, separator: sep };
}
