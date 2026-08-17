import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { MetricTile } from "@/components/admin/kit/MetricTile";
import { TrendChart } from "@/components/admin/kit/TrendChart";
import { callAdminRpc, withPeriod, withDateRange, adminErrorMessage, type Envelope } from "@/lib/admin/adminRpc";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { IncidentGroup } from "@/components/admin/AttentionCard";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { buildIncidents, groupBySeverity } from "@/lib/admin/incidents";
import { universeCaption, universeNotes, type AdminUniverse } from "@/lib/admin/universe";
import { fetchMessages, type MessageRow } from "@/lib/admin/messageCenter";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const INT = new Intl.NumberFormat("pt-BR");

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

type EvolutionPoint = {
  day: string;
  new_clients: number;
  activated: number;
  active_unique: number;
  went_dormant: number;
  cumulative_clients: number;
  first_financial_action: number;
};

type DailyEvolution = {
  series: EvolutionPoint[];
  sample_size: number;
  sufficient_sample: boolean;
  formula_version: string;
};

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })
    .format(new Date(iso));

/** Variação percentual entre a segunda e a primeira metade da série. */
function halfOverHalf(values: number[]): number | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const before = sum(values.slice(0, mid));
  const after = sum(values.slice(mid));
  if (before === 0) return after === 0 ? 0 : null;
  return Math.round(((after - before) / before) * 1000) / 10;
}

function messagingSeries(rows: MessageRow[]) {
  const byDay = new Map<string, { day: string; enviadas: number; entregues: number; falhas: number }>();
  for (const row of rows) {
    const key = (row.created_at ?? "").slice(0, 10);
    if (!key) continue;
    const bucket = byDay.get(key) ?? { day: key, enviadas: 0, entregues: 0, falhas: 0 };
    if (row.status === "failed") bucket.falhas += 1;
    else if (row.status === "delivered") { bucket.entregues += 1; bucket.enviadas += 1; }
    else if (row.status === "sent") bucket.enviadas += 1;
    byDay.set(key, bucket);
  }
  return Array.from(byDay.values())
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((b) => ({ ...b, label: dayLabel(b.day) }));
}

export default function Cockpit() {
  const [preset, setPreset] = useState<PeriodPresetKey>("30d");
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset("30d"));
  const [data, setData] = useState<CockpitData | null>(null);
  const [evolution, setEvolution] = useState<DailyEvolution | null>(null);
  const [universe, setUniverse] = useState<AdminUniverse | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: platformStatus } = useAdminPlatformStatus();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.allSettled([
      callAdminRpc<CockpitData>("admin_v2_cockpit", withDateRange(range)),
      callAdminRpc<DailyEvolution>("admin_v2_daily_evolution", withPeriod(range)),
      callAdminRpc<AdminUniverse>("admin_v2_metrics_universe"),
      fetchMessages({ from: range.from, to: range.to, limit: 500 }),
    ]).then(([cockpitRes, evoRes, universeRes, msgRes]) => {
      if (cancelled) return;
      if (cockpitRes.status === "fulfilled") setData(cockpitRes.value);
      else setError(adminErrorMessage(cockpitRes.reason, "Falha ao carregar a visão geral"));
      setEvolution(evoRes.status === "fulfilled" ? evoRes.value : null);
      setUniverse(universeRes.status === "fulfilled" ? universeRes.value : null);
      setMessages(msgRes.status === "fulfilled" ? msgRes.value : []);
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

  const series = evolution?.series ?? [];
  const growthChart = series.map((p) => ({
    label: dayLabel(p.day),
    novos: p.new_clients,
    ativados: p.activated,
    ativos: p.active_unique,
  }));
  const msgChart = messagingSeries(messages);

  const newSpark = series.map((p) => p.new_clients);
  const activeSpark = series.map((p) => p.active_unique);
  const baseSpark = series.map((p) => p.cumulative_clients);

  const costCents = data.agent_cost_cents_today?.value ?? null;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Visão geral"
        description="O que exige ação agora, seguido dos números que mostram para onde o Meu Nino está indo."
        actions={
          <AdminDateFilter
            preset={preset}
            value={range}
            onChange={({ preset: p, range: r }) => { setPreset(p); setRange(r); }}
          />
        }
      />

      {(health?.stale || contractsMismatch) && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
          <p className="font-semibold">Atenção à integridade dos indicadores</p>
          <p className="mt-1 text-muted-foreground">
            {health?.stale ? "A agregação está atrasada; os cartões abaixo usam dados ao vivo. " : ""}
            {contractsMismatch ? "Há divergência entre contas cadastradas e clientes contabilizados." : ""}
          </p>
        </div>
      )}

      {/* 1. Algo está quebrado? */}
      <section aria-labelledby="cockpit-incidentes">
        <h2 id="cockpit-incidentes" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Precisa da sua atenção
        </h2>
        <div className="space-y-3">
          <IncidentGroup
            severity="critical"
            incidents={incidents.critical}
            emptyLabel={incidents.warning.length ? undefined : "Nada exige ação imediata agora."}
          />
          <IncidentGroup severity="warning" incidents={incidents.warning} />
          <IncidentGroup severity="healthy" incidents={incidents.healthy} />
        </div>
      </section>

      {/* 2. O negócio está crescendo? */}
      <section aria-labelledby="cockpit-numeros">
        <h2 id="cockpit-numeros" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Os quatro números do período
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Clientes na base"
            value={data.total_users?.value === null || data.total_users?.value === undefined ? "—" : INT.format(data.total_users.value)}
            spark={baseSpark}
            polarity="higher_is_better"
            deltaPct={halfOverHalf(newSpark)}
            hint="Total de clientes reais, sem administradores."
            emphasis
          />
          <MetricTile
            label="Novos no período"
            value={data.registered_today?.value === null || data.registered_today?.value === undefined ? "—" : INT.format(data.registered_today.value)}
            spark={newSpark}
            polarity="higher_is_better"
            deltaPct={halfOverHalf(newSpark)}
            hint="Cadastros concluídos dentro do período selecionado."
          />
          <MetricTile
            label="Usando na semana"
            value={data.wvu?.value === null || data.wvu?.value === undefined ? "—" : INT.format(data.wvu.value)}
            spark={activeSpark}
            polarity="higher_is_better"
            deltaPct={halfOverHalf(activeSpark)}
            hint="Clientes com pelo menos uma ação financeira na semana."
          />
          <MetricTile
            label="Custo do assessor"
            value={costCents === null ? "—" : BRL.format(costCents / 100)}
            polarity="lower_is_better"
            hint="Quanto a inteligência do Nino custou no período."
          />
        </div>
      </section>

      {/* 3. Para onde está indo? */}
      <section aria-labelledby="cockpit-tendencia" className="space-y-4">
        <h2 id="cockpit-tendencia" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tendência
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Clientes e ativação</p>
            <TrendChart
              data={growthChart}
              xKey="label"
              series={[
                { key: "novos", label: "Novos clientes", tone: "primary" },
                { key: "ativados", label: "Começaram a usar", tone: "success" },
                { key: "ativos", label: "Ativos no dia", tone: "muted" },
              ]}
              caption={evolution && !evolution.sufficient_sample
                ? `Amostra pequena (${evolution.sample_size} clientes): leia a tendência com cautela.`
                : undefined}
              emptyLabel="Sem movimento de clientes no período."
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Entrega de mensagens</p>
            <TrendChart
              data={msgChart}
              xKey="label"
              kind="bar"
              series={[
                { key: "entregues", label: "Entregues", tone: "success" },
                { key: "enviadas", label: "Enviadas", tone: "primary" },
                { key: "falhas", label: "Falhas", tone: "danger" },
              ]}
              caption="Detalhe por mensagem e reprocessamento ficam em Comunicações › Mensagens."
              emptyLabel="Nenhuma mensagem no período."
            />
          </div>
        </div>
      </section>

      <TechnicalDetails label="Como estes números são contados">
        <p>{universeCaption(universe)}</p>
        <ul className="mt-2 space-y-1">
          {universeNotes(universe).map((n) => (
            <li key={n.id}>
              <strong>{n.title}.</strong> {n.detail}
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1">
          <li>Clientes que começaram a usar no período: {INT.format(data.activation?.value ?? 0)}</li>
          <li>Falha de mensagens (7 dias): {data.messaging_failure_rate_7d?.value ?? "—"}%</li>
          <li>Valor entregue: {data.value_delivered?.value ?? "—"}</li>
        </ul>
      </TechnicalDetails>
    </div>
  );
}
