// deno-lint-ignore-file no-explicit-any
// "Quanto vem na fatura de novembro?" — fatura de UMA competência, pelo motor canônico dos cartões
// (o mesmo da página Cartões e da Home): oficial quando há fatura importada, senão reconstruída
// (compras da competência + parcelas contratadas), nunca "gasto total do mês".
import { computeCardExposure, type CardInstallmentRow, type CardStatementRow, type CardTxRow } from "../finance-core/cardExposure.ts";
import { today as localToday } from "../finance-core/ninoClock.ts";
import { loadTransactionsForCompetenceWindow } from "./core/handlers/TransactionWindowLoader.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function get_card_invoice(ctx: ToolContext, args?: { month?: string; card?: string }): Promise<ToolResult> {
  const today = localToday();
  const ym = /^\d{4}-\d{2}$/.test(String(args?.month ?? "")) ? String(args!.month) : today.slice(0, 7);

  const [cardsRes, stRes, instRes] = await Promise.all([
    ctx.sb.from("credit_cards").select("id,name,closing_day,due_day").eq("user_id", ctx.user_id).eq("active", true),
    ctx.sb.from("credit_card_statements")
      .select("id,credit_card_id,competence_month,due_date,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status")
      .eq("user_id", ctx.user_id),
    ctx.sb.from("credit_card_installments")
      .select("id,credit_card_id,competence_month,amount,status,absorbed_by_statement_id,legacy_transaction_id")
      .eq("user_id", ctx.user_id),
  ]);
  if (cardsRes.error) return { ok: false, error: `cards_query_failed:${cardsRes.error.message}` };
  if (stRes.error) return { ok: false, error: `statements_query_failed:${stRes.error.message}` };
  if (instRes.error) return { ok: false, error: `installments_query_failed:${instRes.error.message}` };

  let cards = (cardsRes.data ?? []) as any[];
  if (!cards.length) return { ok: true, result: { engine: "get_card_invoice", month: ym, has_cards: false, answer_format: { headline: "Você ainda não tem cartão de crédito cadastrado." } } };
  const wanted = norm(args?.card);
  const requested = wanted ? cards.filter((c) => norm(c.name).includes(wanted) || wanted.includes(norm(c.name))) : [];
  if (wanted && !requested.length) {
    return { ok: true, result: { engine: "get_card_invoice", month: ym, has_cards: true, card_filter: { requested: String(args?.card), applied: false }, cards: [], total: null } };
  }
  if (wanted) cards = requested;

  // Compras no cartão da competência (para a fatura reconstruída): janela de 1 mês de folga.
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  // Leitura paginada (a Data API corta em 1.000 linhas): compras no cartão da janela, só as do cartão.
  const cardTxs = (await loadTransactionsForCompetenceWindow(
    ctx.sb, ctx.user_id, from, to,
    "id,credit_card_id,competence_date,occurred_at,amount,type,status,settles_card_id,movement_kind,payment_method",
  )).filter((t: any) => t.payment_method === "credit_card");

  const statements = (stRes.data ?? []) as CardStatementRow[];
  const exposures = computeCardExposure({
    cardIds: cards.map((c) => String(c.id)),
    statements,
    installments: ((instRes.data ?? []) as any[]).map((i) => ({ ...i, amount: Number(i.amount) })) as CardInstallmentRow[],
    txs: cardTxs.map((t: any) => ({ ...t, amount: Number(t.amount) })) as CardTxRow[],
    currentYM: ym,
    cards: cards.map((c) => ({ id: c.id, name: c.name, closing_day: c.closing_day, due_day: c.due_day })),
    todayISO: today,
  });

  // Fatura importada PARCIAL (em revisão): o documento lido não cobre tudo. A estimativa por compras da
  // competência + parcelas contratadas mostra o que o valor importado ainda não inclui.
  const partialCardIds = new Set(cards.filter((c) => exposures[String(c.id)]?.currentStatement?.source === "partial").map((c) => String(c.id)));
  const reconstructed = partialCardIds.size
    ? computeCardExposure({
      cardIds: cards.map((c) => String(c.id)),
      statements: statements.filter((s) => !(partialCardIds.has(s.credit_card_id) && String(s.competence_month).slice(0, 7) === ym)),
      installments: ((instRes.data ?? []) as any[]).map((i) => ({ ...i, amount: Number(i.amount) })) as CardInstallmentRow[],
      txs: cardTxs.map((t: any) => ({ ...t, amount: Number(t.amount) })) as CardTxRow[],
      currentYM: ym,
      cards: cards.map((c) => ({ id: c.id, name: c.name, closing_day: c.closing_day, due_day: c.due_day })),
      todayISO: today,
    })
    : null;

  const rows = cards.map((c) => {
    const fig = exposures[String(c.id)]?.currentStatement;
    const statement = statements.find((s) => s.credit_card_id === c.id && String(s.competence_month).slice(0, 7) === ym);
    const imported = round2(Number(fig?.amount ?? 0));
    const estimate = reconstructed ? round2(Number(reconstructed[String(c.id)]?.currentStatement?.amount ?? 0)) : null;
    const partial = fig?.source === "partial";
    return {
      card: String(c.name),
      // Parcial: o valor importado sozinho subestima; mostramos o maior entre ele e a reconstrução.
      amount: partial && estimate !== null ? Math.max(imported, estimate) : imported,
      imported_amount: partial ? imported : null,
      estimate_from_entries: partial ? estimate : null,
      needs_review: partial,
      source: fig?.source ?? "unavailable",
      status: fig?.status ?? null,
      due_date: statement?.due_date ? String(statement.due_date).slice(0, 10) : null,
      paid_amount: round2(Number(fig?.paidAmount ?? 0)),
      purchases: fig?.purchasesAmount ?? null,
      installments: fig?.installmentsAmount ?? null,
    };
  });
  const known = rows.filter((r) => r.source !== "unavailable" && r.source !== "none");
  return {
    ok: true,
    result: {
      engine: "get_card_invoice",
      month: ym,
      has_cards: true,
      card_filter: wanted ? { requested: String(args?.card), applied: true } : null,
      cards: rows,
      total: known.length ? round2(known.reduce((s, r) => s + r.amount, 0)) : null,
      note: "Fatura por competência (mês em que a compra/parcela entra na fatura), não pela data da compra.",
    },
  };
}
