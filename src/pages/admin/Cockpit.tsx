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
import { IncidentStrip } from "@/components/admin/kit/IncidentStrip";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { buildIncidents } from "@/lib/admin/incidents";
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

type AiOpsSnapshot = {
  contract_version: string;
  period: { from: string; to: string; timezone: string };
  totals: {
    interactions: number;
    unique_users: number;
    conversation_threads: number;
    ai_calls: number;
    tokens_in: number;
    tokens_out: number;
    tokens_total: number;
    tokens_per_interaction: number | null;
    tokens_per_ai_call: number | null;
    ai_avg_latency_ms: number | null;
    ai_p50_latency_ms: number | null;
    ai_p95_latency_ms: number | null;
    run_avg_latency_ms: number | null;
    run_p50_latency_ms: number | null;
    run_p95_latency_ms: number | null;
    perceived_p50_latency_ms: number | null;
    perceived_p95_latency_ms: number | null;
    provider: string | null;
    model: string | null;
  };
  coverage?: { days_with_runs?: number; days_with_ai_usage?: number; perceived_latency_available?: boolean };
};

/** Falha de envio em janela fixa de 7 dias, independente do filtro de período. */
type Failure7d = {
  window_days: number;
  total: number;
  failed: number;
  rate: number | null;
  measured_at: string;
};

// `YYYY-MM-DD` is already a business date. Parsing it with new Date() treats it
// as UTC and used to render one day earlier in Sao Paulo (18/09 appeared as 17/09).
const dayLabel = (iso: string) => {
  const hit = String(iso ?? "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return hit ? `${hit[3]}/${hit[2]}` : String(iso ?? "");
};

const dayKeySP = (value: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return y && m && d ? `${y}-${m}-${d}` : "";
};

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
    const key = dayKeySP(row.created_at ?? "");
    if (!key) continue;
    const bucket = byDay.get(key) ?? { day: key, enviadas: 0, entregues: 0, falhas: 0 };
    if (row.status === "failed") bucket.falhas += 1;
    else if (row.status === "delivered") bucket.entregues += 1;
    else if (row.status === "sent") bucket.enviadas += 1;
    byDay.set(key, bucket);
  }
  return Array.from(byDay.values())
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((b) => ({ ...b, label: dayLabel(b.day) }));
}

const seconds = (value: number | null | undefined) => value == null ? "—" : `${(Number(value) / 1000).toFixed(1)}s`;

export default function Cockpit() {
  const [preset, setPreset] = useState<PeriodPresetKey>("30d");
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset("30d"));
  const [data, setData] = useState<CockpitData | null>(null);
  const [evolution, setEvolution] = useState<DailyEvolution | null>(null);
  const [universe, setUniverse] = useState<AdminUniverse | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [failure7d, setFailure7d] = useState<Failure7d | null>(null);
  const [aiOps, setAiOps] = useState<AiOpsSnapshot | null>(null);
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
      callAdminRpc<Failure7d>("admin_v2_messaging_failure_7d"),
      callAdminRpc<AiOpsSnapshot>("admin_ai_ops_snapshot", {
        p_from: range.from, p_to: range.to, p_workload: "AGENT_CONVERSATION",
      }),
    ]).then(([cockpitRes, evoRes, universeRes, msgRes, failRes, aiRes]) => {
      if (cancelled) return;
      if (cockpitRes.status === "fulfilled") setData(cockpitRes.value);
      else setError(adminErrorMessage(cockpitRes.reason, "Falha ao carregar a visão geral"));
      setEvolution(evoRes.status === "fulfilled" ? evoRes.value : null);
      setUniverse(universeRes.status === "fulfilled" ? universeRes.value : null);
      setMessages(msgRes.status === "fulfilled" ? msgRes.value : []);
      setFailure7d(failRes.status === "fulfilled" ? failRes.value : null);
      setAiOps(aiRes.status === "fulfilled" ? aiRes.value : null);
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

  const incidentList = buildIncidents({
    status: platformStatus,
    universe,
    attention: data.attention,
    messagingFailureRate: failure7d?.rate ?? null,
  });

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
  const a = aiOps?.totals;

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

      <section aria-labelledby="cockpit-incidentes">
        <h2 id="cockpit-incidentes" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Precisa da sua atenção
        </h2>
        <IncidentStrip incidents={incidentList} emptyLabel="Nada exige ação agora." />
      </section>

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
            label="Clientes usando o Nino"
            value={a ? INT.format(a.unique_users) : "—"}
            spark={activeSpark}
            polarity="higher_is_better"
            deltaPct={halfOverHalf(activeSpark)}
            hint="Clientes reais com pelo menos uma interação do Nino no período selecionado."
          />
          <MetricTile
            label="Custo do assessor"
            value={costCents === null ? "—" : BRL.format(costCents / 100)}
            polarity="lower_is_better"
            hint="Quanto a inteligência do Nino custou no período."
          />
        </div>
      </section>

      <section aria-labelledby="cockpit-ai">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="cockpit-ai" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IA e eficiência</h2>
            <p className="mt-1 text-xs text-muted-foreground">Consumo e latência medidos diretamente na telemetria de produção.</p>
          </div>
          {a?.provider && <p className="text-xs text-muted-foreground">{a.provider}{a.model ? ` · ${a.model}` : ""}</p>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricTile label="Interações do Nino" value={a ? INT.format(a.interactions) : "—"} hint={a ? `${INT.format(a.ai_calls)} chamadas de IA · ${INT.format(a.conversation_threads)} threads` : "Sem telemetria"} />
          <MetricTile label="Tokens consumidos" value={a ? INT.format(a.tokens_total) : "—"} hint={a ? `Entrada ${INT.format(a.tokens_in)} · saída ${INT.format(a.tokens_out)}` : "Sem telemetria"} polarity="lower_is_better" />
          <MetricTile label="Tokens / interação" value={a?.tokens_per_interaction == null ? "—" : INT.format(a.tokens_per_interaction)} hint="Tokens do provider divididos pelas interações do Nino." polarity="lower_is_better" />
          <MetricTile label="Latência IA P50" value={seconds(a?.ai_p50_latency_ms)} hint="Tempo mediano somente do modelo/provider." polarity="lower_is_better" />
          <MetricTile label="Latência IA P95" value={seconds(a?.ai_p95_latency_ms)} hint="95% das chamadas de IA ficam abaixo deste tempo." polarity="lower_is_better" />
          <MetricTile label="Tempo total P95" value={seconds(a?.run_p95_latency_ms)} hint="Tempo total do run no backend; não é latência percebida ponta a ponta." polarity="lower_is_better" />
        </div>
        {aiOps?.coverage && Number(aiOps.coverage.days_with_runs ?? 0) > Number(aiOps.coverage.days_with_ai_usage ?? 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Cobertura histórica parcial: há dias com interações registradas sem telemetria de tokens. O painel não preenche esses dias artificialmente.
          </p>
        )}
      </section>

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
                : "Atividade vem dos runs reais do Nino, não de eventos de produto defasados."}
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
                { key: "enviadas", label: "Enviadas sem confirmação", tone: "primary" },
                { key: "falhas", label: "Falhas", tone: "danger" },
              ]}
              caption="Dias fechados em America/Sao_Paulo, incluindo integralmente hoje e ontem."
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
          <li>
            Falha de envio nos últimos 7 dias corridos: {failure7d?.failed ?? 0} de{" "}
            {failure7d?.total ?? 0} mensagens ({failure7d?.rate ?? 0}%)
          </li>
          <li>Valor entregue: {data.value_delivered?.value ?? "—"}</li>
          {a && <li>Interações do Nino: {INT.format(a.interactions)} · chamadas de IA: {INT.format(a.ai_calls)} · tokens: {INT.format(a.tokens_total)}</li>}
        </ul>
      </TechnicalDetails>
    </div>
  );
}
