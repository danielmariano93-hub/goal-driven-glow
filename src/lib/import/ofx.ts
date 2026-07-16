/** Parser OFX minimalista via regex. Extrai STMTTRN. */

export interface OfxTransaction {
  fitid: string;
  occurred_at: string | null;
  amount: number | null;
  description: string;
  external_id: string;
  errors: string[];
}

function parseOfxDate(v: string): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseOfx(text: string): OfxTransaction[] {
  const out: OfxTransaction[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;
  while ((match = trnRegex.exec(text)) !== null) {
    const body = match[1];
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(body);
      return m ? m[1].trim() : "";
    };
    const fitid = get("FITID");
    const amount = Number(get("TRNAMT").replace(",", "."));
    const occurred_at = parseOfxDate(get("DTPOSTED"));
    const description = (get("MEMO") || get("NAME") || "").slice(0, 240);
    const errors: string[] = [];
    if (!fitid) errors.push("fitid_ausente");
    if (!Number.isFinite(amount)) errors.push("valor_invalido");
    if (!occurred_at) errors.push("data_invalida");
    out.push({
      fitid,
      occurred_at,
      amount: Number.isFinite(amount) ? amount : null,
      description,
      external_id: `ofx:${fitid}`,
      errors,
    });
  }
  return out;
}
