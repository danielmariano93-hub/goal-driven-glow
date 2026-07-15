// Client-side normalization mirroring the Deno helper.
// E.164 for Brazilian numbers (+55DDDNNNNNNNNN). Returns null on invalid input.
export function normalizeBrPhone(raw: string): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  let d = digits;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length < 10 || d.length > 11) return null;
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return "+55" + d;
}

export function maskBrPhone(e164: string): string {
  if (!e164) return "";
  return `+55 (**) *****-${e164.slice(-4)}`;
}
