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
  /** Dívida oficial de cartão hoje (card_exposure.v2). */
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

  // ---------- novos detectores (insights_catalog.v1) ----------

  if (s.expenseMonth > 0 && s.incomeMonth > 0 && s.expenseMonth > s.incomeMonth) {
    out.push({
      detector: "financial_risk",
      type: "alert",
      title: "O mês está gastando mais do que entrou",
      body: `Você já consumiu ${brl(s.expenseMonth)} contra ${brl(s.incomeMonth)} de entrada. Escolher um corte agora evita usar o cartão como caixa.`,
      cta_label: "Ver planejamento",
      cta_route: "/app/planejamento",
      model: "deterministic",
      evidence: { expense_month: s.expenseMonth, income_month: s.incomeMonth },
    });
  }

  const commit30 = Number(s.upcomingCommitments30d ?? 0);
  const available = Number(s.availableToday ?? 0);
  if (commit30 > 0 && available > 0 && commit30 > available) {
    out.push({
      detector: "cashflow_forecast",
      type: "alert",
      title: "Projeção de caixa aponta aperto",
      body: `Os próximos 30 dias somam ${brl(commit30)} de compromissos e hoje há ${brl(available)} disponível. Antecipar uma decisão agora custa menos que juros depois.`,
      cta_label: "Ver planejamento",
      cta_route: "/app/planejamento",
      model: "deterministic",
      evidence: { commitments_next_30d: commit30, projected_balance: available - commit30, available_today: available },
    });
  }

  const anomaly = s.amountAnomaly;
  if (anomaly && anomaly.amount > 0 && anomaly.typicalAmount > 0 && anomaly.amount >= anomaly.typicalAmount * 3) {
    out.push({
      detector: "amount_anomaly",
      type: "alert",
      title: "Gasto fora do padrão",
      body: `${anomaly.description || "Um lançamento"} de ${brl(anomaly.amount)} ficou muito acima do seu ticket típico de ${brl(anomaly.typicalAmount)}. Confirma se está certo?`,
      cta_label: "Ver lançamento",
      cta_route: "/app/lancamentos",
      model: "deterministic",
      evidence: { amount: anomaly.amount, typical_amount: anomaly.typicalAmount, occurred_at: anomaly.occurredAt, description: anomaly.description },
    });
  }

  const growth = s.categoryGrowth;
  if (growth && growth.previous > 0 && growth.growthPct >= 30) {
    out.push({
      detector: "category_growth",
      type: "habit",
      title: `${growth.name} subiu neste mês`,
      body: `Você já gastou ${brl(growth.current)} em ${growth.name}, contra ${brl(growth.previous)} no mês anterior. Vale decidir um teto antes do fim do mês.`,
      cta_label: "Definir meta",
      cta_route: "/app/metas",
      model: "deterministic",
      evidence: { category: growth.name, amount: growth.current, previous: growth.previous, growth_pct: growth.growthPct },
    });
  }

  const subs = s.subscriptions;
  if (subs && subs.count > 0 && subs.total > 0) {
    out.push({
      detector: "subscriptions_load",
      type: "opportunity",
      title: "Assinaturas somando todo mês",
      body: `Suas ${subs.count} recorrências somam ${brl(subs.total)} por mês. Cancelar uma que você não usa é economia garantida.`,
      cta_label: "Ver recorrências",
      cta_route: "/app/recorrencias",
      model: "deterministic",
      evidence: { subscriptions_count: subs.count, subscriptions_total: subs.total },
    });
  }

  const merchant = s.recurringMerchant;
  if (merchant && merchant.occurrences >= 4 && merchant.total > 0) {
    out.push({
      detector: "recurring_merchant",
      type: "habit",
      title: `${merchant.name} aparece com frequência`,
      body: `Foram ${merchant.occurrences} compras somando ${brl(merchant.total)}. Se for hábito, virar meta ajuda mais que cortar de vez.`,
      cta_label: "Ver lançamentos",
      cta_route: "/app/lancamentos",
      model: "deterministic",
      evidence: { merchant: merchant.name, occurrences: merchant.occurrences, total: merchant.total },
    });
  }

  const rhythm = s.rhythm;
  if (rhythm && rhythm.dailyTypical > 0 && rhythm.daysLeft > 0 && rhythm.projectedExpense > 0) {
    out.push({
      detector: "spending_rhythm",
      type: "habit",
      title: "Seu ritmo aponta o fechamento do mês",
      body: `No ritmo de ${brl(rhythm.dailyTypical)} por dia e ${rhythm.daysLeft} dias restantes, o mês fecha perto de ${brl(rhythm.projectedExpense)}.`,
      cta_label: "Ver ritmo",
      cta_route: "/app/relatorios",
      model: "deterministic",
      evidence: { daily_typical: rhythm.dailyTypical, days_left: rhythm.daysLeft, projected_expense: rhythm.projectedExpense },
    });
  }

  const uncategorized = Number(s.uncategorizedCount ?? 0);
  if (uncategorized >= 3) {
    out.push({
      detector: "data_quality_uncategorized",
      type: "categorize_transaction",
      title: "Alguns lançamentos ainda sem categoria",
      body: `Tenho ${uncategorized} lançamentos sem categoria. Organizando isso, minhas leituras ficam exatas.`,
      cta_label: "Organizar agora",
      cta_route: "/app/lancamentos",
      model: "deterministic",
      evidence: { uncategorized_count: uncategorized },
    });
  }

  const idleDays = Number(s.daysWithoutEntry ?? 0);
  if (idleDays >= 4) {
    out.push({
      detector: "days_without_entry",
      type: "habit",
      title: "Faz alguns dias sem registro",
      body: `São ${idleDays} dias sem nenhum lançamento. Um registro rápido agora mantém as contas confiáveis.`,
      cta_label: "Registrar gasto",
      cta_route: "/app/lancamentos",
      model: "deterministic",
      evidence: { days_without_entry: idleDays },
    });
  }


  return out;
}
