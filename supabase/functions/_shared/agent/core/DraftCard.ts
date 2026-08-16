// DraftCard (`nino_brain.v3`) — cartão de rascunho e recibo DETERMINÍSTICOS.
//
// Antes o texto do rascunho era escrito livremente pelo modelo, que às vezes
// descrevia algo diferente do que a ferramenta guardou (ex.: "Categoria: Adega"
// quando nenhuma categoria foi resolvida). Aqui o texto nasce dos campos
// realmente persistidos — se não há categoria resolvida, o cartão diz isso.
import { pickVariant } from "./ToneVariants.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type DraftCardFields = {
  kind: "expense" | "income" | "transfer" | "bill_payment";
  amount: number;
  description?: string | null;
  /** Nome REAL da categoria resolvida; null quando ainda não há. */
  category?: string | null;
  /** `explicit` = o usuário pediu; `auto_later` = motor classifica depois. */
  category_status?: "explicit" | "auto_later";
  account?: string | null;
  card?: string | null;
  from_account?: string | null;
  to_account?: string | null;
  installments_total?: number | null;
  occurred_at: string;
};

function dateBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

function titleFor(kind: DraftCardFields["kind"]): string {
  if (kind === "income") return "Receita";
  if (kind === "transfer") return "Transferência";
  if (kind === "bill_payment") return "Pagamento de fatura";
  return "Despesa";
}

function lines(f: DraftCardFields): string[] {
  const out: string[] = [`• *${titleFor(f.kind)}:* ${BRL.format(Number(f.amount ?? 0))}`];
  if (f.description) out.push(`• *Descrição:* ${f.description}`);
  if (f.kind === "transfer") {
    if (f.from_account) out.push(`• *De:* ${f.from_account}`);
    if (f.to_account) out.push(`• *Para:* ${f.to_account}`);
  } else {
    if (f.card) {
      const parc = Number(f.installments_total ?? 1) > 1 ? ` (${f.installments_total}x)` : "";
      out.push(`• *Cartão:* ${f.card}${parc}`);
    }
    if (f.account) out.push(`• *Conta:* ${f.account}`);
  }
  if (f.kind !== "transfer" && f.kind !== "bill_payment") {
    out.push(f.category
      ? `• *Categoria:* ${f.category}`
      : "• *Categoria:* eu classifico depois");
  }
  out.push(`• *Data:* ${dateBR(f.occurred_at)}`);
  return out;
}

/** Cartão de rascunho, pronto para WhatsApp e app. Layout sempre igual. */
export function renderDraftCard(f: DraftCardFields, seed = ""): string {
  const open = pickVariant("draft_open", `${seed}|${f.amount}|${f.occurred_at}`);
  const ask = pickVariant("draft_ask", `${seed}|${f.occurred_at}|${f.amount}`);
  return `${open}\n\n${lines(f).join("\n")}\n\n${ask}`;
}

/** Recibo pós-confirmação: ecoa o que ficou salvo, sem frase sempre igual. */
export function renderReceiptCard(f: DraftCardFields, seed = ""): string {
  const open = pickVariant("receipt_open", `${seed}|${f.occurred_at}|${f.amount}`);
  const what = f.description ? ` — ${f.description}` : "";
  const head = `${open}: ${titleFor(f.kind)} de ${BRL.format(Number(f.amount ?? 0))}${what} em ${dateBR(f.occurred_at)}. ✅`;
  const tail = !f.category && f.kind !== "transfer" && f.kind !== "bill_payment"
    ? "\n\nA categoria eu ajusto sozinho; se quiser definir agora, só me dizer."
    : "";
  return `${head}${tail}`;
}
