import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { adminErrorMessage, callAdminRpc, withPeriod } from "@/lib/admin/adminRpc";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";
import { dict } from "@/lib/admin/displayDictionary";

type Summary = {
  total_clients: number;
  new_clients: number;
  active_clients: number;
  activated_clients: number;
  dormant_clients: number;
  with_financial_data: number;
  period: { from: string; to: string; timezone: string };
  formula_version: string;
  universe: string;
};

type CohortRow = {
  cohort_week: string;
  week_offset: number;
  activated_users: number;
  retained_users: number;
  retention_rate: number;
};

type FunnelRow = { feature: string; step: string; users: number; events: number };
type Cohorts = { cohorts: CohortRow[] };
type Funnel = { funnel: FunnelRow[]; source_quality?: { live: number; backfill: number; proxy: number } };

export default function Crescimento() {
  const [preset, setPreset] = useState<PeriodPresetKey>("30d");
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset("30d"));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cohorts, setCohorts] = useState<Cohorts | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setCohorts(null);
    setFunnel(null);

    Promise.allSettled([
      callAdminRpc<Summary>("admin_v2_growth_summary", withPeriod(range)),
      callAdminRpc<Cohorts>("admin_v2_growth_cohorts", { _weeks: 8 }),
      callAdminRpc<Funnel>("admin_v2_growth_funnel", { _days: Math.max(1, daysBetween(range)) }),
    ])
      .then(([summaryResult, cohortsResult, funnelResult]) => {
        if (summaryResult.status === "rejected") {
          setSummary(null);
          setError(adminErrorMessage(summaryResult.reason, "Falha ao carregar o resumo de crescimento"));
          return;
        }

        setSummary(summaryResult.value);
        if (cohortsResult.status === "fulfilled") {
          setCohorts(cohortsResult.value);
        }
        if (funnelResult.status === "fulfilled") {
          setFunnel(funnelResult.value);
        }
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const quality = funnel?.source_quality;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crescimento e retenção"
        description="Entenda quem chega, quem recebe valor e quem continua usando o Nino."
        actions={
          <AdminDateFilter
            preset={preset}
            value={range}
            onChange={({ preset: p, range: r }) => {
              setPreset(p);
              setRange(r);
            }}
          />
        }
      />

      {loading ? (
        <AdminSkeleton />
      ) : error ? (
        <EmptyState title="Não foi possível carregar o resumo" description={error} />
      ) : summary ? (
        <>
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Estoque atual</h2>
              <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                agora
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
              <AdminMetricCard label="Clientes totais" value={summary.total_clients} tone="brand" />
              <AdminMetricCard label="Com dados financeiros" value={summary.with_financial_data} tone="positive" />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Fluxo no período</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <AdminMetricCard label="Novos clientes" value={summary.new_clients} tone="brand" />
              <AdminMetricCard label="Ativados" value={summary.activated_clients} tone="positive" />
              <AdminMetricCard label="Ativos" value={summary.active_clients} tone="positive" />
              <AdminMetricCard label="Dormant" value={summary.dormant_clients} tone="warning" />
            </div>
          </section>
        </>
      ) : null}

      {quality && quality.live === 0 ? (
        <div className="rounded-2xl border border-[#6D4AFF]/20 bg-[#6D4AFF]/5 p-4 text-sm">
          O histórico atual foi reconstruído por backfill/proxy. Tendências ficarão mais confiáveis após a instrumentação live acumular dados.
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Funil das experiências</h2>
        {loading ? (
          <AdminSkeleton />
        ) : funnel?.funnel?.length ? (
          <AdminResponsiveList
            rows={funnel.funnel}
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
        {loading ? (
          <AdminSkeleton />
        ) : cohorts?.cohorts?.length ? (
          <AdminResponsiveList
            rows={cohorts.cohorts}
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

function daysBetween(range: PeriodRange): number {
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000) + 1;
}
