// AdvisorConsult (`nino_advisor.v1`) — camada CONSULTOR.
//
// O Nino já registra e explica. Aqui ele decide COM o usuário: dado um valor,
// um número de parcelas e o cenário financeiro real, o motor devolve o veredito
// (cabe / cabe apertado / não cabe), a linha do tempo mês a mês e quanto
// precisaria ser liberado por mês para caber.
//
// Regra de ouro: nada é calculado no texto do modelo. Tudo sai daqui, com
// premissas explícitas e valores em reais.

export type AdvisorVerdict = "cabe" | "cabe_apertado" | "nao_cabe";

export type AdvisorMonth = {
  /** "2026-08" */
  month: string;
  /** Nº de ordem a partir do mês da decisão (1 = mês atual). */
  index: number;
  /** Folga projetada do mês ANTES da nova parcela. */
  free_before: number;
  /** Parcela que cai neste mês (0 quando já terminou). */
  installment: number;
  /** Folga projetada DEPOIS da nova parcela. */
  free_after: number;
  /** Mês fica negativo com a nova parcela. */
  tight: boolean;
};

export type AdvisorInstallmentInput = {
  amount: number;
  installments: number;
  method: "cash" | "card";
  /** ISO "YYYY-MM-DD" */
  today: string;
  /** Folga projetada para o fechamento do mês atual (motor canônico). */
  projected_month_end_available: number;
  /** Renda mensal recorrente estimada (motor canônico / configuração). */
  monthly_income: number;
  /** Consumo mensal típico observado (ritmo × dias). */
  monthly_typical_expense: number;
  /** Parcelas de dívidas já contratadas, por mês. */
  monthly_debt_installments: number;
  /** Parcelas de cartão já contratadas, por mês (média). */
  monthly_card_installments: number;
  /** Parcelas de cartão já contratadas por mês futuro ("2026-09" => 320.5). */
  card_installments_by_month?: Record<string, number>;
};

export type AdvisorInstallmentResult = {
  formula_version: "nino_advisor.installment.v1";
  verdict: AdvisorVerdict;
  amount: number;
  installments: number;
  installment_amount: number;
  method: "cash" | "card";
  /** Folga mensal recorrente antes da decisão. */
  monthly_free_cash: number;
  /** Quanto a parcela consome da folga mensal (0..n). */
  share_of_free_cash: number;
  /** Quanto a parcela consome da renda mensal (0..n). */
  share_of_income: number;
  timeline: AdvisorMonth[];
  tight_months: string[];
  /** Valor que precisa ser liberado por mês para o plano caber com folga. */
  required_monthly_release: number;
  /** Maior nº de parcelas que caberia sem aperto (null quando nem 1x cabe). */
  max_comfortable_installments: number | null;
  assumptions: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function addMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Viabilidade real de um gasto parcelado, mês a mês.
 *
 * Mês 1 usa a folga projetada do fechamento (verdade canônica do mês corrente).
 * Meses seguintes usam a folga recorrente: renda − consumo típico − parcelas de
 * dívida − parcelas de cartão já contratadas.
 */
export function planInstallmentDecision(input: AdvisorInstallmentInput): AdvisorInstallmentResult {
  const amount = Math.max(0, Number(input.amount) || 0);
  const installments = Math.max(1, Math.min(48, Math.floor(Number(input.installments) || 1)));
  const installmentAmount = round2(amount / installments);
  const income = Math.max(0, Number(input.monthly_income) || 0);
  const typical = Math.max(0, Number(input.monthly_typical_expense) || 0);
  const debts = Math.max(0, Number(input.monthly_debt_installments) || 0);
  const cards = Math.max(0, Number(input.monthly_card_installments) || 0);

  const recurringFree = round2(income - typical - debts - cards);
  const month0 = input.today.slice(0, 7);

  const byMonth = input.card_installments_by_month ?? {};
  const timeline: AdvisorMonth[] = [];
  for (let i = 0; i < installments; i += 1) {
    const month = addMonth(month0, i);
    // Parcela de cartão já contratada para aquele mês tem precedência sobre a
    // média: é obrigação conhecida, não estimativa.
    const contracted = Number(byMonth[month] ?? NaN);
    const freeBefore = i === 0
      ? round2(Number(input.projected_month_end_available) || 0)
      : round2(Number.isFinite(contracted) ? income - typical - debts - contracted : recurringFree);
    const freeAfter = round2(freeBefore - installmentAmount);
    timeline.push({
      month,
      index: i + 1,
      free_before: freeBefore,
      installment: installmentAmount,
      free_after: freeAfter,
      tight: freeAfter < 0,
    });
  }

  const tight = timeline.filter((m) => m.tight);
  const worstDeficit = tight.length ? Math.max(...tight.map((m) => -m.free_after)) : 0;

  // Reserva de segurança: 10% da renda (mínimo R$ 100) para o veredito não
  // chamar "cabe" um plano que zera o mês.
  const buffer = Math.max(100, round2(income * 0.1));
  const worstAfter = timeline.length ? Math.min(...timeline.map((m) => m.free_after)) : 0;
  const verdict: AdvisorVerdict = tight.length
    ? "nao_cabe"
    : worstAfter < buffer
      ? "cabe_apertado"
      : "cabe";

  let maxComfortable: number | null = null;
  for (let n = 48; n >= 1; n -= 1) {
    const perMonth = round2(amount / n);
    const firstOk = (Number(input.projected_month_end_available) || 0) - perMonth >= 0;
    const restOk = n === 1 ? true : recurringFree - perMonth >= 0;
    if (firstOk && restOk) { maxComfortable = n; break; }
  }
  // Um parcelamento em mais vezes só é "confortável" se a menor parcela couber.
  if (maxComfortable === null) maxComfortable = null;

  return {
    formula_version: "nino_advisor.installment.v1",
    verdict,
    amount: round2(amount),
    installments,
    installment_amount: installmentAmount,
    method: input.method,
    monthly_free_cash: recurringFree,
    share_of_free_cash: recurringFree > 0 ? round2(installmentAmount / recurringFree) : 1,
    share_of_income: income > 0 ? round2(installmentAmount / income) : 1,
    timeline,
    tight_months: tight.map((m) => m.month),
    required_monthly_release: round2(worstDeficit > 0 ? worstDeficit : Math.max(0, buffer - worstAfter)),
    max_comfortable_installments: maxComfortable,
    assumptions: [
      "Mês atual usa a folga projetada de fechamento do motor canônico.",
      "Meses seguintes usam renda recorrente menos consumo típico, parcelas de dívida e parcelas de cartão já contratadas.",
      "Reserva de segurança de 10% da renda (mínimo R$ 100) antes de dizer que cabe.",
      "Nenhum juro de parcelamento é presumido: se houver juro, informe o valor total já com juros.",
    ],
  };
}

/** Intenções de consultoria reconhecidas em pt-BR (determinístico). */
export type AdvisorIntent = "affordability" | "reduction" | "tradeoff" | null;

const norm = (t: string) =>
  String(t ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

const AFFORDABILITY_RX =
  /\b(consigo (?:pagar|assumir|bancar|arcar)|cabe no meu (?:mes|orcamento|bolso)|da conta de pagar|vale a pena parcelar|posso parcelar|em quantas vezes|em quantas parcelas|parcelar em \d+|melhor parcelar|impacto (?:de|da|dessa) (?:parcela|prestacao)|assumir (?:uma )?(?:parcela|prestacao)|comprometer)\b/;

const REDUCTION_RX =
  /\b(quanto (?:eu )?(?:consigo|conseguiria|daria|posso) (?:reduzir|cortar|economizar|diminuir|poupar)|onde (?:da|daria) (?:pra|para) (?:cortar|reduzir|economizar)|onde (?:eu )?(?:posso|consigo) (?:cortar|reduzir|economizar)|reduzir (?:em|nas|nos|meus|minhas)? ?(?:outras )?(?:categorias|gastos|despesas)|sobrar mais|liberar (?:r\$\s*)?\d|preciso (?:de )?(?:sobrar|liberar|economizar)|como (?:faco|fazer) (?:pra|para) (?:sobrar|economizar|guardar)|apertar o cinto|enxugar (?:gastos|despesas))\b/;

const TRADEOFF_RX =
  /\b(se eu (?:cortar|reduzir|parar de|deixar de)|trocar .{0,20} por|(?:cortando|reduzindo) .{0,25} (?:consigo|da|daria))\b/;

export function classifyAdvisorIntent(text: string): AdvisorIntent {
  const t = norm(text);
  if (!t) return null;
  if (TRADEOFF_RX.test(t)) return "tradeoff";
  if (REDUCTION_RX.test(t)) return "reduction";
  if (AFFORDABILITY_RX.test(t)) return "affordability";
  return null;
}

/** Nº de parcelas citado explicitamente ("em 10x", "em 12 vezes", "10 parcelas"). */
export function installmentsFromText(text: string): number | null {
  const t = norm(text);
  const m = t.match(/\b(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas|prestacoes)\b/);
  const n = m ? Number(m[1]) : null;
  return n && n >= 1 && n <= 48 ? n : null;
}
