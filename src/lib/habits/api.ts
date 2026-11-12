// Camada de dados de Hábitos (M1): leitura por `hb_snapshot()` e escritas por RPC (nunca insert direto).
// As tabelas hb_* ainda não estão no types.ts gerado; por isso o acesso é tipado aqui, à mão.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  formOf, type HabitForm,
  automaticityDue, automaticitySummary, isMaintenance, mergeAutoLogs, quitStats, summarizeHabit, FIRM_FROM,
  type AutoCheckin, type AutomaticitySummary, type CravingRow, type CycleRow, type HabitDef, type HabitKind, type HabitSummary, type LogRow, type LogStatus,
  type PauseRange, type QuitStats, type SlipRow,
} from "@/lib/habits/engine";

export type HbMode = "money" | "habits";
export type HbArea = "body" | "mind" | "routine" | "money" | "other";

export interface HbHabitRow {
  id: string;
  template_id: string | null;
  kind: HabitKind;
  title: string;
  area: HbArea;
  sensitivity: "normal" | "health" | "substance";
  cue_kind: "after_event" | "at_time" | "at_place" | "free" | null;
  cue_text: string | null;
  cue_time: string | null;
  minimum_text: string | null;
  days_of_week: number[] | null;
  weekly_target: number | null;
  quantity_target: number | null;
  quantity_unit: string | null;
  quantity_period: "day" | "week" | null;
  rest_per_week: number;
  craving_plan?: string | null;
  form?: string | null;
  direction?: "at_least" | "at_most" | "track" | null;
  implicit_ok?: boolean;
  interval_days?: number | null;
  meta?: Record<string, unknown> | null;
  status: "active" | "paused" | "archived";
  started_on: string;
  created_at: string;
}

export interface HbSnapshot {
  today: string;
  mode: HbMode;
  /** Preferências (vêm da migração do F2; ausentes = padrão ligado). */
  whatsapp_logging?: boolean;
  nudges_enabled?: boolean;
  max_nudges_per_day?: number;
  /** Autorização para hábitos de saúde e substâncias (migração 3; ausente = não). */
  consent_sensitive?: boolean;
  habits: HbHabitRow[];
  logs: LogRow[];
  pauses?: Array<{ habit_id: string; from: string; to: string | null }>;
  cycles?: CycleRow[];
  cravings?: Array<CravingRow & { id: string; occurred_at: string }>;
  slips?: SlipRow[];
  automaticity?: AutoCheckin[];
  /** Hábitos medidos pelo Nino (F5). */
  auto_rules?: Array<{ habit_id: string; rule_type: "no_spend_category" | "spend_under_limit"; category_id: string; limit_amount: number | null }>;
  auto_logs?: LogRow[];
  projects?: HbProject[];
  steps?: HbStep[];
  step_logs?: Array<{ habit_id: string; step_id: string; local_date: string }>;
}

export interface HbProject { id: string; habit_id: string; title: string; total: number; current: number; unit: string | null; started_on: string; finished_on: string | null }
export interface HbStep { id: string; habit_id: string; position: number; title: string }

export interface HbTemplate {
  id: string;
  slug: string;
  title: string;
  area: HbArea;
  kind: HabitKind;
  cue_suggestion: string | null;
  minimum_suggestion: string | null;
  why_it_works: string | null;
  weekly_target: number | null;
  quantity_target: number | null;
  quantity_unit: string | null;
  quantity_period: "day" | "week" | null;
  sensitivity?: "normal" | "health" | "substance";
  craving_suggestion?: string | null;
  sort_order: number;
}

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type RpcFn = (name: string, args?: Record<string, unknown>) => Promise<RpcResult>;

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as RpcFn)(name, args);
  if (error) throw new HbError(error.message || name, error.code);
  return data as T;
}

export class HbError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const ERROR_TEXT: Array<[string, string]> = [
  ["habit_limit_reached", "Você já tem 10 hábitos ativos. Arquive ou pause um para criar outro."],
  ["goal_limit_reached", "Você já tem 3 objetivos. Arquive um para criar outro."],
  ["measure_limit_reached", "Este objetivo já tem 6 medidas."],
  ["rest_budget_exhausted", "As folgas desta semana acabaram para este hábito."],
  ["edit_window_closed", "Só dá para corrigir os últimos 7 dias."],
  ["future_date", "Esse dia ainda não chegou."],
  ["before_start", "Esse dia é anterior ao início do hábito."],
  ["quantity_not_supported", "Este hábito não usa quantidade."],
  ["project_already_complete", "Este projeto já foi concluído."],
  ["open_project_exists", "Conclua ou ajuste o projeto atual antes de começar outro."],
  ["interval_required", "Informe de quantos em quantos dias."],
  ["steps_required", "Adicione de 1 a 12 passos."],
  ["invalid_amount", "Informe um valor válido."],
  ["consent_required", "Esse tipo de hábito precisa da sua autorização antes."],
  ["quit_cannot_pause", "Largar um hábito não pausa: se precisar, use “Só anotar” ou recomece a contagem."],
  ["not_a_quit_habit", "Isso só vale para hábitos de largar."],
  ["no_open_cycle", "Não encontrei a contagem em andamento."],
  ["quit_has_no_automaticity", "Hábitos de largar não têm esse check-in."],
  ["not_enabled", "Hábitos ainda não está liberado para a sua conta."],
  ["habit_not_active", "Este hábito está arquivado."],
];

export function hbErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const hit = ERROR_TEXT.find(([k]) => msg.includes(k));
  return hit ? hit[1] : "Não consegui salvar agora. Tente de novo em instantes.";
}

export const habitToDef = (h: HbHabitRow): HabitDef => ({
  id: h.id,
  kind: h.kind,
  started_on: h.started_on,
  days_of_week: h.days_of_week,
  weekly_target: h.weekly_target,
  quantity_target: h.quantity_target,
  quantity_period: h.quantity_period,
  rest_per_week: h.rest_per_week,
  form: h.form ?? null,
  direction: h.direction ?? null,
  implicit_ok: h.implicit_ok ?? false,
  interval_days: h.interval_days ?? null,
});

const keys = {
  enabled: (uid?: string) => ["hb", "enabled", uid] as const,
  snapshot: (uid?: string) => ["hb", "snapshot", uid] as const,
  templates: ["hb", "templates"] as const,
  rhythm: (uid?: string, habitId?: string) => ["hb", "rhythm", uid, habitId] as const,
  goals: (uid?: string) => ["hb", "goals", uid] as const,
  logTimes: (uid?: string) => ["hb", "logTimes", uid] as const,
};

/** Liberação por usuário (`hb_access`). Falha fechada: qualquer erro = sem Hábitos. */
export function useHabitsEnabled() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.enabled(user?.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      try {
        return (await rpc<boolean>("hb_enabled")) === true;
      } catch {
        return false;
      }
    },
  });
}

export function useHabitsSnapshot() {
  const { user } = useAuth();
  const enabled = useHabitsEnabled();
  return useQuery({
    queryKey: keys.snapshot(user?.id),
    enabled: !!user && enabled.data === true,
    staleTime: 30_000,
    queryFn: () => rpc<HbSnapshot>("hb_snapshot", { p_days: 400 }),
  });
}

export function useHbTemplates() {
  const { user } = useAuth();
  const enabled = useHabitsEnabled();
  return useQuery({
    queryKey: keys.templates,
    enabled: !!user && enabled.data === true,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const from = (supabase as unknown as { from: (t: string) => { select: (c: string) => { order: (c: string) => Promise<{ data: HbTemplate[] | null; error: { message: string } | null }> } } }).from("hb_templates");
      const { data, error } = await from.select("id,slug,title,area,kind,cue_suggestion,minimum_suggestion,why_it_works,weekly_target,quantity_target,quantity_unit,quantity_period,sensitivity,craving_suggestion,sort_order").order("sort_order");
      if (error) throw new HbError(error.message);
      return data ?? [];
    },
  });
}

export interface HabitView {
  habit: HbHabitRow;
  def: HabitDef;
  summary: HabitSummary;
  pauses: PauseRange[];
  /** Automaticidade (só hábitos de fazer). */
  auto: AutomaticitySummary;
  /** Já está na hora de perguntar o quanto está automático? */
  auto_due: boolean;
  form: HabitForm;
  /** Projeto aberto (livro, curso, reserva) e os já concluídos. */
  project: HbProject | null;
  projects_done: HbProject[];
  steps: HbStep[];
  /** Passos marcados hoje. */
  steps_today: string[];
}

export interface QuitView {
  habit: HbHabitRow;
  stats: QuitStats;
  cycle: CycleRow | null;
}

const NO_PAUSES: PauseRange[] = [];

/** Hábitos de fazer ativos com o resumo do motor (habits-core), mais os de largar e os pausados. */
export function useHabitViews() {
  const snap = useHabitsSnapshot();
  const data = snap.data;
  const model = useMemo(() => {
    if (!data) return { views: [] as HabitView[], paused: [] as HabitView[], quitViews: [] as QuitView[], activeCount: 0, logs: [] as LogRow[] };
    const pausesOf = (id: string): PauseRange[] => {
      const list = (data.pauses ?? []).filter((p) => p.habit_id === id).map((p) => ({ from: p.from, to: p.to }));
      return list.length ? list : NO_PAUSES;
    };
    const checkins = data.automaticity ?? [];
    const logs = mergeAutoLogs(data.logs, data.auto_logs ?? []);
    const build = (habit: HbHabitRow): HabitView => {
      const def = habitToDef(habit);
      const pauses = pausesOf(habit.id);
      const summary = summarizeHabit(def, logs, data.today, pauses);
      const auto = automaticitySummary(habit.id, checkins);
      const maintenance = isMaintenance(auto, summary.strength, FIRM_FROM);
      const projects = (data.projects ?? []).filter((x) => x.habit_id === habit.id);
      return {
        habit, def, pauses, auto,
        form: formOf(habit),
        project: projects.find((x) => x.finished_on == null) ?? null,
        projects_done: projects.filter((x) => x.finished_on != null),
        steps: (data.steps ?? []).filter((x) => x.habit_id === habit.id).sort((a, b) => a.position - b.position),
        steps_today: (data.step_logs ?? []).filter((x) => x.habit_id === habit.id && x.local_date === data.today).map((x) => x.step_id),
        summary: maintenance ? { ...summary, phase: "maintenance" } : summary,
        auto_due: habit.status === "active" && automaticityDue(habit, checkins, data.today),
      };
    };
    const doing = data.habits.filter((h) => h.kind !== "quit");
    const quits = data.habits.filter((h) => h.kind === "quit" && h.status === "active");
    return {
      views: doing.filter((h) => h.status === "active").map(build),
      paused: doing.filter((h) => h.status === "paused").map(build),
      quitViews: quits.map((habit) => {
        const cycles = data.cycles ?? [];
        return { habit, cycle: cycles.find((c) => c.habit_id === habit.id && c.ended_on == null) ?? null, stats: quitStats(habit.id, cycles, data.cravings ?? [], data.slips ?? [], data.today) };
      }),
      activeCount: data.habits.filter((h) => h.status === "active").length,
      logs,
    };
  }, [data]);
  return { ...snap, ...model, today: data?.today ?? null, rules: data?.auto_rules ?? [], consent: data?.consent_sensitive === true };
}

// ---------------------------------------------------------------- escritas

function patchSnapshot(qc: ReturnType<typeof useQueryClient>, uid: string | undefined, fn: (s: HbSnapshot) => HbSnapshot) {
  qc.setQueryData<HbSnapshot>(keys.snapshot(uid), (old) => (old ? fn(old) : old));
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export interface LogInput {
  /** "backfill" registra um dia anterior (até 90 dias) e recua o início do hábito. */
  source?: "app" | "backfill";
  habit_id: string;
  date: string;
  status: LogStatus;
  quantity?: number | null;
}

/** Registra o dia. Otimista: a tela muda na hora e volta atrás se o servidor recusar. */
export function useLogHabit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (i: LogInput) =>
      rpc<string>("hb_log", {
        p_habit: i.habit_id, p_date: i.date, p_status: i.status, p_quantity: i.quantity ?? null, p_note: null, p_source: i.source ?? "app", p_idem: newKey(),
      }),
    onMutate: async (i) => {
      await qc.cancelQueries({ queryKey: keys.snapshot(user?.id) });
      const prev = qc.getQueryData<HbSnapshot>(keys.snapshot(user?.id));
      patchSnapshot(qc, user?.id, (s) => ({
        ...s,
        logs: [
          ...s.logs.filter((l) => !(l.habit_id === i.habit_id && l.local_date === i.date)),
          { habit_id: i.habit_id, local_date: i.date, status: i.status, quantity: i.quantity ?? null },
        ],
      }));
      return { prev };
    },
    onError: (_e, _i, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.snapshot(user?.id), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) });
      void qc.invalidateQueries({ queryKey: ["hb", "rhythm"] });
    void qc.invalidateQueries({ queryKey: ["hb", "logTimes"] });
    },
  });
}

export function useUnlogHabit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (i: { habit_id: string; date: string }) => rpc<null>("hb_unlog", { p_habit: i.habit_id, p_date: i.date }),
    onMutate: async (i) => {
      await qc.cancelQueries({ queryKey: keys.snapshot(user?.id) });
      const prev = qc.getQueryData<HbSnapshot>(keys.snapshot(user?.id));
      patchSnapshot(qc, user?.id, (s) => ({ ...s, logs: s.logs.filter((l) => !(l.habit_id === i.habit_id && l.local_date === i.date)) }));
      return { prev };
    },
    onError: (_e, _i, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.snapshot(user?.id), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) });
      void qc.invalidateQueries({ queryKey: ["hb", "rhythm"] });
    void qc.invalidateQueries({ queryKey: ["hb", "logTimes"] });
    },
  });
}

export interface CreateHabitInput {
  kind: HabitKind;
  form?: HabitForm;
  direction?: "at_least" | "at_most" | "track";
  implicit_ok?: boolean;
  interval_days?: number;
  meta?: Record<string, unknown>;
  steps?: string[];
  project?: { title: string; total: number; current?: number; unit?: string | null };
  sensitivity?: "normal" | "health" | "substance";
  craving_plan?: string | null;
  /** Largar: categoria de despesa usada para estimar o gasto médio (Nino calcula). */
  money_category_id?: string | null;
  money_label?: string | null;
  /** Largar: gasto diário informado pela pessoa (usado quando não há dados suficientes). */
  daily_cost?: number | null;
  title: string;
  area: HbArea;
  template_id?: string | null;
  cue_kind?: HbHabitRow["cue_kind"];
  cue_text?: string | null;
  minimum_text?: string | null;
  days_of_week?: number[] | null;
  weekly_target?: number | null;
  quantity_target?: number | null;
  quantity_unit?: string | null;
  quantity_period?: "day" | "week" | null;
  rest_per_week?: number;
  start_today?: boolean;
}

export function useCreateHabit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (i: CreateHabitInput) => rpc<string>("hb_create_habit", { p: i }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) }),
  });
}

export function useUpdateHabit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (i: { id: string; patch: Partial<Pick<HbHabitRow, "title" | "cue_text" | "cue_kind" | "minimum_text" | "rest_per_week" | "weekly_target" | "quantity_target" | "quantity_unit" | "interval_days" | "days_of_week" | "started_on" | "craving_plan">> }) =>
      rpc<null>("hb_update_habit", { p_id: i.id, p: i.patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) }),
  });
}

export function useArchiveHabit() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (id: string) => rpc<null>("hb_set_status", { p_id: id, p_status: "archived" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) }),
  });
}

/** Lembra o último lado usado (Dinheiro ou Hábitos). Falha em silêncio: é só conveniência. */
export function useSetHbMode() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (mode: HbMode) => rpc<null>("hb_set_mode", { p_mode: mode }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) }),
  });
}

export interface HbPrefs {
  whatsapp_logging: boolean;
  nudges_enabled: boolean;
  max_nudges_per_day: number;
}

/** Preferências de lembrete e de marcar pelo WhatsApp (padrão: ligado, até 2 lembretes por dia). */
export function useHbPrefs(): { prefs: HbPrefs; isLoading: boolean } {
  const snap = useHabitsSnapshot();
  const d = snap.data;
  return {
    isLoading: snap.isLoading,
    prefs: { whatsapp_logging: d?.whatsapp_logging ?? true, nudges_enabled: d?.nudges_enabled ?? true, max_nudges_per_day: d?.max_nudges_per_day ?? 2 },
  };
}

export function useSetHbPrefs() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (patch: Partial<HbPrefs>) => rpc<null>("hb_set_prefs", { p: patch }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.snapshot(user?.id) });
      const prev = qc.getQueryData<HbSnapshot>(keys.snapshot(user?.id));
      patchSnapshot(qc, user?.id, (s) => ({ ...s, ...patch }));
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.snapshot(user?.id), ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) }),
  });
}

// ---------------------------------------------------------------- M3: largar, automaticidade, pausa, consentimento

function useInvalidate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.snapshot(user?.id) });
    void qc.invalidateQueries({ queryKey: ["hb", "rhythm"] });
    void qc.invalidateQueries({ queryKey: ["hb", "logTimes"] });
  };
}

export function useGrantConsent() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: () => rpc<null>("hb_grant_consent"), onSuccess: inv });
}
export function useRevokeConsent() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: () => rpc<null>("hb_revoke_consent"), onSuccess: inv });
}

/** Pausa ou retoma um hábito de fazer (os dias pausados não contam como falha). */
export function useSetHabitStatus() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (i: { id: string; status: "active" | "paused" }) => rpc<null>("hb_set_status", { p_id: i.id, p_status: i.status }), onSuccess: inv });
}

export function useCraving() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (i: { habit_id: string; tags?: string[] }) => rpc<string>("hb_craving", { p_habit: i.habit_id, p_tags: i.tags ?? [] }), onSuccess: inv });
}
export function useCravingAnswer() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (i: { craving_id: string; handled: boolean }) => rpc<null>("hb_craving_answer", { p_craving: i.craving_id, p_handled: i.handled }), onSuccess: inv });
}

export interface RelapseInput { habit_id: string; reset: boolean; tags?: string[]; date?: string | null }
export function useRelapse() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: RelapseInput) => rpc<{ reset: boolean; started_on: string }>("hb_relapse", { p_habit: i.habit_id, p_reset: i.reset, p_tags: i.tags ?? [], p_date: i.date ?? null }),
    onSuccess: inv,
  });
}

export function useAnswerAutomaticity() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: { habit_id: string; score?: number | null; skipped?: boolean }) =>
      rpc<null>("hb_answer_automaticity", { p_habit: i.habit_id, p_score: i.skipped ? null : i.score ?? null, p_skipped: i.skipped === true }),
    onSuccess: inv,
  });
}

export interface QuitMoney { estimate: number | null; reason?: string; days: number; baseline_daily_cost?: number; spent?: number | null; source?: "nino_data" | "user_informed" }

/** Estimativa do que deixou de ser gasto, por hábito. Sempre exibida como "estimativa". */
export function useQuitMoney(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["hb", "quit-money", user?.id],
    enabled: !!user && enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: () => rpc<Record<string, QuitMoney>>("hb_quit_money"),
  });
}

export interface CategoryOption { id: string; name: string }
export function useExpenseCategories(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["hb", "categories", user?.id],
    enabled: !!user && enabled,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const q = (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { is: (c: string, v: null) => { order: (c: string) => Promise<{ data: CategoryOption[] | null; error: { message: string } | null }> } } } } }).from("categories");
      const { data, error } = await q.select("id,name").eq("type", "expense").is("archived_at", null).order("name");
      if (error) throw new HbError(error.message);
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------- M4: dinheiro (F5) e IA (F6)

export interface SetRuleInput { habit_id: string; rule_type: "no_spend_category" | "spend_under_limit"; category_id: string; limit_amount?: number | null }
export function useSetAutoRule() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: SetRuleInput) => rpc<null>("hb_set_auto_rule", { p_habit: i.habit_id, p_type: i.rule_type, p_category: i.category_id, p_limit: i.limit_amount ?? null }),
    onSuccess: inv,
  });
}
export function useClearAutoRule() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (habit_id: string) => rpc<null>("hb_clear_auto_rule", { p_habit: habit_id }), onSuccess: inv });
}

/** Concordância da regra com o que a pessoa marcou (dias em que há as duas). */
export function useRuleAgreement(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["hb", "rule-agreement", user?.id],
    enabled: !!user && enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: () => rpc<Record<string, { days: number; agree: number }>>("hb_rule_agreement"),
  });
}

export function useWeeklyCategorySpend(categoryId: string | null, weeks = 12) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["hb", "weekly-spend", user?.id, categoryId, weeks],
    enabled: !!user && !!categoryId,
    staleTime: 10 * 60_000,
    retry: 0,
    queryFn: () => rpc<Array<{ week_start: string; spent: number }>>("hb_weekly_category_spend", { p_category: categoryId, p_weeks: weeks }),
  });
}

export interface AiPlan { cue_text: string | null; minimum_text: string | null }
type FnResult = { data: unknown; error: { message: string } | null };

async function callHabitsAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.functions.invoke as unknown as (n: string, o: { body: unknown }) => Promise<FnResult>)("habits-ai", { body });
  if (error) throw new HbError(error.message);
  return data as T;
}

/** Sugestão de gatilho e versão mínima. Pode voltar vazia (hábito sensível, teto mensal ou IA fora do ar). */
export function useSuggestPlan() {
  return useMutation({ mutationFn: (title: string) => callHabitsAi<{ ok: boolean; source: string; plan: AiPlan }>({ action: "suggest_plan", title }) });
}
export function useNarrateWeek() {
  return useMutation({ mutationFn: () => callHabitsAi<{ ok: boolean; source: "ai" | "template" | "none"; text: string }>({ action: "narrate_week" }) });
}

// ---------------------------------------------------------------- M5: formas de medir

export function useProjectAdd() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: { habit_id: string; amount: number; date?: string | null }) =>
      rpc<{ current: number; total: number; finished: boolean; added: number }>("hb_project_add", { p_habit: i.habit_id, p_amount: i.amount, p_date: i.date ?? null }),
    onSuccess: inv,
  });
}
export function useProjectStart() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: { habit_id: string; title: string; total: number; unit?: string | null }) =>
      rpc<string>("hb_project_start", { p_habit: i.habit_id, p_title: i.title, p_total: i.total, p_unit: i.unit ?? null }),
    onSuccess: inv,
  });
}
export function useProjectUpdate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: { id: string; title?: string; total?: number; current?: number }) =>
      rpc<null>("hb_project_update", { p_project: i.id, p_title: i.title ?? null, p_total: i.total ?? null, p_current: i.current ?? null }),
    onSuccess: inv,
  });
}
export function useStepToggle() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (i: { habit_id: string; step_id: string; date: string; done: boolean }) =>
      rpc<{ done: number; total: number }>("hb_step_toggle", { p_habit: i.habit_id, p_step: i.step_id, p_date: i.date, p_done: i.done }),
    onSuccess: inv,
  });
}

/** Inclusões com hora e vontades por hora de um hábito (função hb_rhythm_data). Falha sem ruído: o gráfico só não aparece. */
export interface RhythmData {
  timezone: string;
  entries: Array<{ local_date: string; amount: number; at: string | null }>;
  cravings: Array<{ occurred_at: string; handled: boolean | null }>;
}
export function useRhythmData(habitId: string | undefined, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.rhythm(user?.id, habitId),
    enabled: !!user && !!habitId && enabled,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => rpc<RhythmData>("hb_rhythm_data", { p_habit: habitId, p_days: 30 }),
  });
}

// ---------------------------------------------------------------- objetivos e medidas

export interface GoalMeasure {
  id: string;
  kind: "weight" | "waist" | "arm" | "thigh" | "custom";
  label: string;
  unit: string;
  cadence: "weekly" | "monthly";
  points: Array<{ id: string; date: string; value: number }>;
}
export interface GoalData {
  id: string;
  title: string;
  started_on: string;
  habit_ids: string[];
  measures: GoalMeasure[];
}
export interface GoalsPayload {
  today: string;
  goals: GoalData[];
}

/** Objetivos (hipertrofia, perder peso...) com as medidas e os hábitos ligados a eles. */
export function useGoals() {
  const { user } = useAuth();
  const enabled = useHabitsEnabled();
  return useQuery({
    queryKey: keys.goals(user?.id),
    enabled: !!user && enabled.data === true,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => rpc<GoalsPayload>("hb_goals_data"),
  });
}

function useGoalInvalidate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => void qc.invalidateQueries({ queryKey: keys.goals(user?.id) });
}

export interface CreateGoalInput {
  title: string;
  habits: string[];
  measures: Array<{ kind: GoalMeasure["kind"]; label: string; unit: string; cadence: GoalMeasure["cadence"] }>;
}
export function useCreateGoal() {
  const inv = useGoalInvalidate();
  return useMutation({ mutationFn: (i: CreateGoalInput) => rpc<string>("hb_goal_create", { p_title: i.title, p_habits: i.habits, p_measures: i.measures }), onSuccess: inv });
}
export function useUpdateGoal() {
  const inv = useGoalInvalidate();
  return useMutation({ mutationFn: (i: { id: string; title?: string; habits?: string[] }) => rpc<null>("hb_goal_update", { p_goal: i.id, p_title: i.title ?? null, p_habits: i.habits ?? null }), onSuccess: inv });
}
export function useArchiveGoal() {
  const inv = useGoalInvalidate();
  return useMutation({ mutationFn: (id: string) => rpc<null>("hb_goal_archive", { p_goal: id }), onSuccess: inv });
}
export function useAddMeasure() {
  const inv = useGoalInvalidate();
  return useMutation({
    mutationFn: (i: { goal: string; kind: GoalMeasure["kind"]; label: string; unit: string; cadence: GoalMeasure["cadence"] }) =>
      rpc<string>("hb_measure_add", { p_goal: i.goal, p_kind: i.kind, p_label: i.label, p_unit: i.unit, p_cadence: i.cadence }),
    onSuccess: inv,
  });
}
export function useArchiveMeasure() {
  const inv = useGoalInvalidate();
  return useMutation({ mutationFn: (id: string) => rpc<null>("hb_measure_archive", { p_measure: id }), onSuccess: inv });
}
export function useSetMeasurement() {
  const inv = useGoalInvalidate();
  return useMutation({ mutationFn: (i: { measure: string; date: string; value: number }) => rpc<string>("hb_measurement_set", { p_measure: i.measure, p_date: i.date, p_value: i.value }), onSuccess: inv });
}
export function useDeleteMeasurement() {
  const inv = useGoalInvalidate();
  return useMutation({ mutationFn: (id: string) => rpc<null>("hb_measurement_delete", { p_id: id }), onSuccess: inv });
}

/** Quando cada dia foi marcado (função hb_log_times). Falha sem ruído: a regularidade só não aparece. */
export interface LogTimesData {
  timezone: string;
  logs: Array<{ habit_id: string; local_date: string; status: string; source: string; logged_at: string | null }>;
}
export function useLogTimes() {
  const { user } = useAuth();
  const enabled = useHabitsEnabled();
  return useQuery({
    queryKey: keys.logTimes(user?.id),
    enabled: !!user && enabled.data === true,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => rpc<LogTimesData>("hb_log_times", { p_days: 90 }),
  });
}
