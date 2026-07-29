import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { callAdminRpc, withPeriod, withDateRange, adminErrorMessage, type Envelope } from "@/lib/admin/adminRpc";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { AdminDailyEvolutionCard } from "@/components/admin/AdminDailyEvolutionCard";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";
import { dict } from "@/lib/admin/displayDictionary";
import { Link } from "react-router-dom";
import { StatusChip } from "@/components/admin/StatusChip";
import { mapWhatsAppStatus, mapAgentStatus } from "@/lib/admin/statusMapper";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";

/** Faixa operacional: o que precisa de ação agora, com atalho direto. */
function OperationStrip() {
  const { data } = useAdminPlatformStatus();
  if (!data) return null;

  const failingJobs = Object.values(data.jobs ?? {}).filter((j) => j?.status === "failing" || j?.status === "delayed").length;
  const waConnected = data.whatsapp?.status === "connected";

  return (
    <section className="grid gap-3 md:grid-cols-3">
      <div className="surface-card flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Canal WhatsApp</p>
          <div className="mt-1"><StatusChip view={mapWhatsAppStatus(data.whatsapp?.status)} size="sm" /></div>
        </div>
        {!waConnected && (
          <Link
            to="/admin/operacao/whatsapp"
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Reconectar
          </Link>
        )}
      </div>

      <div className="surface-card flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Assessor</p>
          <div className="mt-1"><StatusChip view={mapAgentStatus(data.agent?.status)} size="sm" /></div>
        </div>
        <Link to="/admin/operacao/assistente" className="shrink-0 text-xs underline text-muted-foreground">Ver</Link>
      </div>

      <div className="surface-card flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Automações e fila</p>
          <p className="mt-1 text-sm font-medium">
            {failingJobs > 0 ? `${failingJobs} com problema` : "Todas em dia"}
            {data.outbox?.failed ? ` · ${data.outbox.failed} envios falhos` : ""}
          </p>
        </div>
        <Link to="/admin/operacao/saude" className="shrink-0 text-xs underline text-muted-foreground">Ver</Link>
      </div>
    </section>
  );
}


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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    ]).then(([cockpitRes, evoRes]) => {
      if (cancelled) return;
      if (cockpitRes.status === "fulfilled") {
        setData(cockpitRes.value);
      } else {
        setError(adminErrorMessage(cockpitRes.reason, "Falha ao carregar Cockpit"));
      }
      if (evoRes.status === "fulfilled") {
        setEvolution(evoRes.value);
      } else {
        setEvolution(null);
        // eslint-disable-next-line no-console
        console.warn("[admin_v2_daily_evolution]", adminErrorMessage(evoRes.reason, "falha ao carregar evolução"));
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro ao carregar Cockpit" description={error} />;
  if (!data) return null;

  const health = data.metrics_health;
  const clientsCount = health?.client_users ?? null;
  const adminsCount = health?.platform_admins ?? null;
  const testCount = health?.test_users ?? 0;
  const contractsMismatch = health && clientsCount !== null && adminsCount !== null
    && health.auth_users !== clientsCount + adminsCount + testCount;

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
            {health?.stale ? "A agregação está atrasada; os cartões abaixo usam dados ao vivo. " : ""}
            {contractsMismatch ? "Há divergência entre contas cadastradas e clientes contabilizados." : ""}
          </p>
        </div>
      )}

      <OperationStrip />

      {/* Situação atual */}
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Situação atual</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Clientes ativos na base" envelope={data.total_users} />
          <KpiCard
            label="Custo do assessor no período"
            envelope={data.agent_cost_cents_today}
            format={(v) => (v === null ? "—" : BRL.format(v / 100))}
          />
          <KpiCard label="Mensagens que falharam (7 dias)" envelope={data.messaging_failure_rate_7d} suffix="%" />
        </div>
      </section>

      {/* Movimento no período */}
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Movimento no período</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Novos clientes" envelope={data.registered_today} />
          <KpiCard label="Clientes que começaram a usar" envelope={data.activation} />
          <KpiCard label="Clientes usando na semana" envelope={data.wvu} />
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
                <span>{dict.feature(a.key)}</span>
                <span className="text-muted-foreground">— {a.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}
