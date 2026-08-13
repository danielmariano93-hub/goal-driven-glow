// ReplyHumanizer — última camada antes de qualquer resposta chegar ao usuário.
// Duas responsabilidades:
//  1. Nunca vazar nomes internos (motores, contratos, tools, versões, modelos).
//  2. Deixar o texto leve: sem parágrafos densos, sem rótulos técnicos.
// É puramente textual: não recalcula nem remove números.

const INTERNAL_TOKENS: RegExp[] = [
  // financial_snapshot_contract.v8, nino_engines.v1, forecast.seasonal.v1 ...
  /\b[a-z][a-z0-9_.]*(?:contract|engine|engines|core|truth|pipeline|snapshot|seasonal|baseline)[a-z0-9_.]*\s*\.?\s*v\d+(?:\.\d+)*\b/gi,
  /\bv\d+(?:\.\d+)*\+[a-z0-9_.+-]+/gi,
  // nomes de modelos de IA
  /\b(?:google|openai|anthropic|gemini|gpt|claude)[a-z0-9./-]*\b/gi,
  // nomes de tools internas
  /\b(?:get|list|analyze|detect|discover|forecast|simulate|project|explain|run|create|search|generate|pay)_[a-z0-9_]{3,}\b/g,
];

function stripInternalNames(text: string): string {
  let out = text;
  for (const rx of INTERNAL_TOKENS) out = out.replace(rx, "");
  return out
    // "motor X;" / "motor X," / "(motor X)" viram nada
    .replace(/\(?\s*,?\s*motor(?:es)?\s*[:=]?\s*([;,.)]|$)/gim, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/([;,])\s*([;,.])/g, "$2")
    .replace(/,\s*\./g, ".")
    .replace(/;\s*\./g, ".");
}

/** Normaliza markdown para o WhatsApp: `**x**` → `*x*`, `* item` / `- item`
 *  viram bullets `•`, e o feio `* *item*:` deixa de existir. */
function normalizeMarkdown(line: string): string {
  let out = line.replace(/\*\*(.+?)\*\*/g, "*$1*");
  out = out.replace(/^\s*[*-]\s+/, "• ");
  // "• *uber*:" → "• *uber*:" ok; "• * *uber*" → "• *uber*"
  out = out.replace(/^•\s*\*\s+\*/, "• *");
  out = out.replace(/^#{1,6}\s*/, "");
  return out;
}

/** Espaçamento leve: linhas curtas, bullets limpos, uma linha em branco antes
 *  do primeiro item de uma lista. */
function lightenLayout(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => normalizeMarkdown(line).replace(/[ \t]+$/g, ""))
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""));
  const out: string[] = [];
  for (const line of lines) {
    const isBullet = line.startsWith("• ");
    const prev = out[out.length - 1] ?? "";
    if (isBullet && prev && !prev.startsWith("• ")) out.push("");
    out.push(line);
  }
  return out.join("\n").trim();
}

export function humanizeReply(raw: string | null | undefined): string {
  const text = String(raw ?? "");
  if (!text.trim()) return text;
  return lightenLayout(stripInternalNames(text));
}
