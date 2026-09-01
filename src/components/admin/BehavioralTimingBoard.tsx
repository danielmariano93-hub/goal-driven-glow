import { useQuery } from "@tanstack/react-query";
import { Clock, RefreshCw, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { supabase } from "@/integrations/supabase/client";

type TimingOverview = {
  contract_version: string;
  period_days: number;
  scope: "global" | "user";
  totals: {
    events: number;
    pending: number;
    delivered: number;
    deferred: number;
    suppressed: number;
  };
  events_by_trigger: Array<{
    trigger: string;
    total: number;
    processed: number;
    avg_materiality: number | null;
    last_at: string | null;
  }>;
  decisions_by_trigger: Array<{
    trigger: string;
    decision: string;
    total: number;
    avg_timing_score: number | null;
    avg_priority_score: number | null;
  }>;
  defer_reasons: Array<{ reason: string; total: number; next_window: string | null }>;
  outcome_by_trigger: Array<{
    trigger: string;
    window: string;
    total: number;
    acted: number;
    dismissed: number;
    avg_hours_to_action: number | null;
  }>;
  principle_by_trigger: Array<{
    trigger: string;
    principle: string;
    strategy: string;
    total: number;
    acted: number;
  }>;
  recent_events: Array<{
    trigger: string;
    occurred_at: string;
    detected_at: string;
    materiality: number | null;
    processed_at: string | null;
    processing_result: Record<string, unknown> | null;
  }>;
  windows: Array<{
    event_type: string;
    label: string | null;
    open_after_hours: number;
    valid_for_hours: number;
    min_evidence_count: number;
    relative_floor_pct: number;
    enabled: boolean;
  }>;
};

const WINDOW_LABEL: Record<string, string> = {
  immediate: "imediata",
  same_day: "mesmo dia",
  late: "atrasada",
  pending_open: "ainda não abriu",
  closed: "fechada",
};

const DECISION_LABEL: Record<string, string> = {
  deliver: "falou",
  defer: "adiou",
  suppress: "reteve",
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function pct(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

export function BehavioralTimingBoard({ userId, days = 30 }: { userId?: string; days?: number }) {
  const query = useQuery({
    queryKey: ["admin", "behavioral-timing", userId ?? "global", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_v3_behavioral_timing", {
        _user_id: userId ?? null,
        _days: days,
      });
      if (error) throw error;
      return data as unknown as TimingOverview;
    },
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted/40" />;
  }
  if (query.error || !query.data) {
    return (
      <EmptyState
        icon={Timer}
        title="Momento comportamental indisponível"
        description="Não foi possível ler a auditoria de timing agora."
      />
    );
  }

  const data = query.data;
  const totals = data.totals;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Clock size={16} /> Momento da intervenção
          </h3>
          <p className="text-sm text-muted-foreground">
            Quando o Nino falou, quando adiou e o que a pessoa fez depois —{" "}
            {data.contract_version}, últimos {data.period_days} dias.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} className="gap-1">
          <RefreshCw size={14} /> Atualizar
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AdminMetricCard label="Eventos econômicos" value={String(totals.events)} />
        <AdminMetricCard label="Aguardando janela" value={String(totals.pending)} />
        <AdminMetricCard label="Falou" value={String(totals.delivered)} />
        <AdminMetricCard label="Adiou por momento" value={String(totals.deferred)} />
        <AdminMetricCard label="Reteve" value={String(totals.suppressed)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
          <p className="mb-3 text-sm font-medium">Eventos por gatilho</p>
          {data.events_by_trigger.length === 0
            ? <p className="text-sm text-muted-foreground">Nenhum evento no período.</p>
            : (
              <ul className="space-y-2 text-sm">
                {data.events_by_trigger.map((row) => (
                  <li key={row.trigger} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{row.trigger}</span>
                    <span className="text-muted-foreground">
                      {row.total} · avaliados {row.processed} · último {fmtDate(row.last_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div className="rounded-xl border p-4">
          <p className="mb-3 text-sm font-medium">Decisão por gatilho</p>
          {data.decisions_by_trigger.length === 0
            ? <p className="text-sm text-muted-foreground">Sem decisões registradas.</p>
            : (
              <ul className="space-y-2 text-sm">
                {data.decisions_by_trigger.slice(0, 12).map((row) => (
                  <li key={`${row.trigger}-${row.decision}`} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">{DECISION_LABEL[row.decision] ?? row.decision}</Badge>
                      <span className="font-mono text-xs">{row.trigger}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {row.total} · momento {row.avg_timing_score ?? "—"} · importância {row.avg_priority_score ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div className="rounded-xl border p-4">
          <p className="mb-3 text-sm font-medium">Resultado por gatilho e janela</p>
          {data.outcome_by_trigger.length === 0
            ? <p className="text-sm text-muted-foreground">Ainda sem resultado medido.</p>
            : (
              <ul className="space-y-2 text-sm">
                {data.outcome_by_trigger.slice(0, 12).map((row) => (
                  <li key={`${row.trigger}-${row.window}`} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">
                      {row.trigger} · {WINDOW_LABEL[row.window] ?? row.window}
                    </span>
                    <span className="text-muted-foreground">
                      agiu {pct(row.acted, row.total)} · dispensou {pct(row.dismissed, row.total)}
                      {row.avg_hours_to_action ? ` · ${row.avg_hours_to_action}h até agir` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div className="rounded-xl border p-4">
          <p className="mb-3 text-sm font-medium">Por que adiou</p>
          {data.defer_reasons.length === 0
            ? <p className="text-sm text-muted-foreground">Nada adiado por momento.</p>
            : (
              <ul className="space-y-2 text-sm">
                {data.defer_reasons.map((row) => (
                  <li key={row.reason} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{row.reason}</span>
                    <span className="text-muted-foreground">
                      {row.total}{row.next_window ? ` · reabre ${fmtDate(row.next_window)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <p className="mb-3 text-sm font-medium">Princípio comportamental por gatilho</p>
        {data.principle_by_trigger.length === 0
          ? <p className="text-sm text-muted-foreground">Sem princípios medidos ainda.</p>
          : (
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {data.principle_by_trigger.slice(0, 14).map((row) => (
                <li key={`${row.trigger}-${row.principle}-${row.strategy}`} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{row.trigger} · {row.principle}</span>
                  <span className="text-muted-foreground">{row.acted}/{row.total} agiram</span>
                </li>
              ))}
            </ul>
          )}
      </div>

      <div className="rounded-xl border p-4">
        <p className="mb-3 text-sm font-medium">Janelas configuradas</p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {data.windows.map((row) => (
            <li key={row.event_type} className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{row.event_type}</span>
              <span className="text-muted-foreground">
                {row.open_after_hours}h → {row.valid_for_hours}h · amostra {row.min_evidence_count}
                {row.enabled ? "" : " · desligada"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border p-4">
        <p className="mb-3 text-sm font-medium">Eventos recentes</p>
        {data.recent_events.length === 0
          ? <p className="text-sm text-muted-foreground">Nenhum evento capturado ainda.</p>
          : (
            <ul className="space-y-2 text-sm">
              {data.recent_events.slice(0, 12).map((row, index) => {
                const result = (row.processing_result ?? {}) as Record<string, unknown>;
                return (
                  <li key={`${row.trigger}-${row.detected_at}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{row.trigger} · {fmtDate(row.occurred_at)}</span>
                    <span className="text-muted-foreground">
                      {row.processed_at
                        ? `${WINDOW_LABEL[String(result.window ?? "")] ?? String(result.window ?? "—")} · momento ${String(result.timing_score ?? "—")} · ${String(result.reason ?? "")}`
                        : "aguardando avaliação"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </section>
  );
}
