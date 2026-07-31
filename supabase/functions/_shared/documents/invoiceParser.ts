// Parser determinístico de faturas de cartão (camada de texto do PDF).
//
// Motivação: a extração multimodal (LLM) perde linhas silenciosamente — em uma
// fatura Itaú real ela omitiu todo o bloco "Pagamentos efetuados" (R$ 4.099,34)
// e duas linhas pequenas (Amazon Prime R$ 19,90 e Repasse de IOF R$ 62,71).
// Aqui lemos rótulos e linhas de forma determinística, e o LLM passa a ser
// usado para categorização e como fallback (PDF sem camada de texto).
//
// Este módulo é PURO (sem APIs do Deno) para poder ser testado no Vitest.

export type InvoiceSection =
  | "payments"
  | "domestic"
  | "international"
  | "taxes"
  | "credits"
  | "future_installments"
  | "other";

export type ParsedInvoiceLine = {
  date: string | null; // YYYY-MM-DD
  description: string;
  amount: number; // sempre positivo
  section: InvoiceSection;
  kind: "purchase" | "payment" | "refund" | "fee";
};

export type InvoiceOfficialSummary = {
  total: number | null;
  previous_balance: number | null;
  payments_total: number | null;
  financed_balance: number | null;
  current_charges_total: number | null;
  domestic_total: number | null;
  international_total: number | null;
  taxes_total: number | null;
  credits_total: number | null;
  due_date: string | null;
  closing_date: string | null;
  competence: string | null;
  card_last4: string | null;
  bank: string | null;
};

export type ParsedInvoice = {
  detected: boolean;
  summary: InvoiceOfficialSummary;
  lines: ParsedInvoiceLine[];
};

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const AMOUNT_RE = /(-?\s*(?:R\$)?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*(-)?\s*$/;

export function parseBrAmount(raw: string): number | null {
  const cleaned = raw.replace(/R\$/g, "").replace(/\s/g, "");
  const negative = cleaned.startsWith("-") || cleaned.endsWith("-");
  const digits = cleaned.replace(/-/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return round2(negative ? -value : value);
}

function amountAtEnd(line: string): { value: number; rest: string } | null {
  const m = line.match(AMOUNT_RE);
  if (!m) return null;
  const value = parseBrAmount(m[1] + (m[2] ?? ""));
  if (value == null) return null;
  return { value, rest: line.slice(0, m.index ?? 0).trim() };
}

const SUMMARY_LABELS: Array<[keyof InvoiceOfficialSummary, RegExp]> = [
  ["previous_balance", /\b(total da fatura anterior|saldo da fatura anterior|fatura anterior|saldo anterior)\b/],
  ["payments_total", /\b(pagamentos? efetuados?|pagamentos? e creditos|total de pagamentos|pagamentos realizados)\b/],
  ["financed_balance", /\b(saldo financiado|total financiado|saldo restante( anterior)?)\b/],
  ["current_charges_total", /\b(lancamentos atuais|total de lancamentos atuais|compras e saques do periodo|lancamentos desta fatura)\b/],
  ["domestic_total", /\b(total (das )?compras nacionais|total nacionais|total de lancamentos nacionais)\b/],
  ["international_total", /\b(total (das )?compras internacionais|total internacionais|total de transacoes internacionais|total de lancamentos internacionais)\b/],
  ["taxes_total", /\b(total de iof|iof total|total de encargos|total de tarifas)\b/],
  ["credits_total", /\b(total de creditos|total de estornos)\b/],
  ["total", /\b(total desta fatura|total da fatura atual|valor total desta fatura|total a pagar desta fatura|total desta fatura em r\$)\b/],
];

const SECTION_HEADERS: Array<[InvoiceSection, RegExp]> = [
  ["future_installments", /\b(proximas faturas|compras parceladas\s*[-–]\s*proximas|parcelas futuras|lancamentos futuros)\b/],
  ["payments", /\b(pagamentos? efetuados?|antecipacoes|pagamentos? e creditos)\b/],
  ["international", /\b(compras internacionais|transacoes internacionais|lancamentos internacionais|compras no exterior)\b/],
  ["credits", /\b(creditos e estornos|estornos)\b/],
  ["taxes", /\b(encargos( e iof)?|tarifas e encargos|juros e multa)\b/],
  ["domestic", /\b(compras nacionais|lancamentos nacionais|lancamentos atuais|compras e saques)\b/],
];

function lineKind(folded: string): ParsedInvoiceLine["kind"] | null {
  if (/\b(pagamento|pagto|antecipacao)\b/.test(folded)) return "payment";
  if (/\b(estorno|reembolso|credito de compra|cancelamento)\b/.test(folded)) return "refund";
  if (/\b(iof|tarifa|anuidade|juros|multa|encargo)\b/.test(folded)) return "fee";
  return null;
}

function isNoiseLine(folded: string): boolean {
  return /\b(limite (total|disponivel|de credito)|saldo disponivel|pagamento minimo|total desta fatura|total da fatura|lancamentos atuais|total da fatura anterior|saldo financiado|pagamentos efetuados|codigo de barras|central de atendimento|sac|ouvidoria|pagina \d)\b/.test(folded);
}

function isoFromDayMonth(day: string, month: string, refDate: string | null): string | null {
  const d = Number(day);
  const m = Number(month);
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null;
  let year = refDate ? Number(refDate.slice(0, 4)) : new Date().getUTCFullYear();
  const refMonth = refDate ? Number(refDate.slice(5, 7)) : m;
  if (m > refMonth) year -= 1;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findDate(folded: string): string | null {
  const full = folded.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (full) return `${full[3]}-${full[2]}-${full[1]}`;
  const short = folded.match(/(\d{2})\/(\d{2})\/(\d{2})\b/);
  if (short) return `20${short[3]}-${short[2]}-${short[1]}`;
  return null;
}

export function parseInvoiceText(text: string): ParsedInvoice {
  const summary: InvoiceOfficialSummary = {
    total: null, previous_balance: null, payments_total: null, financed_balance: null,
    current_charges_total: null, domestic_total: null, international_total: null,
    taxes_total: null, credits_total: null, due_date: null, closing_date: null,
    competence: null, card_last4: null, bank: null,
  };
  const lines: ParsedInvoiceLine[] = [];
  const rawLines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const foldedAll = fold(rawLines.join("\n"));
  if (/\bitau\b/.test(foldedAll)) summary.bank = "Itaú";
  else if (/\bnubank\b/.test(foldedAll)) summary.bank = "Nubank";
  else if (/\bbradesco\b/.test(foldedAll)) summary.bank = "Bradesco";
  else if (/\bsantander\b/.test(foldedAll)) summary.bank = "Santander";
  else if (/\bbanco do brasil\b/.test(foldedAll)) summary.bank = "Banco do Brasil";
  else if (/\binter\b/.test(foldedAll)) summary.bank = "Inter";

  // 1) Passada de metadados/rotulos.
  for (const raw of rawLines) {
    const f = fold(raw);
    if (!summary.due_date && /\b(vencimento|vence em|data de vencimento)\b/.test(f)) {
      summary.due_date = findDate(f);
    }
    if (!summary.closing_date && /\b(fechamento|data de fechamento|fechada em)\b/.test(f)) {
      summary.closing_date = findDate(f);
    }
    if (!summary.card_last4) {
      const last4 = f.match(/\b(?:final|finais|cartao final|n[.º°]?\s*final)\s*[:\-]?\s*(\d{4})\b/)
        ?? f.match(/\*{4,}\s*(\d{4})\b/);
      if (last4) summary.card_last4 = last4[1];
    }
    const amount = amountAtEnd(raw);
    if (!amount) continue;
    for (const [key, re] of SUMMARY_LABELS) {
      if (summary[key] != null) continue;
      if (!re.test(f)) continue;
      (summary as Record<string, unknown>)[key] = Math.abs(amount.value);
      break;
    }
  }
  if (summary.due_date) summary.competence = `${summary.due_date.slice(0, 7)}-01`;

  // 2) Passada de linhas, com seção corrente.
  let section: InvoiceSection = "other";
  for (const raw of rawLines) {
    const f = fold(raw);
    const header = SECTION_HEADERS.find(([, re]) => re.test(f));
    const amount = amountAtEnd(raw);
    if (header && (!amount || isNoiseLine(f))) {
      section = header[0];
      continue;
    }
    if (!amount) {
      if (header) section = header[0];
      continue;
    }
    if (isNoiseLine(f)) {
      if (header) section = header[0];
      continue;
    }
    const dateMatch = amount.rest.match(/^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s+(.*)$/);
    if (!dateMatch) continue;
    const description = dateMatch[4].trim();
    if (!description || description.length < 2) continue;
    const yearPart = dateMatch[3];
    const date = yearPart
      ? `${yearPart.length === 2 ? `20${yearPart}` : yearPart}-${dateMatch[2]}-${dateMatch[1]}`
      : isoFromDayMonth(dateMatch[1], dateMatch[2], summary.due_date);
    const fdesc = fold(description);
    const detectedKind = lineKind(fdesc);
    const negative = amount.value < 0;
    const kind: ParsedInvoiceLine["kind"] = detectedKind
      ?? (negative ? "refund" : "purchase");
    let lineSection: InvoiceSection = section;
    if (kind === "payment") lineSection = "payments";
    else if (kind === "fee" && section !== "future_installments") lineSection = "taxes";
    else if (section === "other" || section === "payments") lineSection = "domestic";
    // Estorno permanece na seção de origem: o subtotal oficial da seção já é
    // líquido (compras − estornos). Movê-lo para "créditos" criaria um gap falso.


    lines.push({
      date,
      description,
      amount: Math.abs(amount.value),
      section: lineSection,
      kind,
    });
  }

  const detected = summary.total != null &&
    (summary.previous_balance != null || summary.payments_total != null || summary.current_charges_total != null) &&
    lines.length > 0;

  return { detected, summary, lines };
}

export type SectionCoverage = {
  section: InvoiceSection;
  official_total: number | null;
  extracted_total: number;
  difference: number | null;
  covered: boolean;
};

export type InvoiceCoverage = {
  sections: SectionCoverage[];
  equation_ok: boolean;
  calculated_total: number | null;
  difference: number | null;
  gap_section: InvoiceSection | null;
  gap_amount: number;
};

const TOLERANCE = 0.05;

/** Auditoria em 3 camadas: linhas por seção → subtotais → total oficial. */
export function auditInvoiceCoverage(
  summary: InvoiceOfficialSummary,
  lines: ParsedInvoiceLine[],
  tolerance = TOLERANCE,
): InvoiceCoverage {
  // Subtotais oficiais de compras já vêm líquidos de estorno; pagamentos vêm em
  // valor absoluto.
  const sumOf = (s: InvoiceSection) =>
    round2(lines.filter((l) => l.section === s).reduce((acc, l) => {
      if (s === "payments") return acc + Math.abs(l.amount);
      return acc + (l.kind === "refund" ? -Math.abs(l.amount) : Math.abs(l.amount));
    }, 0));


  const pairs: Array<[InvoiceSection, number | null]> = [
    ["payments", summary.payments_total],
    ["domestic", summary.domestic_total],
    ["international", summary.international_total],
    ["taxes", summary.taxes_total],
    ["credits", summary.credits_total],
  ];

  const sections: SectionCoverage[] = [];
  let gap_section: InvoiceSection | null = null;
  let gap_amount = 0;

  for (const [section, official] of pairs) {
    const extracted = sumOf(section);
    const difference = official == null ? null : round2(official - extracted);
    const covered = difference == null ? true : Math.abs(difference) <= tolerance;
    sections.push({ section, official_total: official, extracted_total: extracted, difference, covered });
    if (difference != null && !covered && Math.abs(difference) > Math.abs(gap_amount)) {
      gap_section = section;
      gap_amount = difference;
    }
  }

  // Camada de lançamentos atuais: tudo que não é pagamento nem parcela futura.
  const currentActivity = round2(
    lines
      .filter((l) => l.section !== "payments" && l.section !== "future_installments")
      .reduce((acc, l) => acc + (l.kind === "refund" ? -Math.abs(l.amount) : Math.abs(l.amount)), 0),
  );
  if (summary.current_charges_total != null) {
    const difference = round2(summary.current_charges_total - currentActivity);
    const covered = Math.abs(difference) <= tolerance;
    sections.push({
      section: "other",
      official_total: summary.current_charges_total,
      extracted_total: currentActivity,
      difference,
      covered,
    });
    if (!covered && Math.abs(difference) > Math.abs(gap_amount)) {
      gap_section = "other";
      gap_amount = difference;
    }
  }

  const payments = round2(sumOf("payments"));
  const calculated_total = summary.total == null
    ? null
    : round2((summary.previous_balance ?? 0) - payments + currentActivity);
  const difference = calculated_total == null || summary.total == null
    ? null
    : round2(summary.total - calculated_total);

  return {
    sections,
    equation_ok: difference != null && Math.abs(difference) <= tolerance,
    calculated_total,
    difference,
    gap_section,
    gap_amount,
  };
}

/** Mensagem em pt-BR simples, sem jargão, sobre a seção incompleta. */
export function coverageMessage(coverage: InvoiceCoverage): string | null {
  if (coverage.gap_section == null) return null;
  const names: Record<InvoiceSection, string> = {
    payments: "Pagamentos",
    domestic: "Compras nacionais",
    international: "Compras internacionais",
    taxes: "IOF e encargos",
    credits: "Estornos",
    future_installments: "Parcelas de próximas faturas",
    other: "Lançamentos atuais",
  };
  const money = Math.abs(coverage.gap_amount).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const direction = coverage.gap_amount > 0 ? "abaixo" : "acima";
  return `Os itens lidos estão ${money} ${direction} do total de ${names[coverage.gap_section]}.`;
}
