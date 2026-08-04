// Cliente da inteligência unificada do Nino (nino_intelligence.v1).
// Uma única fonte alimenta Home, página do Nino, Relatórios e aba Mais.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;

async function callRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type NinoItemKind =
  | "change" | "risk" | "opportunity" | "achievement" | "data_quality" | "pattern"
  | "commitment" | "projection" | "pending_confirmation" | "recommendation" | "closed_period_summary";

export type NinoAction = { label?: string | null; route?: string | null } | null;

export type NinoItem = {
  id: string | null;
  kind: NinoItemKind;
  temporal_role?: "now" | "historical" | "future" | "closed_period";
  status?: string;
  priority?: number;
  severity: string;
  title: string;
  summary: string;
  explanation: string;
  evidence: Record<string, unknown> | null;
  primary_action: NinoAction;
  secondary_action?: NinoAction;
  source?: string;
  period?: { start: string | null; end: string | null };
  valid_from?: string | null;
  valid_until?: string | null;
  confidence?: number;
  data_quality?: string;
  report_id?: string | null;
  dedup_key?: string;
  created_at?: string;
  updated_at?: string;
  acted_at?: string | null;
  dismissed_at?: string | null;
};

export type NinoContext = {
  ok: boolean;
  as_of: string;
  continuity_topic: string | null;
  last_seen_at: string | null;
  new_since_last_visit: number;
  now: NinoItem[];
  changes: NinoItem[];
  learnings: NinoItem[];
  prepare: NinoItem[];
  history: NinoItem[];
  achievements: NinoItem[];
  data_quality: { status: "ok" | "attention" | "insufficient"; uncategorized_count: number };
};

export type MoreMenuContext = {
  ok: boolean;
  as_of: string;
  split: { open_count: number; awaiting_confirmation: number; amount_to_receive: number } | null;
  reports: { last_period_label: string | null; last_report_id: string | null; unread: number } | null;
  nino: { active_items: number; new_since_last_visit: number; attention_items: number };
  data_quality: { uncategorized_count: number };
  recurring: { active: number };
  debts: { active: number };
  investments: { count: number };
  challenge: { title: string | null; progress: number | null; status: string | null } | null;
};

export type ReportsContext = {
  ok: boolean;
  period: { start: string; end: string };
  facts: Array<Record<string, unknown>>;
  items: NinoItem[];
  closed_periods: Array<{
    report_id: string;
    report_type: "weekly" | "monthly";
    period_start: string;
    period_end: string;
    health_score: number | null;
    executive_summary: string | null;
    viewed_at: string | null;
    data_quality_status: string | null;
  }>;
};

export function useNinoContext() {
  const { user } = useAuth();
  return useQuery<NinoContext>({
    queryKey: ["nino-intelligence", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: () => callRpc<NinoContext>("my_nino_intelligence_context"),
  });
}

export function useNinoHomeItem() {
  const { user } = useAuth();
  return useQuery<{ ok: boolean; kind: "item" | "stability"; item: NinoItem }>({
    queryKey: ["nino-home-item", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => callRpc("my_nino_home_item"),
  });
}

export function useMoreMenuContext() {
  const { user } = useAuth();
  return useQuery<MoreMenuContext>({
    queryKey: ["more-menu-context", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: () => callRpc<MoreMenuContext>("my_more_menu_context"),
  });
}

export function useReportsContext(range?: { start: string; end: string }) {
  const { user } = useAuth();
  return useQuery<ReportsContext>({
    queryKey: ["reports-context", user?.id, range?.start, range?.end],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: () =>
      callRpc<ReportsContext>("my_reports_current_context", {
        _start: range?.start ?? null,
        _end: range?.end ?? null,
      }),
  });
}

export function useNinoRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callRpc<{ ok: boolean }>("my_nino_refresh"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["nino-intelligence"] });
      void qc.invalidateQueries({ queryKey: ["nino-home-item"] });
      void qc.invalidateQueries({ queryKey: ["more-menu-context"] });
      void qc.invalidateQueries({ queryKey: ["reports-context"] });
    },
  });
}

export function useNinoFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { itemId: string; feedback: "useful" | "not_useful" | "dismiss"; surface?: string }) =>
      callRpc<{ ok: boolean }>("my_nino_item_feedback", {
        _item_id: v.itemId,
        _feedback: v.feedback,
        _surface: v.surface ?? "nino",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["nino-intelligence"] });
      void qc.invalidateQueries({ queryKey: ["nino-home-item"] });
    },
  });
}

export function useNinoAct() {
  return useMutation({
    mutationFn: (v: { itemId: string; surface?: string }) =>
      callRpc<{ ok: boolean }>("my_nino_item_act", { _item_id: v.itemId, _surface: v.surface ?? "nino" }),
  });
}

export async function markNinoSeen(surface: string, section = "all") {
  try {
    await callRpc("my_nino_mark_seen", { _surface: surface, _section: section });
  } catch {
    /* silencioso: telemetria não bloqueia a tela */
  }
}

export async function recordNinoExposure(itemId: string, surface: string, rank?: number, reason?: string) {
  try {
    await callRpc("my_nino_record_exposure", {
      _item_id: itemId,
      _surface: surface,
      _rank: rank ?? null,
      _selection_reason: reason ?? null,
    });
  } catch {
    /* silencioso */
  }
}

const SAFE_ROUTE = /^\/app\/[A-Za-z0-9\-/?=&_.]*$/;

export function safeRoute(action: NinoAction, fallback = "/app/nino"): string {
  const route = action?.route ?? "";
  return SAFE_ROUTE.test(route) ? route : fallback;
}

export function actionLabel(action: NinoAction, fallback = "Abrir"): string {
  const label = (action?.label ?? "").trim();
  return label || fallback;
}

export const KIND_LABEL: Record<string, string> = {
  change: "Mudou",
  risk: "Atenção",
  opportunity: "Oportunidade",
  achievement: "Conquista",
  data_quality: "Qualidade dos dados",
  pattern: "Aprendizado",
  commitment: "Compromisso",
  projection: "Projeção",
  pending_confirmation: "Aguardando você",
  recommendation: "Próximo passo",
  closed_period_summary: "Fechamento",
};

export const MATURITY_LABEL: Record<string, string> = {
  learning: "Aprendendo",
  observing: "Em observação",
  confirmed: "Confirmado",
};
