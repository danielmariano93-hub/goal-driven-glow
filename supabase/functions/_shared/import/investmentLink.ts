// Qual investimento um resgate/aplicação importado mexe? Mesma resolução determinística do gatilho
// `tf_transactions_investment_link` no banco: apelido aprendido primeiro, nome único depois.
// Nunca escolhe entre dois ativos parecidos: na dúvida devolve null e a pessoa escolhe na revisão.
const WORDS = /\b(resgate|resgates|aplicacao|aplicacoes|aplic|invest|investimento|investimentos|itau|bradesco|santander|banco|nubank|inter|xp|btg|caixa|bb|c6|de|do|da)\b/g;

/** Espelho de `public.normalize_investment_name` (SQL). */
export function normalizeInvestmentName(name: string | null | undefined): string | null {
  const folded = String(name ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const out = folded.replace(WORDS, " ").replace(/\s+/g, " ").trim();
  return out || null;
}

export type InvestmentRef = { id: string; name: string };
export type InvestmentAliasRef = { investment_id: string; normalized_alias: string };

export function suggestInvestment(
  description: string | null | undefined,
  investments: InvestmentRef[],
  aliases: InvestmentAliasRef[],
): string | null {
  const key = normalizeInvestmentName(description);
  if (!key) return null;
  const alias = aliases.find((a) => a.normalized_alias === key);
  if (alias && investments.some((i) => i.id === alias.investment_id)) return alias.investment_id;
  const byName = investments.filter((i) => normalizeInvestmentName(i.name) === key);
  return byName.length === 1 ? byName[0].id : null;
}
