// BankNotificationParser (`nino_bank_notification.v1`) — leitura determinística
// e FAIL-CLOSED de comprovante/notificação bancária colada no WhatsApp.
//
// "Pix de R$ 6,00 enviado para Pagar Me Pagamentos / Data: 10/09/2026 18:23:23"
// é texto estruturado: não precisa de modelo para virar rascunho.
//
// Fail-closed: só evento CONCLUÍDO e inequívoco gera rascunho. Agendado, em
// processamento, recusado, cancelado, devolvido, estornado, pagamento de fatura
// e transferência entre contas próprias caem no pipeline normal.

export type BankEventClass =
  | "completed_outflow"
  | "completed_inflow"
  | "scheduled"
  | "processing"
  | "declined"
  | "cancelled"
  | "refund"
  | "reversal"
  | "card_payment"
  | "internal_transfer"
  | "unknown";

export type BankNotification = {
  event_class: BankEventClass;
  /** Só true para completed_* inequívoco com valor e data legíveis. */
  draftable: boolean;
  type: "expense" | "income" | null;
  amount: number | null;
  counterparty: string | null;
  occurred_at: string | null;
  payment_method: string | null;
  /** Nome de banco/conta citado no texto; a resolução do id é feita fora. */
  account_hint: string | null;
  confidence: number;
  reason: string;
};

const EMPTY = (event_class: BankEventClass, reason: string): BankNotification => ({
  event_class, draftable: false, type: null, amount: null, counterparty: null,
  occurred_at: null, payment_method: null, account_hint: null, confidence: 0, reason,
});

function norm(text: string): string {
  return String(text ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function parseAmount(raw: string): number | null {
  const m = raw.match(/r\$\s*([\d.]+,\d{2}|[\d.]+)/i);
  if (!m) return null;
  const digits = m[1].replace(/\./g, "").replace(",", ".");
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDate(raw: string, now: Date): string | null {
  const br = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    const iso = `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    return Number.isFinite(Date.parse(iso)) ? iso : null;
  }
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (/\bhoje\b/.test(norm(raw))) return now.toISOString().slice(0, 10);
  return null;
}

const BANK_NAMES = [
  "itau", "itaú", "nubank", "bradesco", "santander", "banco do brasil", "caixa",
  "inter", "c6", "picpay", "mercado pago", "will bank", "banco pan", "pan", "neon",
  "original", "safra", "sicredi", "sicoob", "btg", "xp",
];

/** Classifica e, quando seguro, extrai os campos do lançamento. */
export function parseBankNotification(text: string, now: Date = new Date()): BankNotification {
  const raw = String(text ?? "");
  const t = norm(raw);
  if (!t) return EMPTY("unknown", "empty");

  // Precisa parecer notificação bancária: valor + verbo de movimentação.
  const looksBank = /\b(pix|ted|doc|transferencia|comprovante|pagamento|compra|debito|credito|deposito)\b/.test(t)
    && /r\$/i.test(raw);
  if (!looksBank) return EMPTY("unknown", "not_bank_notification");

  // --- classificação fail-closed (ordem importa) --------------------------
  if (/\b(estorn\w+|revers\w+|chargeback)\b/.test(t)) return EMPTY("reversal", "reversal_not_draftable");
  if (/\b(devolvid\w+|devolucao|reembols\w+|refund)\b/.test(t)) return EMPTY("refund", "refund_not_draftable");
  if (/\b(recusad\w+|negad\w+|nao autorizad\w+|sem saldo|falhou|erro na transacao)\b/.test(t)) {
    return EMPTY("declined", "declined_not_draftable");
  }
  if (/\b(cancelad\w+|cancelamento)\b/.test(t)) return EMPTY("cancelled", "cancelled_not_draftable");
  if (/\b(agendad\w+|programad\w+|vai ser (?:pago|debitado)|sera (?:pago|debitado)|agendamento)\b/.test(t)) {
    return EMPTY("scheduled", "scheduled_not_draftable");
  }
  if (/\b(em processamento|processando|aguardando|em analise|pendente)\b/.test(t)) {
    return EMPTY("processing", "processing_not_draftable");
  }
  if (/\b(fatura|cartao de credito|pagamento de fatura|parcela da fatura)\b/.test(t)) {
    return EMPTY("card_payment", "card_payment_needs_canonical_flow");
  }
  if (/\b(entre (?:suas|minhas) contas|para (?:minha|sua) conta|mesma titularidade|aplicacao|resgate|para (?:a )?poupanca)\b/.test(t)) {
    return EMPTY("internal_transfer", "internal_transfer_not_expense");
  }

  const outflow = /\b(enviado|enviei|enviou|pagamento de|paguei|pago para|debitado|debito|transferido para|compra aprovada|compra de|fez (?:um|uma) (?:pix|ted|doc|transferencia)|pix para)\b/.test(t);
  const inflow = /\b(recebido|recebi|recebeu|entrada de|creditado|deposito|pix recebido)\b/.test(t);
  if (outflow && inflow) return EMPTY("unknown", "ambiguous_direction");
  if (!outflow && !inflow) return EMPTY("unknown", "no_direction");

  const amount = parseAmount(raw);
  if (amount === null) return EMPTY(outflow ? "completed_outflow" : "completed_inflow", "amount_unreadable");
  const occurred_at = parseDate(raw, now);
  if (!occurred_at) return EMPTY(outflow ? "completed_outflow" : "completed_inflow", "date_unreadable");

  // Contraparte: "enviado para X", "recebido de X", "compra em X".
  const TAIL = "(?:\\s*(?:[-–|]|\\bdata\\b|\\bem\\b\\s*\\d|\\d{2}\\/\\d{2}|$))";
  const cpPatterns = [
    `(?:enviado\\s+para|pago\\s+para|pagamento\\s+para|transferido\\s+para|compra\\s+em|para)\\s+([^\\n\\r]{2,60}?)${TAIL}`,
    `(?:recebido\\s+de|recebeu\\s+de|creditado\\s+por|de)\\s+([^\\n\\r]{2,60}?)${TAIL}`,
  ];
  // O valor sai do texto antes: "de R$ 1.200,00 de Lucas" tem dois "de" e o
  // primeiro é o valor, não a contraparte.
  const rawNoAmount = raw.replace(/(?:de\s+)?r\$\s*[\d.]+(?:,\d{2})?/gi, " ");
  let cp: RegExpMatchArray | null = null;
  for (const pattern of outflow ? cpPatterns : [cpPatterns[1], cpPatterns[0]]) {
    for (const m of rawNoAmount.matchAll(new RegExp(pattern, "gi"))) {
      // "de R$ 6,00" é o VALOR, nunca a contraparte.
      if (!/^r\$|^\d/i.test(m[1].trim())) { cp = m as RegExpMatchArray; break; }
    }
    if (cp) break;
  }
  const counterparty = cp?.[1]?.trim()
    .replace(/\s+(hoje|ontem|anteontem)\s*$/i, "")
    .replace(/[.,;:]+$/, "") || null;
  if (!counterparty || counterparty.length < 2) {
    return EMPTY(outflow ? "completed_outflow" : "completed_inflow", "counterparty_unreadable");
  }

  const payment_method = /\bpix\b/.test(t) ? "pix"
    : /\b(ted|doc|transferencia)\b/.test(t) ? "transfer"
    : /\bdebito\b/.test(t) ? "debit"
    : null;

  const bank = BANK_NAMES.find((b) => t.includes(norm(b)));
  // Conta só quando há UMA menção clara de banco. Na dúvida fica vazio.
  const bankMentions = BANK_NAMES.filter((b) => t.includes(norm(b)));
  const account_hint = bank && bankMentions.length === 1 ? bank : null;

  return {
    event_class: outflow ? "completed_outflow" : "completed_inflow",
    draftable: true,
    type: outflow ? "expense" : "income",
    amount, counterparty, occurred_at, payment_method, account_hint,
    confidence: 0.95,
    reason: "completed_structured_notification",
  };
}
