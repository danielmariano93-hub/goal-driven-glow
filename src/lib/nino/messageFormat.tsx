import type { ReactNode } from "react";

/**
 * O Nino escreve no mesmo formato do WhatsApp (`*negrito*`, listas com "•",
 * blocos separados por linha em branco). No app, o negrito vira <strong> em
 * vez de aparecer com asteriscos; quebras de linha ficam por conta do
 * `whitespace-pre-line` do balão.
 */
const BOLD_RE = /\*([^*\n]+?)\*/g;

export function renderNinoInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(BOLD_RE)) {
    const start = match.index ?? 0;
    const before = text[start - 1];
    const after = text[start + match[0].length];
    // "2 * 3 * 4" não é negrito: o asterisco precisa colar na palavra.
    const opensWord = !before || /[\s(•:—-]/.test(before);
    const closesWord = !after || /[\s).,;:!?]/.test(after);
    if (!opensWord || !closesWord || /^\s|\s$/.test(match[1])) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(<strong key={`b${key++}`} className="font-semibold">{match[1]}</strong>);
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
