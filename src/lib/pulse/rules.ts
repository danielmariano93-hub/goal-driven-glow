// Pulso Financeiro — pontuação comportamental determinística (0–100).
// NÃO usa valor absoluto de renda/patrimônio; apenas razões e séries próprias.
// Puro. Testável.

export type PulseBand = "Começando" | "Organizando" | "Evoluindo" | "No controle";

export interface PulseFactor {
  key: string;
  label: string;
  weight: number;
  value: number; // 0..1
  neutralIfMissing?: boolean;
  missing?: boolean;
}

export interface PulseInput {
  today: string; // YYYY-MM-DD
  // constância
  txDaysLast14: number; // dias distintos com tx nos últimos 14
  // categorização
  txLast30: number;
  txLast30WithCategory: number;
  // pendentes de confirmação
  pendingOpen: number;
  pendingStale: number; // abertas > 48h
  // planejamento
  plannedMonth: number;
  actualMonth: number;
  hasPlan: boolean;
  // cartão
  cardOutstanding: number;
  cardTotalLimit: number;
  // pagamentos em dia
  paymentsOnTime90d: number;
  paymentsTotal90d: number;
  // reserva
  totalCash: number;
  avgMonthlyExpense: number;
  // metas
  goalsProgressPct: number[]; // 0..1 array; empty ⇒ neutro
  // dívidas
  outstandingToday: number;
  outstanding30dAgo: number;
  // recorrências
  recurringActive: number;
  recurringWithDefinedAmount: number;
  // emocional
  emotionalDaysLast14: number;
  expensesLast30WithEmotion: number;
  // evolução
  score7dAgo?: number | null;
}

export interface PulseResult {
  score: number;
  band: PulseBand;
  factors: PulseFactor[];
  next_action: { key: string; label: string; hint: string };
  state: "ok" | "insufficient_data";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function band(score: number): PulseBand {
  if (score < 25) return "Começando";
  if (score < 50) return "Organizando";
  if (score < 75) return "Evoluindo";
  return "No controle";
}

const NEUTRAL = 0.5;

const NEXT_ACTION: Record<string, { label: string; hint: string }> = {
  constancia: { label: "Anote um gasto hoje", hint: "Registrar todo dia deixa o Pulso mais preciso." },
  pendentes: { label: "Confirme os lançamentos pendentes", hint: "Assim seu histórico fica exato." },
  planejamento: { label: "Ajuste seu planejamento do mês", hint: "Compare o que você previu com o que gastou." },
  cartao: { label: "Reduza o uso do cartão", hint: "Manter abaixo de 30% do limite ajuda a respirar." },
  emDia: { label: "Registre os pagamentos em dia", hint: "Mostrar seus pagamentos feitos alimenta o Pulso." },
  reserva: { label: "Guarde um pouquinho para a reserva", hint: "Meta saudável: 3 meses de gasto médio." },
  metas: { label: "Aporte na sua meta ativa", hint: "Pequenos passos importam." },
  dividas: { label: "Organize suas dívidas", hint: "Uma dívida cadastrada é uma dívida controlada." },
  recorrencias: { label: "Complete suas recorrências", hint: "Definir valores ajuda a prever o mês." },
  categorizacao: { label: "Categorize seus lançamentos", hint: "Categorias claras revelam padrões." },
  emocional: { label: "Faça o check-in emocional de hoje", hint: "Como você está com o dinheiro?" },
  contextoEmocional: { label: "Marque como você se sentiu em um gasto", hint: "Reconhecer o gatilho já ajuda." },
  evolucao: { label: "Continue registrando", hint: "Seu Pulso melhora com constância." },
};

export function computePulse(i: PulseInput): PulseResult {
  const factors: PulseFactor[] = [];

  const push = (key: string, label: string, weight: number, value: number, missing = false) => {
    factors.push({ key, label, weight, value: clamp01(value), missing });
  };

  push("constancia", "Constância de registro", 12, i.txDaysLast14 / 14);
  push(
    "pendentes",
    "Revisão de pendentes",
    6,
    i.pendingOpen === 0 ? 1 : 1 - i.pendingStale / Math.max(1, i.pendingOpen),
  );
  if (i.hasPlan) {
    push(
      "planejamento",
      "Aderência ao planejamento",
      12,
      1 - Math.min(1, Math.abs(i.actualMonth - i.plannedMonth) / Math.max(1, i.plannedMonth)),
    );
  } else {
    push("planejamento", "Aderência ao planejamento", 12, NEUTRAL, true);
  }
  if (i.cardTotalLimit > 0) {
    push("cartao", "Uso saudável do cartão", 10, 1 - Math.min(1, i.cardOutstanding / i.cardTotalLimit));
  } else {
    push("cartao", "Uso saudável do cartão", 10, NEUTRAL, true);
  }
  if (i.paymentsTotal90d > 0) {
    push("emDia", "Contas em dia", 10, i.paymentsOnTime90d / i.paymentsTotal90d);
  } else {
    push("emDia", "Contas em dia", 10, NEUTRAL, true);
  }
  if (i.avgMonthlyExpense > 0) {
    push("reserva", "Reserva de emergência", 10, i.totalCash / (i.avgMonthlyExpense * 3));
  } else {
    push("reserva", "Reserva de emergência", 10, NEUTRAL, true);
  }
  if (i.goalsProgressPct.length > 0) {
    const avg = i.goalsProgressPct.reduce((a, b) => a + b, 0) / i.goalsProgressPct.length;
    push("metas", "Progresso de metas", 8, avg);
  } else {
    push("metas", "Progresso de metas", 8, NEUTRAL, true);
  }
  if (i.outstanding30dAgo > 0) {
    push("dividas", "Redução de dívidas", 6, Math.max(0, 1 - i.outstandingToday / i.outstanding30dAgo));
  } else {
    push("dividas", "Redução de dívidas", 6, NEUTRAL, true);
  }
  if (i.recurringActive > 0) {
    push("recorrencias", "Previsibilidade", 6, i.recurringWithDefinedAmount / i.recurringActive);
  } else {
    push("recorrencias", "Previsibilidade", 6, NEUTRAL, true);
  }
  push(
    "categorizacao",
    "Categorização",
    6,
    i.txLast30 > 0 ? i.txLast30WithCategory / i.txLast30 : NEUTRAL,
    i.txLast30 === 0,
  );
  push("emocional", "Consistência emocional", 6, i.emotionalDaysLast14 / 14);
  push(
    "contextoEmocional",
    "Contexto emocional em gastos",
    4,
    i.txLast30 > 0 ? i.expensesLast30WithEmotion / i.txLast30 : NEUTRAL,
    i.txLast30 === 0,
  );

  // Estado de dados insuficientes: pouca atividade
  const insufficient = i.txLast30 < 5 && i.txDaysLast14 < 3;

  let score: number;
  if (insufficient) {
    score = 40;
  } else {
    const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
    const raw = factors.reduce((a, f) => a + f.weight * f.value, 0);
    score = Math.round((raw / totalWeight) * 100);
    if (typeof i.score7dAgo === "number" && score > i.score7dAgo) {
      score = Math.min(100, score + 1); // bônus leve por evolução
    }
    score = Math.max(0, Math.min(100, score));
  }

  // Próxima ação: fator com maior weight * (1 - value), ignorando missing
  const candidates = factors.filter((f) => !f.missing);
  const worst = candidates.length
    ? candidates.reduce((best, f) => (f.weight * (1 - f.value) > best.weight * (1 - best.value) ? f : best))
    : factors[0];
  const na = NEXT_ACTION[worst.key] ?? NEXT_ACTION.constancia;

  return {
    score,
    band: band(score),
    factors,
    next_action: { key: worst.key, label: na.label, hint: na.hint },
    state: insufficient ? "insufficient_data" : "ok",
  };
}

export function bandColor(b: PulseBand): string {
  switch (b) {
    case "Começando":
      return "hsl(24, 90%, 55%)";
    case "Organizando":
      return "hsl(38, 92%, 50%)";
    case "Evoluindo":
      return "hsl(158, 64%, 42%)";
    case "No controle":
      return "hsl(160, 84%, 39%)";
  }
}
