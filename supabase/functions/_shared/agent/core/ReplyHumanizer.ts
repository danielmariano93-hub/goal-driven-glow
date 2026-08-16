// ReplyHumanizer — última camada antes de qualquer resposta chegar ao usuário.
// Três responsabilidades:
//  1. Nunca vazar nomes internos (motores, contratos, tools, versões, modelos).
//  2. Nunca entregar frase quebrada por causa dessa remoção ("criado pelo para").
//  3. Deixar o texto leve: sem parágrafos densos, sem rótulos técnicos.
// É puramente textual: não recalcula nem remove números.

const INTERNAL_TOKENS: RegExp[] = [
  // financial_snapshot_contract.v8, nino_engines.v1, forecast.seasonal.v1 ...
  /\b[a-z][a-z0-9_.]*(?:contract|engine|engines|core|truth|pipeline|snapshot|seasonal|baseline)[a-z0-9_.]*\s*\.?\s*v\d+(?:\.\d+)*\b/gi,
  /\bv\d+(?:\.\d+)*\+[a-z0-9_.+-]+/gi,
  // nomes de tools internas
  /\b(?:get|list|analyze|detect|discover|forecast|simulate|project|explain|run|create|search|generate|pay)_[a-z0-9_]{3,}\b/g,
];

/**
 * Fornecedores/modelos de IA. Remover só a palavra deixava frases mutiladas
 * ("Fui criado pelo Google" → "Fui criado pelo"), então apagamos o TRECHO
 * coerente: a oração que atribui autoria ao fornecedor.
 */
const VENDOR_WORD = String.raw`(?:google|openai|open\s?ai|anthropic|gemini|gpt(?:-[0-9a-z.]+)?|chatgpt|claude|llama|mistral|deepseek)`;

const VENDOR_CLAUSES: RegExp[] = [
  // "criado/desenvolvido/treinado/feito pelo Google", "baseado no GPT-4"
  new RegExp(
    String.raw`[,;]?\s*(?:fui\s+|sou\s+)?(?:criad[oa]|desenvolvid[oa]|treinad[oa]|feit[oa]|constru[íi]d[oa]|basead[oa]|alimentad[oa]|powered)\s+(?:pel[oa]s?|por|no|na|em|com|pela\s+)?\s*(?:empresa\s+|modelo\s+|tecnologia\s+)?${VENDOR_WORD}(?:[ -]?[0-9][0-9a-z.]*)?`,
    "gi",
  ),
  // "um modelo de linguagem do Google", "a IA da OpenAI"
  new RegExp(String.raw`[,;]?\s*(?:um\s+|uma\s+|o\s+|a\s+)?(?:modelo|ia|intelig[êe]ncia artificial|assistente)\s+(?:de linguagem\s+)?(?:d[oa]|de|da|do)\s+${VENDOR_WORD}\b`, "gi"),
  // menção solta restante
  new RegExp(String.raw`\b${VENDOR_WORD}\b[a-z0-9./-]*`, "gi"),
];

/** Repara resíduos gramaticais deixados por qualquer remoção. */
function repairGrammar(text: string): string {
  return text
    // "criado pelo para te ajudar" / "criado por . " → tira a preposição órfã
    .replace(/\b(criad[oa]|desenvolvid[oa]|treinad[oa]|feit[oa]|basead[oa])\s+(?:pel[oa]s?|por|d[oa]|em|com|no|na)\s+(?=(?:para|pra|por|e|que|com|a fim)\b|[.,;!?]|$)/gi, "$1 ")
    // preposição/artigo órfão antes de pontuação
    .replace(/\b(?:pel[oa]s?|por|d[oa]s?|de|em|com|no|na|um|uma|o|a)\s+(?=[.,;!?])/gi, "")
    // "Fui  para te ajudar" → "Estou aqui para te ajudar"
    .replace(/\bfui\s+(?=para|pra)\b/gi, "estou aqui ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([;,.!?])/g, "$1")
    .replace(/([;,])\s*([;,.])/g, "$2")
    .replace(/,\s*\./g, ".")
    .replace(/;\s*\./g, ".")
    .replace(/\.{2,}(?!\.)/g, ".")
    .replace(/\(\s*\)/g, "");
}

function stripInternalNames(text: string): string {
  let out = text;
  for (const rx of INTERNAL_TOKENS) out = out.replace(rx, "");
  for (const rx of VENDOR_CLAUSES) out = out.replace(rx, "");
  out = out
    // "motor X;" / "motor X," / "(motor X)" viram nada
    .replace(/\(?\s*,?\s*motor(?:es)?\s*[:=]?\s*([;,.)]|$)/gim, "$1");
  return repairGrammar(out);
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

/** Bullet colado no meio do parágrafo ("Eu faço: • Registrar…") quebra em
 *  linhas próprias antes de qualquer outra normalização. */
function splitInlineBullets(text: string): string {
  return text
    // "texto: • item" ou "texto • item" → bullet em nova linha
    .replace(/([^\n])[ \t]+(?=•[ \t]*\S)/g, (_m, before: string) => `${before}\n`)
    // "• item • item" na mesma linha → um por linha
    .replace(/(\S)[ \t]+•[ \t]+/g, "$1\n• ");
}

/** Espaçamento leve: linhas curtas, bullets limpos, uma linha em branco antes
 *  do primeiro item de uma lista. */
function lightenLayout(text: string): string {
  const lines = splitInlineBullets(text)
    .split("\n")
    .map((line) => normalizeMarkdown(line).replace(/[ \t]+$/g, ""))
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    // bullet vazio deixado por remoção não vai para o usuário
    .filter((line) => line.trim() !== "•" && line.trim() !== "• ");
  const out: string[] = [];
  for (const line of lines) {
    const isBullet = line.startsWith("• ");
    const prev = out[out.length - 1] ?? "";
    if (isBullet && prev && !prev.startsWith("• ")) out.push("");
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Sinais de frase quebrada que NUNCA devem sair — usado em testes e métricas. */
export function findBrokenPhrases(text: string): string[] {
  const issues: string[] = [];
  const t = String(text ?? "");
  if (/\b(?:pel[oa]s?|por|d[oa]s?|em|com|no|na)\s+(?:para|pra|que|e)\b/i.test(t)) issues.push("orphan_preposition");
  if (/\b(?:pel[oa]s?|por|de|em|com)\s*[.,;!?]/i.test(t)) issues.push("preposition_before_punctuation");
  if (/^\s*•\s*$/m.test(t)) issues.push("empty_bullet");
  if (/\s{3,}/.test(t)) issues.push("collapsed_gap");
  if (/\S[ \t]+•[ \t]+\S/.test(t)) issues.push("inline_bullet");
  return issues;
}

export function humanizeReply(raw: string | null | undefined): string {
  const text = String(raw ?? "");
  if (!text.trim()) return text;
  let out = lightenLayout(stripInternalNames(text));
  // Guarda final: se a remoção ainda deixou frase quebrada, repara de novo.
  if (findBrokenPhrases(out).length) out = lightenLayout(repairGrammar(out));
  return out;
}
