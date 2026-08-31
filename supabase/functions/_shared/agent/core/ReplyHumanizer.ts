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

/** Repara resíduos gramaticais deixados por qualquer remoção.
 *  Atua SEMPRE linha por linha: colapsar espaços no texto inteiro destruía as
 *  quebras de linha das respostas determinísticas (listas grudavam na chamada). */
function repairGrammarLine(line: string): string {
  return line
    // "criado pelo para te ajudar" / "criado por . " → tira a preposição órfã
    .replace(/\b(criad[oa]|desenvolvid[oa]|treinad[oa]|feit[oa]|basead[oa])\s+(?:pel[oa]s?|por|d[oa]|em|com|no|na)\s+(?=(?:para|pra|por|e|que|com|a fim)\b|[.,;!?]|$)/gi, "$1 ")
    // preposição/artigo órfão antes de pontuação
    .replace(/\b(?:pel[oa]s?|por|d[oa]s?|de|em|com|no|na|um|uma|o|a)\s+(?=[.,;!?])/gi, "")
    // "Fui  para te ajudar" → "Estou aqui para te ajudar"
    .replace(/\bfui\s+(?=para|pra)\b/gi, "estou aqui ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([;,.!?])/g, "$1")
    .replace(/([;,])\s*([;,.])/g, "$2")
    .replace(/,\s*\./g, ".")
    .replace(/;\s*\./g, ".")
    .replace(/\.{2,}(?!\.)/g, ".")
    .replace(/\(\s*\)/g, "");
}

function repairGrammar(text: string): string {
  return String(text ?? "").split("\n").map(repairGrammarLine).join("\n");
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
 *  linhas próprias antes de qualquer outra normalização. Também trata o
 *  asterisco de lista colado na frase ("Rascunhei aqui: * Despesa: R$ 96,00"),
 *  que no WhatsApp saía como texto corrido feio. `*bold*` nunca tem espaço
 *  depois do asterisco, então a regra não desmonta negrito. */
function splitInlineBullets(text: string): string {
  return text
    // "texto: * item" → bullet em nova linha (hífen não conta: aparece em prosa)
    .replace(/(\S)[ \t]+\*[ \t]+(?=\S)/g, "$1\n• ")
    // "texto: • item" ou "texto • item" → bullet em nova linha
    .replace(/([^\n])[ \t]+(?=•[ \t]*\S)/g, (_m, before: string) => `${before}\n`)
    // "• item • item" na mesma linha → um por linha
    .replace(/(\S)[ \t]+•[ \t]+/g, "$1\n• ");
}

/** Pergunta de fechamento grudada no último dado ("Data: 15/08/2026 Posso
 *  registrar?") ganha parágrafo próprio. */
function detachClosingQuestion(text: string): string {
  return text.replace(
    /([^\n])[ \t]+((?:Posso registrar|Confirmo|Fecho assim|Pode salvar|Confirma|Tudo certo)\??)\s*$/i,
    (_m, before: string, question: string) => `${before}\n\n${question}`,
  );
}


/** Espaçamento leve: linhas curtas, bullets limpos, uma linha em branco antes
 *  do primeiro item de uma lista. */
function lightenLayout(text: string): string {
  const lines = detachClosingQuestion(splitInlineBullets(text))
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

/** Emoji por tema — determinístico, escolhido pelo conteúdo da resposta. */
const ACCENT_RULES: ReadonlyArray<{ re: RegExp; emoji: string }> = [
  { re: /\b(atras|venc|risco|cuidado|estourou|acima do teto|negativ)/i, emoji: "⚠️" },
  { re: /\b(meta|objetivo|guardar|reserva|aporte)/i, emoji: "🎯" },
  { re: /\b(fatura|cart[ãa]o|parcel)/i, emoji: "💳" },
  { re: /\b(gast|despesa|registrei|lan[çc]|comprei)/i, emoji: "💸" },
  { re: /\b(saldo|dispon[íi]vel|entrada|receb|sal[áa]rio|renda)/i, emoji: "💰" },
  { re: /\b(gr[áa]fico|relat[óo]rio|compara|m[ée]dia|proje[çc])/i, emoji: "📊" },
  { re: /\b(sentind|emo[çc]|humor|ansios|tranquil|cansad)/i, emoji: "💛" },
  { re: /\b(parab[ée]ns|boa|conseguiu|ótimo|otimo|melhor)/i, emoji: "✨" },
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

function countEmojis(text: string): number {
  return (text.match(new RegExp(EMOJI_RE, "gu")) ?? []).length;
}

/**
 * Dá um toque visual à resposta: garante 1 emoji quando não há nenhum e
 * remove excesso quando há mais de 2. Nunca insere emoji em texto vazio.
 */
export function addEmojiAccent(text: string): string {
  const raw = String(text ?? "");
  if (!raw.trim()) return raw;
  const total = countEmojis(raw);
  if (total > 2) {
    let kept = 0;
    return raw
      .replace(new RegExp(EMOJI_RE, "gu"), (m) => (++kept <= 2 ? m : ""))
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;!?])/g, "$1")
      .trim();
  }
  if (total > 0) return raw;
  const lines = raw.split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) return raw;
  // O emoji acompanha a CONCLUSÃO (primeira linha), não qualquer palavra do
  // corpo: abrir com alerta enquanto a conclusão é positiva confundia a leitura.
  const headline = lines[index];
  const emoji = ACCENT_RULES.find((rule) => rule.re.test(headline))?.emoji
    ?? ACCENT_RULES.find((rule) => rule.re.test(raw))?.emoji
    ?? "💛";
  lines[index] = `${emoji} ${lines[index].trimStart()}`;
  return lines.join("\n");

}

/** O Nino nunca chama o usuário de "Nino": vocativo inventado sai do texto. */
export function stripSelfVocative(text: string): string {
  return String(text ?? "")
    .replace(/(^|[\s.!?])(certo|sim|n[ãa]o|beleza|blz|ok|okay|t[áa]|claro|perfeito|combinado|entendi|opa|valeu|obrigad[oa]|ah|oi|ol[aá]|show|isso)[,!]+\s*nino\b/gi, "$1$2")
    .replace(/,\s*nino\s*(?=[.!?]|$)/gim, "")
    .replace(/^\s*nino[,!]\s+/gim, "");
}

export function humanizeReply(raw: string | null | undefined): string {
  const text = String(raw ?? "");
  if (!text.trim()) return text;
  let out = lightenLayout(stripSelfVocative(stripInternalNames(text)));
  // Guarda final: se a remoção ainda deixou frase quebrada, repara de novo.
  if (findBrokenPhrases(out).length) out = lightenLayout(repairGrammar(out));
  return addEmojiAccent(out);
}

