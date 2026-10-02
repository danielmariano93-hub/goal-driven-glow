// nino_discovery.v1 — o Nino apresenta o que ele sabe fazer (função pura).
// ======================================================================
// Mensagens de engajamento: "sabia que dá pra…?". Cada dica existe só enquanto
// a pessoa ainda não usa aquela funcionalidade, nunca se repete, sai no máximo
// uma por semana e nunca disputa espaço com um alerta de verdade. Só anuncia
// o que o Nino realmente faz hoje pelo chat/WhatsApp.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { saoPauloHour } from "./weekdayNudge.ts";

export const DISCOVERY_VERSION = "nino_discovery.v1";

export const DISCOVERY_RULES = {
  /** Uma dica a cada 7 dias, em qualquer canal. */
  minDaysBetweenTips: 7,
  /**
   * Horário (São Paulo): à tarde, depois dos lembretes da manhã — a dica nunca
   * ocupa a vaga diária de um aviso de conta, fatura ou ritmo.
   */
  fromHour: 14,
  untilHour: 18,
} as const;

export type UsageProfile = {
  recurring_rules: number;
  goals: number;
  active_cards: number;
  invoice_imports: number;
  splits: number;
  inbound_messages: number;
  questions_asked: number;
};

export type DiscoveryHistory = {
  /** Dicas já enviadas (ids), em qualquer época. */
  sent_tip_ids: string[];
  /** Última dica enviada (ISO), para o intervalo semanal. */
  last_sent_at: string | null;
};

type Tip = {
  id: string;
  applies: (usage: UsageProfile) => boolean;
  title: string;
  body: string;
  route: string;
};

/** Ordem = valor para a pessoa: o que mais evita susto vem primeiro. */
export const DISCOVERY_TIPS: Tip[] = [
  {
    id: "recurring_bills",
    applies: (u) => u.recurring_rules === 0,
    title: "Quer que eu lembre das suas contas fixas?",
    body: "Você sabia que dá pra cadastrar aqui comigo as contas que você paga todo mês? Aluguel, internet, streaming… É só me mandar do seu jeito, tipo “Netflix todo dia 10, R$ 40”, e eu te aviso sempre que o vencimento estiver chegando. Tem alguma conta fixa que eu já posso anotar?",
    route: "/app/compromissos",
  },
  {
    id: "card_invoice_pdf",
    applies: (u) => u.active_cards > 0 && u.invoice_imports === 0,
    title: "Me manda a fatura do cartão",
    body: "Sabia que você pode me mandar o PDF (ou uma foto) da fatura do cartão aqui no WhatsApp? Eu leio, lanço os gastos que faltarem e confiro se o total bate. Na próxima fatura, experimenta me encaminhar!",
    route: "/app/cartoes",
  },
  {
    id: "goal_create",
    applies: (u) => u.goals === 0,
    title: "Vamos criar uma meta?",
    body: "Tem algum objetivo em mente, tipo uma viagem, uma reserva de emergência ou trocar o celular? Me conta, por exemplo “quero juntar R$ 3.000 para viajar até dezembro”, que eu monto a meta e te mostro quanto separar por mês.",
    route: "/app/metas",
  },
  {
    id: "ask_questions",
    applies: (u) => u.questions_asked === 0,
    title: "Pode me perguntar sobre o seu dinheiro",
    body: "Você pode me perguntar qualquer coisa sobre as suas finanças, do seu jeito: “quanto gastei com mercado este mês?”, “quanto ainda posso gastar até o fim do mês?” ou “o que importa agora?”. Quer testar?",
    route: "/app/nino",
  },
  {
    id: "split_expense",
    applies: (u) => u.splits === 0,
    title: "Dividiu uma conta? Eu cuido da cobrança",
    body: "Dividiu um jantar, uma viagem ou o aluguel com alguém? Me diz, tipo “dividi o jantar de R$ 200 com a Ana e o Pedro”, que eu calculo quanto cada um te deve e acompanho quem já pagou.",
    route: "/app/divisao-do-role",
  },
  {
    id: "quick_log",
    applies: (u) => u.inbound_messages < 5,
    title: "Registrar um gasto leva 5 segundos",
    body: "Pra registrar um gasto não precisa abrir o app: é só me mandar aqui do seu jeito, tipo “almoço 35” ou “uber 22 ontem”. Eu categorizo e já conto no seu mês.",
    route: "/app/nino",
  },
  // Dicas "sempre úteis": valem também para quem já usa o básico. Entram por último e
  // só saem uma por semana, então quem domina o Nino continua recebendo novidades.
  {
    id: "what_if",
    applies: () => true,
    title: "Simule antes de decidir",
    body: "Sabia que eu simulo cenários? Pergunte “e se eu cortar metade do lazer?” ou “e se eu guardar R$ 500 por mês?” e eu mostro quanto sobra e o que muda na sua meta, sem mexer em nada seu.",
    route: "/app/nino",
  },
  {
    id: "compare_months",
    applies: () => true,
    title: "Compare meses em uma frase",
    body: "Quer saber se está gastando mais ou menos? Me pergunte “compara setembro com agosto” ou “qual categoria mais cresceu?” e eu mostro o que mudou, categoria por categoria.",
    route: "/app/nino",
  },
  {
    id: "account_balance",
    applies: () => true,
    title: "Saldo por conta, na hora",
    body: "Você pode me perguntar “qual o saldo da conta Itaú?” ou “quanto sobra até o fim do mês?” a qualquer momento, e eu respondo com os seus números de hoje.",
    route: "/app/nino",
  },
  {
    id: "habits_reading",
    applies: () => true,
    title: "Como estão seus hábitos?",
    body: "Pergunte “como estão meus hábitos?” e eu mostro como seu comportamento com o dinheiro evoluiu semana a semana, com base no que você realmente fez. Os detalhes ficam na aba Emocional do app.",
    route: "/app/emocoes",
  },
  {
    id: "spending_goals_plan",
    applies: () => true,
    title: "Metas de gasto sob medida",
    body: "Peça “analise meus gastos e me ajude a criar metas” e eu sugiro limites por categoria e por estabelecimento com base no seu histórico, para você aprovar antes de criar.",
    route: "/app/metas",
  },
];

/** Id da dica a partir da chave de deduplicação da entrega. */
export function tipIdFromKey(key: string | null | undefined): string | null {
  const match = /nino_discovery\.v1:([a-z_]+)/.exec(String(key ?? ""));
  return match ? match[1] : null;
}

export function isDiscoveryHour(now: Date): boolean {
  const hour = saoPauloHour(now);
  return hour >= DISCOVERY_RULES.fromHour && hour < DISCOVERY_RULES.untilHour;
}

/**
 * Próxima dica, ou nenhuma. `competing` são as situações reais da rodada: com
 * alerta urgente, a dica espera — engajamento nunca empurra um alerta.
 */
export function discoverySituation(input: {
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">;
  usage: UsageProfile | null;
  history: DiscoveryHistory;
  competing: FinancialSituation[];
  now: Date;
}): FinancialSituation | null {
  const { ctx, usage, history, competing, now } = input;
  if (!usage) return null;
  if (!isDiscoveryHour(now)) return null;
  // Alerta real (crítico ou com prazo em até 3 dias) tem a vez; o resto a
  // alocação já ordena acima da dica, que é sempre a de menor prioridade.
  if (competing.some((s) => s.severity === "critical" || (s.severity === "attention" && (s.days_until ?? 99) <= 3))) return null;
  if (history.last_sent_at) {
    const elapsed = now.getTime() - Date.parse(history.last_sent_at);
    if (elapsed < DISCOVERY_RULES.minDaysBetweenTips * 86_400_000) return null;
  }
  const sent = new Set(history.sent_tip_ids);
  const tip = DISCOVERY_TIPS.find((candidate) => !sent.has(candidate.id) && candidate.applies(usage));
  if (!tip) return null;
  return {
    // Sem data na identidade: a mesma dica nunca volta.
    fingerprint: `${DISCOVERY_VERSION}:${tip.id}`,
    type: "feature_discovery",
    communication_kind: "feature_discovery",
    severity: "info",
    title: tip.title,
    body: tip.body,
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: 0,
    days_until: null,
    confidence: 0.9,
    actionable: true,
    route: tip.route,
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: DISCOVERY_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      tip_id: tip.id,
      usage,
    },
  };
}
