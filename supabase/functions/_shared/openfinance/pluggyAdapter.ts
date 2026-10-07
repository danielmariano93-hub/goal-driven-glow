// open_finance_adapter.v1 — traduz o que o Pluggy devolve para `import_item.v2`.
//
// Função pura: nada de rede nem banco. O formato do Pluggy foi lido da documentação
// pública (id, description, amount, date, type DEBIT|CREDIT, status POSTED|PENDING,
// category, creditCardMetadata, paymentData, merchant) e é tratado de forma defensiva:
// campo ausente ou fora do esperado vira "item para revisão", nunca lançamento errado.
//
// Regras de negócio (as mesmas do restante do Nino):
//  • pagamento de fatura NÃO é gasto (as compras do cartão já foram contadas);
//  • transferência entre contas próprias e aplicação/resgate NÃO são consumo;
//  • transação PENDING não entra (ainda não foi lançada pelo banco);
//  • identidade forte = `external_id` = "pluggy:<id>" (idempotência entre sincronizações).
import type { ImportItem, MovementKind } from "../import/schema.ts";

export type PluggyTransaction = {
  id?: string | null;
  description?: string | null;
  descriptionRaw?: string | null;
  amount?: number | string | null;
  date?: string | null;
  type?: string | null;
  status?: string | null;
  category?: string | null;
  categoryId?: string | null;
  merchant?: { name?: string | null; businessName?: string | null } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    purchaseDate?: string | null;
  } | null;
  paymentData?: Record<string, unknown> | null;
};

export type AdaptContext = {
  /** tipo da conta no Pluggy: BANK (conta) ou CREDIT (cartão) */
  accountType: "BANK" | "CREDIT" | "OTHER";
};

export type AdaptResult = {
  items: ImportItem[];
  skipped: { pending: number; invalid: number; card_side: number; auto_sweep: number };
};

const fold = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const isoDay = (raw: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const PATTERNS: Array<{ kind: MovementKind; match: RegExp }> = [
  { kind: "card_payment", match: /(pagamento|pgto|pag\.?)\s*(de\s*)?(fatura|cartao)|fatura\s*(cartao|paga)|credit card payment/ },
  { kind: "refund", match: /estorno|reembolso|devolucao|chargeback|refund/ },
  { kind: "loan_proceeds", match: /credito\s*(de\s*)?(emprestimo|consignado)|emprestimo\s*(contratado|liberado)/ },
];

// "Aplicação Automática" (varre-conta): o banco aplica a sobra e resgata sozinho quando falta saldo.
// A API do Open Finance expõe as pontas (RES/APL APLIC AUT), mas o app e o extrato do cliente não;
// são equivalentes de caixa, sem efeito no patrimônio, então não entram. O rendimento ("REND PAGO")
// e os resgates/aplicações manuais continuam entrando.
const AUTO_SWEEP = /\b(res|apl|resg|aplic)\.?\s*(de\s*)?aplic\.?\s*aut/;

const YIELD = /rendimento|rend\.?\s*(pago|liq)|juros\s*(recebidos|s\/|sobre capital)|dividendo/;
const REDEMPTION = /resgate|resg\.?\s|\b(cdb|rdb|lci|lca|tesouro)\b.*resg/;
const APPLICATION = /aplicacao|aplic\.?\s|\b(cdb|rdb|lci|lca|tesouro)\b.*(compra|aplic)|invest.*aplic/;

/** Destino é empresa/comércio? Usa o documento do favorecido (CNPJ), o estabelecimento ou o texto (QR, Pix Automático). */
function isBusinessPayee(tx: PluggyTransaction, text: string): boolean {
  const receiver = (tx.paymentData as any)?.receiver;
  const docType = String(receiver?.documentNumber?.type ?? "").toUpperCase();
  if (docType === "CNPJ") return true;
  if (docType === "CPF") return false;
  if (tx.merchant?.name || tx.merchant?.businessName) return true;
  return /pix\s*(qr|automatico|por aproximacao)|qr\s*code|debito automatico|pagamento\s*(de\s*)?(conta|boleto)|\b(ltda|s\/a|eireli|mei)\b/.test(text);
}

function classify(
  tx: PluggyTransaction,
  type: "income" | "expense",
  ctx: AdaptContext,
): { kind: MovementKind; confident: boolean; issue: string | null } {
  const text = fold(`${tx.description ?? ""} ${tx.descriptionRaw ?? ""} ${tx.category ?? ""}`);

  // Investimento: a DIREÇÃO manda (aplicação é saída; resgate e rendimento são entrada).
  // Resgate é testado antes de aplicação: "RESGATE APLICACAO AUTOMATICA" é entrada.
  if (YIELD.test(text) && type === "income") return { kind: "investment_yield", confident: true, issue: null };
  if (REDEMPTION.test(text)) {
    return type === "income"
      ? { kind: "investment_redemption", confident: true, issue: null }
      : { kind: "transaction", confident: false, issue: "resgate_com_direcao_de_saida" };
  }
  if (APPLICATION.test(text)) {
    return type === "expense"
      ? { kind: "investment_application", confident: true, issue: null }
      : { kind: "investment_redemption", confident: false, issue: "aplicacao_com_direcao_de_entrada" };
  }

  const hit = PATTERNS.find((p) => p.match.test(text));
  if (hit) {
    // Empréstimo é entrada que não é renda: nunca confiar só no texto.
    if (hit.kind === "loan_proceeds") return { kind: hit.kind, confident: false, issue: "emprestimo_confirmar" };
    return { kind: hit.kind, confident: true, issue: null };
  }
  if (ctx.accountType === "CREDIT" && type === "income" && /pagamento|pgto|pag\.? efetuado|payment/.test(text)) {
    return { kind: "card_payment", confident: true, issue: null };
  }
  if (ctx.accountType === "CREDIT" && type === "income") {
    // Crédito no cartão que não é estorno nem pagamento reconhecido: precisa de olho humano.
    return { kind: "refund", confident: false, issue: "credito_no_cartao_sem_natureza" };
  }
  const isTransfer = /\b(pix|ted|doc|transferencia|transf)\b/.test(text) || fold(tx.category ?? "").includes("transfer");
  if (isTransfer) {
    if (type === "income") return { kind: "external_transfer_in", confident: false, issue: "transferencia_confirmar_destino" };
    // Saída: para empresa (CNPJ, QR de comércio, Pix Automático/débito) é gasto; para pessoa é
    // transferência a terceiro "a classificar" (pode ser presente, rolê, aluguel…): a pessoa decide.
    return isBusinessPayee(tx, text)
      ? { kind: "transaction", confident: true, issue: null }
      : { kind: "external_transfer_out", confident: false, issue: "pix_pessoa_a_classificar" };
  }
  return { kind: "transaction", confident: true, issue: null };
}

export function adaptPluggyTransactions(txs: PluggyTransaction[], ctx: AdaptContext): AdaptResult {
  const skipped = { pending: 0, invalid: 0, card_side: 0, auto_sweep: 0 };
  const items: ImportItem[] = [];

  txs.forEach((tx) => {
    if (String(tx.status ?? "POSTED").toUpperCase() === "PENDING") {
      skipped.pending++;
      return;
    }
    const id = String(tx.id ?? "").trim();
    const day = isoDay(tx.date);
    const amount = Math.abs(Number(tx.amount));
    const rawType = String(tx.type ?? "").toUpperCase();
    const description = String(tx.merchant?.name ?? tx.merchant?.businessName ?? tx.description ?? "").trim();
    if (!id || !day || !Number.isFinite(amount) || amount <= 0 || !description || (rawType !== "DEBIT" && rawType !== "CREDIT")) {
      skipped.invalid++;
      return;
    }

    if (AUTO_SWEEP.test(fold(`${tx.description ?? ""} ${tx.descriptionRaw ?? ""}`))) {
      skipped.auto_sweep++;
      return;
    }
    const type: "income" | "expense" = rawType === "CREDIT" ? "income" : "expense";
    const nature = classify(tx, type, ctx);
    // O pagamento da fatura aparece nos dois lados (saída da conta e entrada no cartão): só o
    // lado da conta entra, senão o pagamento seria contado em dobro.
    if (ctx.accountType === "CREDIT" && nature.kind === "card_payment" && type === "income") {
      skipped.card_side++;
      return;
    }
    const meta = tx.creditCardMetadata ?? null;
    const total = Number(meta?.totalInstallments ?? 0);
    const number = Number(meta?.installmentNumber ?? 0);
    const hasInstallments = total > 1 && number >= 1 && number <= total;
    const purchaseDate = ctx.accountType === "CREDIT" ? isoDay(meta?.purchaseDate) : null;
    const issues = nature.issue ? [nature.issue] : [];

    items.push({
      ordinal: items.length,
      occurred_at: purchaseDate ?? day,
      posted_at: day,
      posted_at_source: "statement",
      purchase_date: purchaseDate,
      amount: Math.round(amount * 100) / 100,
      type,
      movement_kind: nature.kind,
      description,
      raw_description: String(tx.descriptionRaw ?? tx.description ?? description).trim() || null,
      merchant: String(tx.merchant?.name ?? "").trim() || null,
      category_hint: null,
      account_hint: null,
      card_hint: null,
      payment_method: ctx.accountType === "CREDIT" ? "credit_card" : "account",
      installments_total: hasInstallments ? total : null,
      installment_number: hasInstallments ? number : null,
      external_id: `pluggy:${id}`,
      bank_reference: `pluggy:${id}`,
      source_document_id: null,
      source_line_index: null,
      reverses_external_id: null,
      confidence: nature.confident ? 0.9 : 0.6,
      issues,
    });
  });

  return { items, skipped };
}

/** Nome seguro para exibir uma conta do Pluggy (sem número completo). */
export function maskedAccountName(name: string | null | undefined, number: string | null | undefined): string {
  const base = String(name ?? "Conta").trim() || "Conta";
  const digits = String(number ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `${base} ••${digits.slice(-4)}` : base;
}
