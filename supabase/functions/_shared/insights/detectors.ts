// Catálogo determinístico de dicas (insights_catalog.v1).
// ======================================================
// Regras puras, auditáveis e sem IA: cada detector recebe evidência já
// calculada pelo `finance-core` (finance_contract.v2) e devolve candidatos
// com `evidence` explícita. A IA só reescreve o texto — nunca cria o assunto.
// Módulo puro e sem dependências (testável no app e no Deno).
export interface InsightPayload {
  type: "habit" | "alert" | "celebration" | "onboarding" | "opportunity" | "categorize_transaction";
  title: string;
  body: string;
  cta_label: string;
  cta_route: string;
  model: string;
}

export interface DeterministicSignals {
  /** Dívida oficial de cartão hoje (card_exposure.v1). */
  cardDebtToday: number;
  /** Parcelas de competências futuras. */
  cardFutureInstallments: number;
  /** Alguma fatura sem documento oficial (estimativa). */
  cardDebtIsEstimated: boolean;
  /** Faturas vencendo nos próximos 7 dias. */
  statementsDueIn7d: Array<{ cardId: string; dueDate: string; amount: number }>;
  /** Saldo devedor de dívidas ativas. */
  activeDebtTotal: number;
  /** Consumo comportamental do mês e receita do mês. */
  expenseMonth: number;
  incomeMonth: number;
  /** Compromissos conhecidos nos próximos 7 dias. */
  upcomingCommitments7d: number;
  // ---- sinais adicionais (insights_catalog.v1) — todos opcionais ----
  /** Compromissos conhecidos nos próximos 30 dias. */
  upcomingCommitments30d?: number;
  /** Saldo disponível hoje (caixa livre). */
  availableToday?: number;
  /** Categoria que mais cresceu contra o mês anterior. */
  categoryGrowth?: { name: string; current: number; previous: number; growthPct: number } | null;
  /** Gasto muito acima do ticket típico do usuário. */
  amountAnomaly?: { description: string; amount: number; typicalAmount: number; occurredAt: string } | null;
  /** Ritmo diário e projeção de fechamento do mês. */
  rhythm?: { dailyTypical: number; daysLeft: number; projectedExpense: number } | null;
  /** Comerciante repetido no período. */
  recurringMerchant?: { name: string; occurrences: number; total: number } | null;
  /** Assinaturas/recorrências mensais conhecidas. */
  subscriptions?: { count: number; total: number } | null;
  /** Dias sem qualquer registro. */
  daysWithoutEntry?: number;
  /** Lançamentos sem categoria. */
  uncategorizedCount?: number;
}




export interface DeterministicCandidate extends InsightPayload {
  detector: string;
  evidence: Record<string, unknown>;
}

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Detectores determinísticos. Cada um só dispara com evidência suficiente —
 * nunca gera texto genérico e nunca inventa número.
 */
export function deterministicCandidates(s: DeterministicSignals): DeterministicCandidate[] {
  const out: DeterministicCandidate[] = [];

  const due = [...s.statementsDueIn7d].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (due && due.amount > 0) {
    out.push({
      detector: "card_statement_due_7d",
      type: "alert",
      title: "Fatura vencendo esta semana",
      body: `Sua fatura de ${brl(due.amount)} vence em ${due.dueDate.slice(8, 10)}/${due.dueDate.slice(5, 7)}. Confirme o pagamento pra não virar juros.`,
      cta_label: "Ver cartões",
      cta_route: "/app/cartoes",
      model: "deterministic",
      evidence: { card_id: due.cardId, due_date: due.dueDate, amount: due.amount },
    });
  }

  if (s.cardDebtToday > 0 && s.incomeMonth > 0 && s.cardDebtToday > s.incomeMonth * 0.4) {
    out.push({
      detector: "card_debt_vs_income",
      type: "alert",
      title: "Cartão pesando no mês",
      body: `O cartão já soma ${brl(s.cardDebtToday)} — mais de 40% do que entrou neste mês. Vale revisar o que ainda pode esperar.`,
      cta_label: "Ver cartões",
      cta_route: "/app/cartoes",
      model: "deterministic",
      evidence: { card_debt_today: s.cardDebtToday, income_month: s.incomeMonth },
    });
  }

  if (s.cardFutureInstallments > 0 && s.cardFutureInstallments > s.cardDebtToday) {
    out.push({
      detector: "future_installments_pressure",
      type: "habit",
      title: "Parcelas já comprometidas",
      body: `Você tem ${brl(s.cardFutureInstallments)} em parcelas de meses seguintes. Saber disso agora evita surpresa na próxima fatura.`,
      cta_label: "Ver parcelas",
      cta_route: "/app/cartoes",
      model: "deterministic",
      evidence: { card_future_installments: s.cardFutureInstallments },
    });
  }

  if (s.cardDebtIsEstimated) {
    out.push({
      detector: "card_statement_missing_document",
      type: "opportunity",
      title: "Falta a fatura oficial",
      body: "Um dos cartões está com valor estimado. Envie o PDF da fatura e eu deixo tudo conciliado com o número real.",
      cta_label: "Enviar fatura",
      cta_route: "/app/importar",
      model: "deterministic",
      evidence: { card_debt_is_estimated: true },
    });
  }

  if (s.activeDebtTotal > 0 && s.incomeMonth > 0 && s.activeDebtTotal > s.incomeMonth) {
    out.push({
      detector: "debt_above_income",
      type: "alert",
      title: "Dívidas acima de um mês de renda",
      body: `Suas dívidas ativas somam ${brl(s.activeDebtTotal)}. Um plano de amortização por ordem de juros costuma resolver mais rápido.`,
      cta_label: "Ver dívidas",
      cta_route: "/app/dividas",
      model: "deterministic",
      evidence: { active_debt_total: s.activeDebtTotal, income_month: s.incomeMonth },
    });
  }

  if (s.upcomingCommitments7d > 0 && s.incomeMonth > 0 && s.upcomingCommitments7d > s.incomeMonth * 0.3) {
    out.push({
      detector: "commitments_next_7d",
      type: "alert",
      title: "Semana cheia de compromissos",
      body: `Os próximos 7 dias já têm ${brl(s.upcomingCommitments7d)} comprometidos. Vale checar se o caixa cobre tudo.`,
      cta_label: "Ver planejamento",
      cta_route: "/app/planejamento",
      model: "deterministic",
      evidence: { upcoming_commitments_7d: s.upcomingCommitments7d },
    });
  }

  return out;
}
