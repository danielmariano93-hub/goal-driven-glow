import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { safeRate } from "@/lib/admin/displayDictionary";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";

type LifecycleRow = {
  day: string;
  new_users: number;
  active_users: number;
  dormant_users: number;
  churned_users: number;
};

type CohortRow = {
  cohort_week: string;
  reference_week: string;
  week_offset: number;
  activated_users: number;
  retained_users: number;
  retention_rate: number;
};

type FunnelRow = { feature: string; step: string; users: number; events: number };

type SectionState<T> = { loading: boolean; error: string | null; data: T | null };

function useSection<T>(loader: () => Promise<T>, deps: unknown[] = []): SectionState<T> {
  const [state, setState] = useState<SectionState<T>>({ loading: true, error: null, data: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    loader()
      .then((d) => { if (!cancelled) setState({ loading: false, error: null, data: d }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e?.message ?? "Erro ao carregar", data: null }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function SectionShell({
  title,
  state,
  emptyTitle,
  emptyDescription,
  isEmpty,
  children,
}: {
  title: string;
  state: SectionState<any>;
  emptyTitle: string;
  emptyDescription?: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-card p-4">
      <h3 className="font-display text-base font-semibold mb-3">{title}</h3>
      {state.loading ? (
        <AdminSkeleton />
      ) : state.error ? (
        <EmptyState title="Não foi possível carregar" description={state.error} />
      ) : isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        children
      )}
    </div>
  );
}

export default function Crescimento() {
  const summary = useSection<{ lifecycle: LifecycleRow[]; sample_size: number }>(
    () => callAdminRpc("admin_v2_growth_summary", { _days: 30 })
  );
  const cohorts = useSection<{ cohorts: CohortRow[] }>(
    () => callAdminRpc("admin_v2_growth_cohorts", { _weeks: 8 })
  );
  const funnel = useSection<{ funnel: FunnelRow[] }>(
    () => callAdminRpc("admin_v2_growth_funnel", { _days: 30 })
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crescimento"
        description="Novos, ativos, dormentes, churn e retenção. Sem PII."
      />

      <SectionShell
        title="Ciclo de vida — 30 dias"
        state={summary}
        emptyTitle="Ainda sem dados suficientes"
        emptyDescription="Precisamos de pelo menos alguns dias de atividade para mostrar o ciclo de vida."
        isEmpty={!summary.data?.lifecycle?.length}
      >
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.data?.lifecycle ?? []}>
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="new_users" stackId="a" fill="#6D4AFF" name="Novos" />
              <Bar dataKey="active_users" stackId="a" fill="#2FC99A" name="Ativos" />
              <Bar dataKey="dormant_users" stackId="a" fill="#FFC46B" name="Dormentes" />
              <Bar dataKey="churned_users" stackId="a" fill="#FF6B5F" name="Churn" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionShell>

      <SectionShell
        title="Coortes W1/W4/W8"
        state={cohorts}
        emptyTitle="Coortes ainda em formação"
        emptyDescription="As primeiras coortes aparecem após 1 semana completa de ativação."
        isEmpty={!cohorts.data?.cohorts?.length}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Coorte</th>
                <th>Semana</th>
                <th>Offset</th>
                <th className="text-right">Ativados</th>
                <th className="text-right">Retidos</th>
                <th className="text-right">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {(cohorts.data?.cohorts ?? []).map((c, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2">{c.cohort_week}</td>
                  <td>{c.reference_week}</td>
                  <td>W{c.week_offset}</td>
                  <td className="text-right tabular-nums">{c.activated_users}</td>
                  <td className="text-right tabular-nums">{c.retained_users}</td>
                  <td className="text-right tabular-nums">
                    {safeRate(c.retained_users, c.activated_users)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionShell>

      <SectionShell
        title="Funil por feature (30d)"
        state={funnel}
        emptyTitle="Sem eventos no funil"
        emptyDescription="Ainda não há eventos vivos suficientes para desenhar o funil."
        isEmpty={!funnel.data?.funnel?.length}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Feature</th>
                <th>Etapa</th>
                <th className="text-right">Usuários</th>
                <th className="text-right">Eventos</th>
              </tr>
            </thead>
            <tbody>
              {(funnel.data?.funnel ?? []).map((f, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2">{f.feature}</td>
                  <td>{f.step}</td>
                  <td className="text-right tabular-nums">{f.users}</td>
                  <td className="text-right tabular-nums">{f.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionShell>
    </div>
  );
}
