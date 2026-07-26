import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { callAdminRpc, withPeriod, withDateRange, adminErrorMessage, type Envelope } from "@/lib/admin/adminRpc";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { AdminDailyEvolutionCard } from "@/components/admin/AdminDailyEvolutionCard";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type MetricsHealth = {
  last_refresh_at: string | null;
  stale: boolean;
  auth_users: number;
  profiles: number;
  pseudonyms: number;
  client_users?: number;
  platform_admins?: number;
  measured_at: string;
};

type CockpitData = {
  wvu: Envelope;
  activation: Envelope;
  value_delivered: Envelope;
  registered_today: Envelope;
  total_users: Envelope;
  agent_cost_cents_today: Envelope;
  messaging_failure_rate_7d: Envelope;
  attention: Array<{ key: string; severity: string; value: number }>;
  metrics_health?: MetricsHealth;
  period?: { from: string; to: string; days: number; timezone: string };
};

type DailyEvolution = {
  series: Array<{
    day: string;
    new_clients: number;
    activated: number;
    active_unique: number;
    went_dormant: number;
    cumulative_clients: number;
    first_financial_action: number;
  }>;
  sample_size: number;
  sufficient_sample: boolean;
  formula_version: string;
};

export default function Cockpit() {
  const [preset, setPreset] = useState<PeriodPresetKey>("30d");
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset("30d"));
  const [data, setData] = useState<CockpitData | null>(null);
  const [evolution, setEvolution] = useState<DailyEvolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      callAdminRpc<CockpitData>("admin_v2_cockpit", withPeriod(range)),
      callAdminRpc<DailyEvolution>("admin_v2_daily_evolution", withPeriod(range)),
    ])
      .then(([cockpit, evo]) => {
        setData(cockpit);
        setEvolution(evo);
      })
      .catch((e) => setError(e?.message ?? "Falha ao carregar Cockpit"))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro ao carregar Cockpit" description={error} />;
  if (!data) return null;

  const health = data.metrics_health;
  const clientsCount = health?.client_users ?? null;
  const adminsCount = health?.platform_admins ?? null;
  const contractsMismatch = health && clientsCount !== null && adminsCount !== null
    && health.auth_users !== clientsCount + adminsCount;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cockpit"
        description="Métricas dos clientes reais do Meu Nino — administradores da plataforma não são contabilizados."
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

      {(health?.stale || contractsMismatch) && (
        <div className="rounded-2xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Atenção à integridade dos indicadores</p>
          <p className="mt-1">
            {health?.stale ? "Agregação atrasada. Cartões usam fontes live. " : ""}
            {contractsMismatch
              ? `Divergência: auth=${health?.auth_users}, clientes=${clientsCount}, admins=${adminsCount}.`
              : ""}
          </p>
        </div>
      )}

      {/* Estoque atual */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Estoque atual</h2>
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            agora
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Clientes totais" envelope={data.total_users} />
          <KpiCard
            label="Custo assessor no período"
            envelope={data.agent_cost_cents_today}
            format={(v) => (v === null ? "—" : BRL.format(v / 100))}
          />
          <KpiCard label="Falha mensageria 7d" envelope={data.messaging_failure_rate_7d} suffix="%" />
        </div>
      </section>

      {/* Fluxo no período */}
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Fluxo no período</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Novos clientes" envelope={data.registered_today} />
          <KpiCard label="Ativações" envelope={data.activation} />
          <KpiCard label="Valor entregue" envelope={data.value_delivered} />
          <KpiCard label="WVU" envelope={data.wvu} />
        </div>
      </section>

      {evolution && (
        <AdminDailyEvolutionCard
          series={evolution.series}
          sampleSize={evolution.sample_size}
          sufficientSample={evolution.sufficient_sample}
          formulaVersion={evolution.formula_version}
        />
      )}

      {data.attention?.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="mb-2 font-display text-base font-semibold">Pontos de atenção</h3>
          <ul className="space-y-1 text-sm">
            {data.attention.map((a) => (
              <li key={a.key} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    a.severity === "high"
                      ? "bg-rose-500"
                      : a.severity === "medium"
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                />
                <span className="capitalize">{a.key.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">— {a.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
