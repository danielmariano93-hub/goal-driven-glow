import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type LifecycleRow = {
  day: string;
  new_users: number;
  active_users: number;
  dormant_users: number;
  churned_users: number;
};

type CohortRow = {
  cohort_week: string;
  week_offset: number;
  activated_users: number;
  retained_users: number;
  retention_rate: number;
};

type FunnelRow = { feature: string; step: string; users: number; events: number };
type Summary = { lifecycle: LifecycleRow[]; sample_size: number };
type Cohorts = { cohorts: CohortRow[] };
type Funnel = { funnel: FunnelRow[]; source_quality?: { live: number; backfill: number; proxy: number } };

function useRpc<T>(name: string, args: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    callAdminRpc<T>(name, args)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Falha ao carregar"))
      .finally(() => setLoading(false));
  }, [name]);
  return { data, loading, error };
}

export default function Crescimento() {
  const summary = useRpc<Summary>("admin_v2_growth_summary", { _days: 30 });
  const cohorts = useRpc<Cohorts>("admin_v2_growth_cohorts", { _weeks: 8 });
  const funnel = useRpc<Funnel>("admin_v2_growth_funnel", { _days: 30 });

  const last = summary.data?.lifecycle?.at(-1);
  const quality = funnel.data?.source_quality;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crescimento e retenção"
        description="Entenda quem chega, quem recebe valor e quem continua usando o Nino."
      />

      {summary.loading ? (
        <AdminSkeleton />
      ) : summary.error ? (
        <EmptyState title="Não foi possível carregar o resumo" description={summary.error} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminMetricCard label="Novos usuários" value={last?.new_users ?? 0} tone="brand" />
          <AdminMetricCard label="Ativos" value={last?.active_users ?? 0} tone="positive" />
          <AdminMetricCard label="Em risco/inativos" value={last?.dormant_users ?? 0} tone="warning" />
          <AdminMetricCard label="Abandonaram" value={last?.churned_users ?? 0} tone="critical" />
        </div>
      )}

      {quality && quality.live === 0 ? (
        <div className="rounded-2xl border border-[#6D4AFF]/20 bg-[#6D4AFF]/5 p-4 text-sm">
          O histórico atual foi reconstruído por backfill/proxy. Tendências ficarão mais confiáveis após a instrumentação live acumular dados.
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Funil das experiências</h2>
        {funnel.loading ? (
          <AdminSkeleton />
        ) : funnel.error ? (
          <EmptyState title="O funil está temporariamente indisponível" description={funnel.error} />
        ) : funnel.data?.funnel?.length ? (
          <AdminResponsiveList
            rows={funnel.data.funnel}
            rowKey={(row, index) => `${row.feature}-${row.step}-${index}`}
            columns={[
              { key: "feature", label: "Experiência", render: (row) => dict.feature(row.feature) },
              { key: "step", label: "Etapa", render: (row) => dict.step(row.step) },
              { key: "users", label: "Usuários", render: (row) => row.users, align: "right" },
              { key: "events", label: "Eventos", render: (row) => row.events, align: "right" },
            ]}
          />
        ) : (
          <EmptyState title="Ainda não há eventos live suficientes para desenhar o funil" />
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Retenção por coorte</h2>
        {cohorts.loading ? (
          <AdminSkeleton />
        ) : cohorts.error ? (
          <EmptyState title="Não foi possível carregar as coortes" description={cohorts.error} />
        ) : cohorts.data?.cohorts?.length ? (
          <AdminResponsiveList
            rows={cohorts.data.cohorts}
            rowKey={(row, index) => `${row.cohort_week}-${row.week_offset}-${index}`}
            columns={[
              { key: "cohort", label: "Coorte", render: (row) => row.cohort_week },
              { key: "week", label: "Semana", render: (row) => `W${row.week_offset}` },
              { key: "activated", label: "Ativados", render: (row) => row.activated_users, align: "right" },
              { key: "retained", label: "Retidos", render: (row) => row.retained_users, align: "right" },
            ]}
          />
        ) : (
          <EmptyState
            title="Ainda não há histórico suficiente para calcular retenção"
            description="A primeira leitura aparecerá quando a janela mínima de coorte for concluída."
          />
        )}
      </section>
    </div>
  );
}
