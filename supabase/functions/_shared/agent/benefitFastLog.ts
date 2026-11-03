// deno-lint-ignore-file no-explicit-any
// Ticket Alimentação pelo `!ja` (automação do celular): o gasto vai SÓ para a carteira do Ticket
// (contexto separado do livro-razão): não cria lançamento, não mexe em conta nem em caixa livre.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeBenefitState, type BenefitEntry, type BenefitKind } from "../finance-core/benefitWallet.ts";
import { extractSpans } from "./extract.ts";
import { todaySaoPaulo } from "./parser.ts";

// "Ticket", "Vale Refeição/Alimentação", "VR", "VA" como MEIO DE PAGAMENTO.
const BENEFIT_WORD = String.raw`(?:ticket(?:\s+(?:alimenta[cç][aã]o|restaurante|refei[cç][aã]o))?|vale[\s-]*(?:refei[cç][aã]o|alimenta[cç][aã]o)|v[ra])`;
// Linha isolada com o meio de pagamento (como a notificação do banco: "Conta Corrente Itaú" → "Ticket").
const PAYMENT_LINE_RX = new RegExp(String.raw`^\s*(?:(?:conta|cart[aã]o|pagamento|forma\s+de\s+pagamento|origem)\s*:?\s*)?${BENEFIT_WORD}\s*$`, "i");
// Frase livre: "no ticket", "com o ticket", "pelo vale refeição".
const PAYMENT_PHRASE_RX = new RegExp(String.raw`\b(?:no|com|pelo|pela|do|usando)\s+(?:o\s+|meu\s+)?${BENEFIT_WORD}(?=\s*$|\s*[.,;!?]|\s+(?:hoje|ontem|agora|ao|[àa]s?|de|em|para|pra|e)\b)`, "i");
// Linhas rotuladas de dado (estabelecimento, descrição…) nunca decidem o meio de pagamento.
const DATA_LABEL_RX = /^\s*(?:estabelecimento|descri[cç][aã]o|descricao|local|finalidade|data|valor)\b/i;

/** O texto diz que o pagamento foi no Ticket? Só olha o meio de pagamento, nunca o nome do estabelecimento. */
export function detectBenefitPayment(text: string): boolean {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() && !DATA_LABEL_RX.test(l));
  if (lines.some((l) => PAYMENT_LINE_RX.test(l))) return true;
  // Frase livre só em mensagem de uma linha (a notificação estruturada usa a linha do meio de pagamento).
  const single = String(text ?? "").trim();
  return !single.includes("\n") && PAYMENT_PHRASE_RX.test(single);
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function merchantOf(text: string): string | null {
  const m = /(?:^|\n)\s*(?:estabelecimento|local)\s*:?\s*([^\n]{2,80})/i.exec(text);
  const raw = m ? m[1] : extractSpans(text).description;
  const cleaned = String(raw ?? "").replace(/\s+/g, " ").replace(PAYMENT_PHRASE_RX, "").trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

export type BenefitFastLogResult = { reply: string; reply_kind: "receipt" | "question" | "info"; recorded: boolean };

export async function recordBenefitFastLog(sb: SupabaseClient, input: { user_id: string; cleanText: string }): Promise<BenefitFastLogResult> {
  const info = (reply: string): BenefitFastLogResult => ({ reply, reply_kind: "info", recorded: false });
  const spans = extractSpans(input.cleanText);
  const amount = spans.amount;
  if (!amount || amount <= 0) return { reply: "Não consegui identificar o valor do gasto no Ticket. Ex.: “!ja gastei 42,90 no almoço no ticket”.", reply_kind: "question", recorded: false };

  const access = await sb.from("benefit_wallet_access").select("user_id").eq("user_id", input.user_id).maybeSingle();
  if (access.error || !access.data) return info("O Ticket Alimentação ainda não está liberado para a sua conta, então não registrei esse gasto.");
  const wallet = await sb.from("benefit_wallets")
    .select("id,monthly_credit,credit_day,carries_over").eq("user_id", input.user_id).eq("active", true).maybeSingle();
  if (wallet.error) return info("Não consegui acessar o seu Ticket agora. Tente de novo em instantes.");
  const w = wallet.data as any;
  if (!w) return info("Você ainda não cadastrou o Ticket Alimentação. Abra Mais → Ticket Alimentação, cadastre e eu registro esse gasto depois.");

  const today = todaySaoPaulo();
  const day = spans.occurred_at ?? today;
  const hour = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(input.cleanText);
  const note = hour ? `${hour[1].padStart(2, "0")}:${hour[2]}` : null;
  const merchant = merchantOf(input.cleanText);

  // Mesma mensagem duas vezes (mesmo valor, dia, estabelecimento e horário) não conta duas vezes.
  let dup = sb.from("benefit_entries").select("id").eq("wallet_id", w.id).eq("kind", "spend")
    .eq("amount", amount).eq("occurred_on", day);
  dup = merchant ? dup.eq("merchant", merchant) : dup.is("merchant", null);
  dup = note ? dup.eq("note", note) : dup.is("note", null);
  const dupRes = await dup.limit(1);
  const duplicated = !dupRes.error && (dupRes.data ?? []).length > 0;
  if (!duplicated) {
    const ins = await sb.from("benefit_entries").insert({
      wallet_id: w.id, user_id: input.user_id, kind: "spend", amount, occurred_on: day, merchant, note, source: "whatsapp",
    });
    if (ins.error) return info("Não consegui registrar o gasto no Ticket agora. Tente de novo em instantes.");
  }

  const rows = await sb.from("benefit_entries").select("id,kind,amount,occurred_on,merchant").eq("wallet_id", w.id)
    .order("occurred_on", { ascending: true }).limit(5000);
  const entries: BenefitEntry[] = ((rows.data ?? []) as any[]).map((r) => ({
    id: String(r.id), kind: r.kind as BenefitKind, amount: Number(r.amount),
    occurred_on: String(r.occurred_on).slice(0, 10), merchant: r.merchant ?? null,
  }));
  const state = computeBenefitState({ monthly_credit: Number(w.monthly_credit), credit_day: Number(w.credit_day), carries_over: w.carries_over === true }, entries, today);

  const head = duplicated ? "Esse gasto no Ticket já estava registrado:" : "Registrei no seu Ticket:";
  const lines = [`${head} *${brl(amount)}*${merchant ? ` em ${merchant}` : ""} (${dm(day)}).`];
  if (state.balance !== null) {
    lines.push(`Saldo do Ticket: *${brl(state.balance)}*${state.estimated ? " (estimado)" : ""}.`);
    const p = state.projection;
    if (p && p.status !== "unknown") {
      lines.push(p.depletion_date
        ? `No seu ritmo, ele acaba em *${dm(p.depletion_date)}*, antes do próximo crédito.`
        : "No seu ritmo, ele cobre até o próximo crédito.");
    }
  }
  return { reply: lines.join("\n"), reply_kind: "receipt", recorded: !duplicated };
}
