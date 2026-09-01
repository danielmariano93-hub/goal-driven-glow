import { useQuery } from "@tanstack/react-query";
import { Brain, CheckCircle2, History, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { supabase } from "@/integrations/supabase/client";

type LearningEvent = {
  id: string;
  occurred_at: string;
  event_type: string;
  source: string;
  signal: string;
  subject_key: string | null;
  confidence: number;
  applied: boolean;
};

type LearningOverview = {
  period_days: number;
  totals: {
    events: number;
    applied: number;
    corrections: number;
    commitments: number;
    checkins: number;
    memory_items: number;
    active_commitments: number;
    paused_commitments: number;
    completed_commitments: number;
    delivered_checkins: number;
    dismissals: number;
    cancelled_commitments: number;
    backfilled_events: number;
    recent_agent_runs: number;
  };
  current_strategy: {
    strategy: string;
    strategy_reason: string | null;
    stage: string;
    title: string;
    last_outcome: string | null;
    dismissals?: number | null;
    intervention_attempts: number;
    next_check_at: string;
  } | null;
  by_type: Array<{ event_type: string; total: number; applied: number }>;
  by_strategy: Array<{ strategy: string; total: number; success: number }>;
  by_principle: Array<{ principle: string; total: number; success: number }>;
  by_recommendation_source: Array<{ source: string; total: number; accepted: number }>;
  recent: LearningEvent[];
  last_learned_at: string | null;
  health: "healthy" | "warming_up" | "attention";
  health_reason: string;
};

const STRATEGY_LABEL: Record<string, string> = {
  reinforce: "reforçar",
  remind: "retomar",
  reframe: "reformular",
  pause: "pausar",
};

const OUTCOME_LABEL: Record<string, string> = {
  completed: "concluído",
  progress: "avanço",
  stalled: "sem avanço",
  regressed: "piorou",
  no_evidence: "sem evidência",
};

function label(type: string): string {
  const map: Record<string, string> = {
    correction: "Correção do usuário",
    interaction_reinforcement: "Reforço de interação",
    merchant_observation: "Estabelecimento observado",
    category_observation: "Categoria observada",
    change_commitment: "Compromisso",
    change_checkin: "Acompanhamento",
    memory_snapshot: "Memória anterior",
  };
  return map[type] ?? type.split("_").join(" ");
}

export function NinoLearningBoard({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ["admin_nino_learning_overview", userId],
    queryFn: async (): Promise<LearningOverview> => {
      const { data, error } = await supabase.rpc("admin_nino_learning_overview", {
        _user_id: userId,
        _days: 30,
      });
      if (error) throw error;
      return data as unknown as LearningOverview;
    },
    staleTime: 15_000,
  });

  if (query.isLoading) {
    return <div className="surface-card p-5 text-sm text-muted-foreground">Carregando aprendizado…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Não foi possível carregar o aprendizado"
        description="A memória do Nino continua preservada. Esta tela usa o ledger auditável de eventos de aprendizado."
        action={<Button variant="outline" onClick={() => void query.refetch()}><RefreshCw size={14} /> Tentar novamente</Button>}
      />
    );
  }

  const d = query.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Como o Nino está aprendendo</h3>
          <p className="text-xs text-muted-foreground">
            Evento → memória/estratégia aplicada → efeito nas próximas decisões. Últimos {d.period_days} dias.
          </p>
        </div>
        <Badge variant={d.health === "attention" ? "destructive" : "secondary"}>
          {d.health === "healthy" ? "aprendendo" : d.health === "warming_up" ? "aquecendo" : "verificar pipeline"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminMetricCard label="Eventos de aprendizado" value={String(d.totals.events)} detail={`${d.totals.applied} aplicados`} />
        <AdminMetricCard
          label="Correções absorvidas"
          value={String(d.totals.corrections)}
          detail={`${d.totals.dismissals ?? 0} dispensa(s) viraram mudança de abordagem`}
        />
        <AdminMetricCard label="Compromissos acompanhados" value={String(d.totals.commitments)} detail={`${d.totals.active_commitments} ativos · ${d.totals.paused_commitments} pausados · ${d.totals.completed_commitments} concluídos`} />
        <AdminMetricCard
          label="Último aprendizado"
          value={d.last_learned_at ? new Date(d.last_learned_at).toLocaleDateString("pt-BR") : "—"}
          detail={d.health_reason}
        />
      </div>

      {d.current_strategy && (
        <div className="surface-card p-4 text-xs">
          <p className="text-sm font-semibold">Abordagem atual do Nino</p>
          <p className="mt-1 text-muted-foreground">
            “{d.current_strategy.title}” · estágio {d.current_strategy.stage} · abordagem {STRATEGY_LABEL[d.current_strategy.strategy] ?? d.current_strategy.strategy}
            {d.current_strategy.last_outcome ? ` · último resultado ${OUTCOME_LABEL[d.current_strategy.last_outcome] ?? d.current_strategy.last_outcome}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            {d.current_strategy.intervention_attempts} intervenção(ões) medida(s) · próximo acompanhamento em{" "}
            {new Date(d.current_strategy.next_check_at).toLocaleDateString("pt-BR")}
            {d.current_strategy.strategy_reason ? ` · motivo ${d.current_strategy.strategy_reason}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {d.totals.delivered_checkins} acompanhamento(s) contabilizado(s) somente após entrega confirmada.
          </p>
        </div>
      )}

      {d.health === "attention" && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-semibold">Há conversas recentes, mas o ledger não está recebendo aprendizado.</p>
          <p className="mt-1 text-muted-foreground">{d.health_reason}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="surface-card p-4">
          <h4 className="text-sm font-semibold">Abordagem que funciona</h4>
          {(d.by_strategy ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">Sem acompanhamento entregue no recorte.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(d.by_strategy ?? []).map((row) => (
                <li key={row.strategy} className="flex items-center justify-between gap-3 text-xs">
                  <span>{STRATEGY_LABEL[row.strategy] ?? row.strategy}</span>
                  <span className="tabular-nums text-muted-foreground">{row.success}/{row.total} com avanço</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="surface-card p-4">
          <h4 className="text-sm font-semibold">Princípio que funciona</h4>
          {(d.by_principle ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">Sem princípio medido ainda.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(d.by_principle ?? []).map((row) => (
                <li key={row.principle} className="flex items-center justify-between gap-3 text-xs">
                  <span>{row.principle.split("_").join(" ")}</span>
                  <span className="tabular-nums text-muted-foreground">{row.success}/{row.total} com avanço</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="surface-card p-4">
          <h4 className="text-sm font-semibold">De onde vem a recomendação</h4>
          {(d.by_recommendation_source ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">Nenhuma recomendação registrada no recorte.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(d.by_recommendation_source ?? []).map((row) => (
                <li key={row.source} className="flex items-center justify-between gap-3 text-xs">
                  <span>{row.source === "chat" ? "conversa" : row.source === "app" ? "app" : "proativo"}</span>
                  <span className="tabular-nums text-muted-foreground">{row.accepted}/{row.total} assumidas</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="surface-card p-4">
          <h4 className="text-sm font-semibold flex items-center gap-2"><Brain size={14} /> O que mais está ensinando o Nino</h4>
          {d.by_type.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Ainda não há eventos novos. As {d.totals.memory_items} memórias existentes continuam disponíveis
              ({d.totals.backfilled_events} já importadas para o ledger).
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.by_type.map((row) => (
                <li key={row.event_type} className="flex items-center justify-between gap-3 text-xs">
                  <span>{label(row.event_type)}</span>
                  <span className="tabular-nums text-muted-foreground">{row.total} · {row.applied} aplicados</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-4">
          <h4 className="text-sm font-semibold flex items-center gap-2"><History size={14} /> Evolução recente</h4>
          {d.recent.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">Nenhum evento novo no recorte.</p>
          ) : (
            <div className="mt-3 divide-y divide-border">
              {d.recent.map((event) => (
                <article key={event.id} className="py-2.5 first:pt-0">
                  <div className="flex items-center gap-2">
                    {event.applied && <CheckCircle2 size={13} className="text-primary" />}
                    <p className="text-xs font-medium">{label(event.event_type)}</p>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(event.occurred_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {event.signal} · fonte {event.source} · confiança {Math.round(Number(event.confidence || 0) * 100)}%
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
