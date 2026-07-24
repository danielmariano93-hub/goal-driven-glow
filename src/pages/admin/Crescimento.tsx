import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";
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

export default function Crescimento() {
  const [summary, setSummary] = useState<{ lifecycle: LifecycleRow[]; sample_size: number } | null>(null);
  const [cohorts, setCohorts] = useState<CohortRow[] | null>(null);
  const [funnel, setFunnel] = useState<FunnelRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      callAdminRpc<{ lifecycle: LifecycleRow[]; sample_size: number }>("admin_v2_growth_summary", { _days: 30 }),
      callAdminRpc<{ cohorts: CohortRow[] }>("admin_v2_growth_cohorts", { _weeks: 8 }),
      callAdminRpc<{ funnel: FunnelRow[] }>("admin_v2_growth_funnel", { _days: 30 }),
    ])
      .then(([s, c, f]) => {
        setSummary(s);
        setCohorts(c.cohorts);
        setFunnel(f.funnel);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Crescimento" description="Novos, ativos, dormentes, churn e retenção. Sem PII." />

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Ciclo de vida — 30 dias</h3>
        {summary?.lifecycle.length ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.lifecycle}>
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
        ) : (
          <EmptyState title="Sem dados de ciclo de vida" />
        )}
      </div>

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Coortes W1/W4/W8</h3>
        {cohorts?.length ? (
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
                {cohorts.map((c, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="py-2">{c.cohort_week}</td>
                    <td>{c.reference_week}</td>
                    <td>W{c.week_offset}</td>
                    <td className="text-right tabular-nums">{c.activated_users}</td>
                    <td className="text-right tabular-nums">{c.retained_users}</td>
                    <td className="text-right tabular-nums">{c.retention_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sem coortes suficientes" description="Backfill inicial ainda não gerou coortes semanais." />
        )}
      </div>

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Funil por feature (30d)</h3>
        {funnel?.length ? (
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
                {funnel.map((f, i) => (
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
        ) : (
          <EmptyState title="Sem eventos no funil" />
        )}
      </div>
    </div>
  );
}
