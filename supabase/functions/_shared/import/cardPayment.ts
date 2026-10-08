// Qual cartão um pagamento de fatura (saída da conta) quita?
// Regra segura: com um único cartão, é ele; com vários, só se UM nome aparecer na descrição.
// Na dúvida devolve null e a pessoa escolhe na revisão (nunca chuta entre cartões).
const fold = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const GENERIC = new Set(["cartao", "card", "credito", "fatura", "pagamento", "paga", "banco", "conta", "visa", "master", "mastercard", "black", "gold"]);

export function detectCardForPayment(
  description: string | null | undefined,
  cards: Array<{ id: string; name: string }>,
): string | null {
  if (cards.length === 0) return null;
  if (cards.length === 1) return cards[0].id;
  const text = fold(String(description ?? ""));
  const hits = cards.filter((card) => {
    const tokens = fold(card.name).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !GENERIC.has(t));
    return tokens.length > 0 && tokens.some((t) => text.includes(t));
  });
  return hits.length === 1 ? hits[0].id : null;
}
