// Client-side mirror of supabase/functions/_shared/insights/fallbacks.ts.
// Keep in sync. Pure module.
import { z } from "zod";

export const INSIGHT_TYPES = ["habit", "alert", "celebration", "onboarding", "opportunity", "categorize_transaction"] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export interface InsightPayload {
  type: InsightType;
  title: string;
  body: string;
  cta_label: string;
  cta_route: string;
  model: string;
}

export interface InsightFacts {
  total_tx_ever: number;
  month: string;
  income_month: number;
  expense_month: number;
  balance_month: number;
  active_goals: number;
  goal_names: string[];
  has_credit_card?: boolean;
  upcoming_recurring_7d?: number;
  top_expense_category?: string | null;
  uncategorized_tx?: { id: string; description: string | null; amount: number; occurred_at: string } | null;
}

const nonEmptyString = (min: number, max: number) =>
  z
    .string()
    .transform((s) => (typeof s === "string" ? s.trim() : ""))
    .refine((s) => s.length >= min && s.length <= max, `length ${min}-${max}`)
    .refine(
      (s) => !["null", "undefined", "n/a", "-", "—"].includes(s.toLowerCase()),
      "meaningless string",
    )
    .refine((s) => /[a-zA-ZÀ-ÿ0-9]/.test(s), "must contain letters or digits");

// CTA route: aceita /app/... com opcional query string.
export const CTA_ROUTE_RX = /^\/app\/[a-z0-9\-/]+(?:\?[a-z0-9=&_\-]+)?$/i;

export const InsightSchema = z.object({
  type: z.enum(INSIGHT_TYPES).optional(),
  title: nonEmptyString(4, 80),
  body: nonEmptyString(10, 240),
  cta_label: nonEmptyString(2, 40).optional(),
  cta_route: z.string().regex(CTA_ROUTE_RX).optional(),
});

export function parseInsightResponse(raw: unknown): z.infer<typeof InsightSchema> | null {
  const r = InsightSchema.safeParse(raw);
  return r.success ? r.data : null;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function keyOf(p: InsightPayload): string {
  return `${p.type}:${p.title}`;
}

/**
 * Devolve a lista completa de candidatos elegíveis em ordem de prioridade.
 * `pickFallback` escolhe o primeiro; se `skipKey` bater com o topo e houver
 * outro candidato, pula para o próximo (anti-repetição da mesma dica).
 */
function candidates(f: InsightFacts): InsightPayload[] {
  const list: InsightPayload[] = [];
  const total = f.total_tx_ever ?? 0;

  if (f.uncategorized_tx) {
    const t = f.uncategorized_tx;
    const label = t.description ? `“${t.description}” · ${brl(t.amount)}` : `${brl(t.amount)} em ${t.occurred_at}`;
    list.push({
      type: "categorize_transaction",
      title: "Categorize este lançamento",
      body: `Faltou categoria em ${label}. Escolher agora deixa seu relatório mais claro.`,
      cta_label: "Categorizar",
      cta_route: `/app/lancamentos/${t.id}?edit=1&focus=category`,
      model: "fallback",
    });
  }

  if (total === 0) {
    list.push({
      type: "onboarding",
      title: "Bora começar juntos",
      body: "Registre seu primeiro gasto ou entrada. Com um clique já dá pra te ajudar de verdade.",
      cta_label: "Anotar agora",
      cta_route: "/app/lancamentos",
      model: "fallback",
    });
  }

  if (total > 0 && total < 5) {
    list.push({
      type: "habit",
      title: "Três dias mudam tudo",
      body: "Anotar seus gastos por 3 dias seguidos muda como você enxerga o próprio dinheiro. Bora?",
      cta_label: "Anotar gasto",
      cta_route: "/app/lancamentos",
      model: "fallback",
    });
  }

  if (f.expense_month > f.income_month && f.income_month > 0) {
    const gap = f.expense_month - f.income_month;
    list.push({
      type: "alert",
      title: "Este mês tá apertado",
      body: `Você gastou ${brl(gap)} a mais do que entrou. Dá pra virar isso ainda — vamos ver onde ajustar?`,
      cta_label: "Ver relatório",
      cta_route: "/app/relatorios",
      model: "fallback",
    });
  }

  if (f.income_month > 0 && f.balance_month > 0) {
    const goalName = f.goal_names?.[0];
    if (goalName) {
      list.push({
        type: "celebration",
        title: `Sobrou ${brl(f.balance_month)} este mês`,
        body: `Que tal jogar uma parte pra ${goalName}? Cada pouquinho te aproxima do que importa.`,
        cta_label: "Ir pra meta",
        cta_route: "/app/metas",
        model: "fallback",
      });
    } else {
      list.push({
        type: "celebration",
        title: `Você fechou ${brl(f.balance_month)} no positivo`,
        body: "Que tal criar uma meta pra esse dinheiro trabalhar por você em vez de sumir sem rumo?",
        cta_label: "Criar meta",
        cta_route: "/app/metas",
        model: "fallback",
      });
    }
  }

  if ((f.active_goals ?? 0) > 0 && f.goal_names?.[0]) {
    list.push({
      type: "opportunity",
      title: `Um passo pra ${f.goal_names[0]}`,
      body: "Um pequeno aporte hoje já conta. Sem pressão — o hábito é o que faz a meta acontecer.",
      cta_label: "Guardar dinheiro",
      cta_route: "/app/metas",
      model: "fallback",
    });
  }

  if ((f.upcoming_recurring_7d ?? 0) > 0) {
    list.push({
      type: "alert",
      title: "Vem conta chegando",
      body: "Você tem contas recorrentes nos próximos 7 dias. Uma olhada agora evita susto depois.",
      cta_label: "Ver recorrências",
      cta_route: "/app/recorrencias",
      model: "fallback",
    });
  }

  if (f.has_credit_card) {
    list.push({
      type: "habit",
      title: "Fatura sob olho",
      body: "Acompanhar o cartão semanalmente evita surpresa no fechamento. Dá uma passada rápida?",
      cta_label: "Ver cartões",
      cta_route: "/app/cartoes",
      model: "fallback",
    });
  }

  if (f.top_expense_category) {
    list.push({
      type: "opportunity",
      title: `${f.top_expense_category} lidera seus gastos`,
      body: `A categoria que mais pesou no mês foi ${f.top_expense_category}. Vale uma olhada rápida pra ver se dá pra ajustar algo.`,
      cta_label: "Ver relatório",
      cta_route: "/app/relatorios",
      model: "fallback",
    });
  }

  // Mensagem positiva/engajamento — sempre disponível como último recurso.
  list.push({
    type: "habit",
    title: "Um lançamento por dia",
    body: "Anotar todo dia o que entrou e saiu é o combinado que muda o resto. Bora manter o ritmo.",
    cta_label: "Anotar gasto",
    cta_route: "/app/lancamentos",
    model: "fallback",
  });

  return list;
}

export function pickFallback(f: InsightFacts, opts?: { skipKey?: string }): InsightPayload {
  const list = candidates(f);
  if (list.length === 0) {
    return {
      type: "habit",
      title: "Um lançamento por dia",
      body: "Anotar todo dia o que entrou e saiu é o combinado que muda o resto. Bora manter o ritmo.",
      cta_label: "Anotar gasto",
      cta_route: "/app/lancamentos",
      model: "fallback",
    };
  }
  const skip = opts?.skipKey;
  if (skip && list.length > 1 && keyOf(list[0]) === skip) {
    return list[1];
  }
  return list[0];
}
