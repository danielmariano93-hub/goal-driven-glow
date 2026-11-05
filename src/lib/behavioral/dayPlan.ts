import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/engine/facts";
import { measurePlanSpend } from "@/lib/behavioral/dayPlanCreate";

// day_plan.v1 — plano do dia crítico (hoje gravado em `weekend_commitments`, nascido como "combinado de sexta").
// Aqui moram a nota graduada do resultado e a leitura da tabela. A tabela guarda o dia em `friday` por compatibilidade:
// o nome do dia vem da própria data.

export type DayPlanStatus = "offered" | "accepted" | "kept" | "missed" | "info";

export type DayPlanRow = {
  /** Data do plano (campo antigo `friday`). */
  friday: string;
  category: string;
  status: DayPlanStatus;
  target_amount: number | null;
  /** O que a pessoa costuma gastar nesse bloco (o padrão dela). */
  expected_amount: number | null;
  realized_amount: number | null;
  accepted_at: string | null;
};

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

/** Nome do dia da semana de uma data AAAA-MM-DD ("sexta"). */
export function weekdayName(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

export const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export type DayPlanBand = "met" | "partial" | "missed";

export type DayPlanGrade = {
  band: DayPlanBand;
  /** Positivo = gastou menos que o padrão. Null sem padrão para comparar. */
  vs_typical_pct: number | null;
  /** Positivo = passou do teto do plano. */
  over_target: number;
  reading: string;
};

/** Abaixo disso o resultado não conta como "ficou abaixo do seu padrão" (ruído do dia a dia). */
export const TYPICAL_NOISE_MARGIN = 0.1;

/**
 * Resultado graduado: dentro do plano; abaixo do padrão mesmo sem chegar ao teto; ou acima. Antes era só "cumpriu/falhou":
 * o plano de 09/10 (teto R$ 160, padrão R$ 271,62, gasto R$ 169,58) virou "falhou" por R$ 9,58 apesar de 38% abaixo do normal.
 * É descrição, não prova de causa.
 */
export function gradeDayPlan(input: { target: number; expected: number | null; realized: number }): DayPlanGrade {
  const { target, expected, realized } = input;
  const over = Math.max(0, Math.round((realized - target) * 100) / 100);
  const vs = expected != null && expected > 0 ? Math.round(((expected - realized) / expected) * 100) : null;
  const belowTypical = expected != null && expected > 0 && realized <= expected * (1 - TYPICAL_NOISE_MARGIN);
  if (realized <= target) {
    return {
      band: "met", vs_typical_pct: vs, over_target: 0,
      reading: `Ficou dentro do plano: ${formatBRL(realized)}${vs != null && vs > 0 ? `, ${vs}% abaixo do seu padrão` : ""}.`,
    };
  }
  if (belowTypical && vs != null) {
    return {
      band: "partial", vs_typical_pct: vs, over_target: over,
      reading: `Não chegou ao plano (${formatBRL(over)} acima do teto), mas ficou ${vs}% abaixo do seu padrão: ${formatBRL(realized)}.`,
    };
  }
  return {
    band: "missed", vs_typical_pct: vs, over_target: over,
    reading: `Passou do plano em ${formatBRL(over)} e ficou perto do seu padrão: ${formatBRL(realized)}.`,
  };
}

/** Planos já medidos (aceitos e fechados) com valor realizado, do mais recente para o mais antigo. */
export function gradedPlans(rows: DayPlanRow[]): Array<DayPlanRow & { grade: DayPlanGrade }> {
  return rows
    .filter((r) => (r.status === "kept" || r.status === "missed") && r.realized_amount != null && r.target_amount != null)
    .sort((a, b) => b.friday.localeCompare(a.friday))
    .map((r) => ({ ...r, grade: gradeDayPlan({ target: r.target_amount!, expected: r.expected_amount, realized: r.realized_amount! }) }));
}

/** Plano ainda aberto (proposto ou combinado), preferindo o já combinado. */
export function openPlan(rows: DayPlanRow[], today: string, windowDays = 4): DayPlanRow | null {
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - windowDays);
  const from = since.toISOString().slice(0, 10);
  const open = rows.filter((r) => (r.status === "offered" || r.status === "accepted") && r.target_amount != null && r.friday >= from)
    .sort((a, b) => b.friday.localeCompare(a.friday));
  return open.find((r) => r.status === "accepted") ?? open[0] ?? null;
}

/**
 * Plano aceito e já terminado, ainda sem fechamento no servidor (o servidor só fecha o combinado de sexta, na segunda):
 * o app mede pelo gasto real da categoria e mostra o resultado. `client_measured` marca que a medida veio daqui.
 */
export function resolvePlans(
  rows: DayPlanRow[],
  ctx: { today: string; txs: Array<Record<string, unknown>>; categoryIdByName: Record<string, string> },
): Array<DayPlanRow & { client_measured?: boolean }> {
  return rows.map((r) => {
    if (r.status !== "accepted" || r.target_amount == null) return r;
    const categoryId = ctx.categoryIdByName[r.category];
    if (!categoryId) return r;
    const spent = measurePlanSpend(ctx.txs as never, categoryId, r.friday, ctx.today);
    if (spent == null) return r;
    return { ...r, status: spent <= r.target_amount ? "kept" : "missed", realized_amount: spent, client_measured: true };
  });
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

type RpcFn = (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
const rpc = () => supabase.rpc as unknown as RpcFn;

export type CreateDayPlanInput = {
  category: string;
  /** Data de início do plano (o dia escolhido; na sexta, vale o fim de semana). */
  date: string;
  target: number;
  expected: number | null;
  anchorKind: "goal" | "average" | null;
  anchorAmount: number | null;
};

/** Cria o plano já aceito (a pessoa escolheu): mesma função do banco do aceite na tela de hábitos, sem migração. */
export function useCreateDayPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: CreateDayPlanInput) => {
      const { error } = await rpc()("habit_limit_accept", {
        p_category: a.category, p_friday: a.date, p_target: a.target, p_expected: a.expected,
        p_projected_before: null, p_projected_if_met: null, p_anchor_kind: a.anchorKind, p_anchor_amount: a.anchorAmount,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day-plans"] }),
  });
}

/** Cancela o plano (fica registrado como recusado, não some do histórico do banco). */
export function useCancelDayPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { category: string; date: string }) => {
      const { error } = await rpc()("habit_limit_decline", { p_category: a.category, p_friday: a.date });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day-plans"] }),
  });
}

export function useDayPlans(userId: string | undefined) {
  return useQuery<DayPlanRow[]>({
    queryKey: ["day-plans", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      // A tabela nasceu depois da geração dos tipos; leitura direta, só do próprio usuário (RLS).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as unknown as (n: string) => any)("weekend_commitments")
        .select("friday,category,status,target_amount,expected_amount,realized_amount,accepted_at")
        .eq("user_id", userId)
        .in("status", ["offered", "accepted", "kept", "missed"])
        .order("friday", { ascending: false })
        .limit(12);
      if (error) throw error;
      return ((data ?? []) as DayPlanRow[]).map((r) => ({
        ...r, target_amount: num(r.target_amount), expected_amount: num(r.expected_amount), realized_amount: num(r.realized_amount),
      }));
    },
  });
}
