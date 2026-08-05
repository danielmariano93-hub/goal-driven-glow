// Cliente da inteligência unificada do Nino (nino_intelligence.v1).
// Uma única fonte alimenta Home, página do Nino, Relatórios e aba Mais.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  NinoContractError,
  parseNinoContext,
  parseItems,
  refreshResultSchema,
  type RefreshResult,
} from "@/lib/nino/contracts.zod";
import { fixMoneyLocale } from "@/lib/nino/format";

export type NinoErrorKind = "network" | "auth" | "rpc" | "contract";

export class NinoRpcError extends Error {
  kind: NinoErrorKind;
  fn: string;
  code?: string;
  constructor(message: string, kind: NinoErrorKind, fn: string, code?: string) {
    super(message);
    this.name = "NinoRpcError";
    this.kind = kind;
    this.fn = fn;
    this.code = code;
  }
}

function classify(fn: string, error: { message?: string; code?: string; details?: string } | null, thrown?: unknown): NinoRpcError {
  const message = error?.message ?? (thrown instanceof Error ? thrown.message : "Falha ao consultar o Nino");
  const code = error?.code;
  const lower = message.toLowerCase();
  let kind: NinoErrorKind = "rpc";
  if (code === "PGRST301" || code === "401" || lower.includes("jwt") || lower.includes("not authenticated")) kind = "auth";
  else if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("timeout")) kind = "network";
  // Log estruturado sem valores financeiros.
  console.warn("[nino.rpc]", JSON.stringify({ fn, kind, code: code ?? null, message }));
  return new NinoRpcError(message, kind, fn, code);
}

/**
 * IMPORTANTE: `supabase.rpc` depende da instância (`this.rest`).
 * Nunca guardar a referência solta do método — chame sempre a partir do cliente.
 */
async function callRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  let payload: { data: unknown; error: { message?: string; code?: string } | null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload = (await (supabase.rpc as any).call(supabase, name, args ?? {})) as typeof payload;
  } catch (e) {
    throw classify(name, null, e);
  }
  if (payload.error) throw classify(name, payload.error);
  return payload.data as T;
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

export type NinoDuplicatePair = {
  pair_key: string;
  merchant: string;
  amount: number;
  occurred_at?: string | null;
  count?: number;
  transactions?: Array<Record<string, unknown>>;
};

export type NinoContext = {
  ok: boolean;
  as_of: string;
  contract: string | null;
  continuity_topic: string | null;
  last_seen_at: string | null;
  new_since_last_visit: number;
  primary_item: NinoItem | null;
  secondary_changes: NinoItem[];
  operational_tasks: NinoItem[];
  now: NinoItem[];
  changes: NinoItem[];
  learnings: NinoItem[];
  prepare: NinoItem[];
  history: NinoItem[];
  achievements: NinoItem[];
  engine_state: { patterns_tracked: number; anticipations_open: number; suppressed_total: number };
  data_quality: { status: "ok" | "attention" | "insufficient"; uncategorized_count: number; reason?: string | null };
  invalidItems: number;
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

/** Normaliza textos monetários que possam ter vindo com separador americano. */
function normalizeItem(item: Record<string, unknown>): NinoItem {
  return {
    ...(item as unknown as NinoItem),
    title: fixMoneyLocale(String(item.title ?? "")),
    summary: fixMoneyLocale(String(item.summary ?? "")),
    explanation: fixMoneyLocale(String(item.explanation ?? "")),
  };
}

export function useNinoContext() {
  const { user } = useAuth();
  return useQuery<NinoContext>({
    queryKey: ["nino-intelligence", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    retry: (count, error) => (error instanceof NinoRpcError && error.kind === "network" ? count < 2 : false),
    queryFn: async () => {
      const raw = await callRpc<unknown>("my_nino_intelligence_context");
      const parsed = parseNinoContext(raw);
      if (parsed.ok === false) {
        throw new NinoRpcError(parsed.error ?? "A inteligência do Nino não pôde ser lida.", "rpc", "my_nino_intelligence_context");
      }
      return {
        ok: true,
        as_of: parsed.as_of ?? new Date().toISOString(),
        continuity_topic: parsed.continuity_topic ?? null,
        last_seen_at: parsed.last_seen_at ?? null,
        new_since_last_visit: parsed.new_since_last_visit ?? 0,
        now: parsed.sections.now.map(normalizeItem),
        changes: parsed.sections.changes.map(normalizeItem),
        learnings: parsed.sections.learnings.map(normalizeItem),
        prepare: parsed.sections.prepare.map(normalizeItem),
        history: parsed.sections.history.map(normalizeItem),
        achievements: parsed.sections.achievements.map(normalizeItem),
        data_quality: (parsed.data_quality ?? { status: "ok", uncategorized_count: 0 }) as NinoContext["data_quality"],
        invalidItems: parsed.invalidItems,
      };
    },
  });
}

export function useNinoHomeItem() {
  const { user } = useAuth();
  return useQuery<{ ok: boolean; kind: "item" | "stability"; item: NinoItem | null }>({
    queryKey: ["nino-home-item", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const raw = (await callRpc<Record<string, unknown>>("my_nino_home_item")) ?? {};
      const { items } = parseItems([raw.item].filter(Boolean));
      return {
        ok: raw.ok !== false,
        kind: (raw.kind as "item" | "stability") ?? "stability",
        item: items[0] ? normalizeItem(items[0] as unknown as Record<string, unknown>) : null,
      };
    },
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
    queryFn: async () => {
      const raw = await callRpc<ReportsContext>("my_reports_current_context", {
        _start: range?.start ?? null,
        _end: range?.end ?? null,
      });
      const { items } = parseItems((raw as unknown as Record<string, unknown>)?.items);
      return { ...raw, items: items.map((i) => normalizeItem(i as unknown as Record<string, unknown>)) };
    },
  });
}

export type NinoRefreshSummary = {
  ok: boolean;
  at: string;
  created: number;
  updated: number;
  superseded: number;
  expired: number;
  activeTotal: number;
};

/** Refresh manual: só considera sucesso quando a nova consulta também conclui. */
export function useNinoRefresh() {
  const qc = useQueryClient();
  return useMutation<NinoRefreshSummary>({
    mutationFn: async () => {
      const raw = await callRpc<unknown>("my_nino_refresh");
      const parsed: RefreshResult = refreshResultSchema.parse(raw ?? {});
      if (parsed.ok === false) throw new NinoRpcError(parsed.error ?? "Não foi possível atualizar as leituras.", "rpc", "my_nino_refresh");
      const summary: NinoRefreshSummary = {
        ok: true,
        at: parsed.at ?? new Date().toISOString(),
        created: parsed.counts?.created ?? 0,
        updated: parsed.counts?.updated ?? 0,
        superseded: parsed.counts?.superseded ?? 0,
        expired: parsed.counts?.expired ?? 0,
        activeTotal: parsed.counts?.active_total ?? parsed.items ?? 0,
      };
      // Sucesso só depois do refetch concluído.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["nino-intelligence"] }),
        qc.invalidateQueries({ queryKey: ["nino-home-item"] }),
        qc.invalidateQueries({ queryKey: ["more-menu-context"] }),
        qc.invalidateQueries({ queryKey: ["reports-context"] }),
      ]);
      await qc.refetchQueries({ queryKey: ["nino-intelligence"], type: "active" });
      return summary;
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

const SAFE_ROUTE = /^\/app\/[A-Za-z0-9\-/?=&_.~:@!$'()*+,;[\]]*$/;

/** Aceita rotas internas, inclusive com percent-encoding válido; bloqueia esquemas externos. */
export function safeRoute(action: NinoAction, fallback = "/app/nino"): string {
  const route = (action?.route ?? "").trim();
  if (!route || route.startsWith("//")) return fallback;
  let decoded = route;
  try {
    decoded = decodeURI(route);
  } catch {
    return fallback;
  }
  if (/[<>"\s\\]/.test(decoded)) return fallback;
  if (!SAFE_ROUTE.test(decoded.replace(/%[0-9A-Fa-f]{2}/g, "a"))) return fallback;
  return route;
}

const DEFAULT_ACTION_LABEL: Record<string, string> = {
  risk: "Ver detalhes",
  change: "Ver relatório",
  pattern: "Entender padrão",
  recommendation: "Resolver agora",
  data_quality: "Classificar",
  opportunity: "Ver oportunidade",
  achievement: "Ver conquista",
  closed_period_summary: "Ver fechamento",
  pending_confirmation: "Confirmar",
  projection: "Ver projeção",
  commitment: "Ver compromisso",
};

export function actionLabel(action: NinoAction, fallback = "Abrir", kind?: string): string {
  const label = (action?.label ?? "").trim();
  if (label) return label;
  return (kind && DEFAULT_ACTION_LABEL[kind]) || fallback;
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

export { NinoContractError };
