// InheritedScopeNote (`nino_scope_transparency.v1`)
// Quando a resposta foi calculada com um recorte (estabelecimento, categoria,
// cartão, conta) que NÃO está na frase atual da pessoa, esse recorte veio da
// conversa anterior. Herdar contexto é legítimo ("e por categoria?"), mas fazê-lo
// em silêncio é como uma pergunta nova vira resposta de outra pergunta. A regra é
// estrutural: compara o valor do filtro executado com o texto do turno. Não decide
// o que herdar; só garante que a pessoa SAIBA o que foi considerado e como sair.
export type ScopeFilter = { field: string; value: string };

const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

const FIELD_LABEL: Record<string, string> = {
  merchant: "estabelecimento", category: "categoria", card: "cartão", account: "conta",
};
const PAYMENT_WORDS = /\b(cartao|credito|debito|conta|pix|dinheiro)\b/;

/** O valor do filtro foi dito na frase atual? Leniente de propósito: na dúvida, não incomoda. */
export function filterStatedInText(filter: ScopeFilter, text: string): boolean {
  const t = norm(text);
  if (!t) return true;
  if (filter.field === "payment_method") return PAYMENT_WORDS.test(t);
  const v = norm(filter.value);
  if (!v) return true;
  if (t.includes(v)) return true;
  const tokens = v.split(" ").filter((w) => w.length >= 3);
  return tokens.some((w) => t.includes(w));
}

export function inheritedScopeFilters(text: string, filters: ScopeFilter[] | null | undefined): ScopeFilter[] {
  const seen = new Set<string>();
  const out: ScopeFilter[] = [];
  for (const f of filters ?? []) {
    if (!f?.field || !f?.value) continue;
    const key = `${f.field}:${norm(f.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!filterStatedInText(f, text)) out.push(f);
  }
  return out;
}

export function inheritedScopeNote(text: string, filters: ScopeFilter[] | null | undefined): string | null {
  const inherited = inheritedScopeFilters(text, filters);
  if (!inherited.length) return null;
  const parts = inherited.map((f) =>
    f.field === "payment_method" ? "a forma de pagamento" : `${FIELD_LABEL[f.field] ?? f.field} ${f.value}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
  return `📌 Considerei ${list}, como na conversa anterior. Se quiser ver sem esse recorte, é só me dizer.`;
}
