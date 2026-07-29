import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { callAdminRpc, withPeriod, withDateRange, adminErrorMessage, type Envelope } from "@/lib/admin/adminRpc";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { AdminDailyEvolutionCard } from "@/components/admin/AdminDailyEvolutionCard";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { IncidentGroup } from "@/components/admin/AttentionCard";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { buildIncidents, groupBySeverity } from "@/lib/admin/incidents";
import { universeCaption, universeNotes, type AdminUniverse } from "@/lib/admin/universe";


const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type MetricsHealth = {
  last_refresh_at: string | null;
  stale: boolean;
  auth_users: number;
  profiles: number;
  pseudonyms: number;
  client_users?: number;
  platform_admins?: number;
  test_users?: number;
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
  const [universe, setUniverse] = useState<AdminUniverse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: platformStatus } = useAdminPlatformStatus();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Contratos distintos: admin_v2_cockpit aceita apenas (_from,_to);
    // admin_v2_daily_evolution aceita (_from,_to,_tz). Usar allSettled para que
    // uma falha em uma carga não zere a tela toda.
    Promise.allSettled([
      callAdminRpc<CockpitData>("admin_v2_cockpit", withDateRange(range)),
      callAdminRpc<DailyEvolution>("admin_v2_daily_evolution", withPeriod(range)),
      callAdminRpc<AdminUniverse>("admin_v2_metrics_universe"),
    ]).then(([cockpitRes, evoRes, universeRes]) => {
      if (cancelled) return;
      if (cockpitRes.status === "fulfilled") {
        setData(cockpitRes.value);
      } else {
        setError(adminErrorMessage(cockpitRes.reason, "Falha ao carregar a visão geral"));
      }
      if (evoRes.status === "fulfilled") {
        setEvolution(evoRes.value);
      } else {
        setEvolution(null);
        // eslint-disable-next-line no-console
        console.warn("[admin_v2_daily_evolution]", adminErrorMessage(evoRes.reason, "falha ao carregar evolução"));
      }
      setUniverse(universeRes.status === "fulfilled" ? universeRes.value : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar a visão geral" description={error} />;
  if (!data) return null;

  const health = data.metrics_health;
  const clientsCount = health?.client_users ?? null;
  const adminsCount = health?.platform_admins ?? null;
  const testCount = health?.test_users ?? 0;
  const contractsMismatch = health && clientsCount !== null && adminsCount !== null
    && health.auth_users !== clientsCount + adminsCount + testCount;

  const incidents = groupBySeverity(
    buildIncidents({
      status: platformStatus,
      universe,
      attention: data.attention,
      messagingFailureRate: data.messaging_failure_rate_7d?.value ?? null,
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
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
            {health?.stale ? "A agregação está atrasada; os cartões abaixo usam dados ao vivo. " : ""}
            {contractsMismatch ? "Há divergência entre contas cadastradas e clientes contabilizados." : ""}
          </p>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
          O que precisa da sua atenção hoje
        </h2>
        <div className="space-y-4">
          <IncidentGroup
            severity="critical"
            incidents={incidents.critical}
            emptyLabel={incidents.warning.length ? undefined : "Nada exige ação imediata agora."}
          />
          <IncidentGroup severity="warning" incidents={incidents.warning} />
          <IncidentGroup severity="healthy" incidents={incidents.healthy} />
        </div>
      </section>

      {/* Situação atual */}
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Situação atual</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Clientes ativos na base" metaKey="total_users" envelope={data.total_users} />
          <KpiCard
            label="Custo do assessor no período"
            metaKey="agent_cost_cents_today" envelope={data.agent_cost_cents_today}
            format={(v) => (v === null ? "—" : BRL.format(v / 100))}
          />
          <KpiCard label="Mensagens que falharam (7 dias)" metaKey="messaging_failure_rate_7d" envelope={data.messaging_failure_rate_7d} suffix="%" />
        </div>
      </section>

      {/* Movimento no período */}
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Movimento no período</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Novos clientes" metaKey="registered_today" envelope={data.registered_today} />
          <KpiCard label="Clientes que começaram a usar" metaKey="activation" envelope={data.activation} />
          <KpiCard label="Clientes usando na semana" metaKey="wvu" envelope={data.wvu} />
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

      <TechnicalDetails label="Como estes números são contados">
        <p>{universeCaption(universe)}</p>
        <ul className="mt-2 space-y-1">
          {universeNotes(universe).map((n) => (
            <li key={n.id}>
              <strong>{n.title}.</strong> {n.detail}
            </li>
          ))}
        </ul>
      </TechnicalDetails>


    </div>
  );
}
