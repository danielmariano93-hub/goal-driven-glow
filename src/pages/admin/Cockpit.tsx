import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { KpiCard } from "@/components/admin/KpiCard";
import { callAdminRpc, type Envelope } from "@/lib/admin/adminRpc";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type MetricsHealth = {
  last_refresh_at: string | null;
  stale: boolean;
  auth_users: number;
  profiles: number;
  pseudonyms: number;
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
  series_wvu_14d: Array<{ day: string; value: number }>;
};

export default function Cockpit() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<CockpitData>("admin_v2_cockpit")
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro ao carregar Cockpit" description={error} />;
  if (!data) return null;

  const health = data.metrics_health;
  const contractsMismatch = !!health && (health.auth_users !== health.profiles || health.auth_users !== health.pseudonyms);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cockpit"
        description="Métricas live do Meu Nino — cadastros, ativação, valor entregue e saúde dos contratos."
      />

      {(health?.stale || contractsMismatch) && (
        <div className="rounded-2xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Atenção à integridade dos indicadores</p>
          <p className="mt-1">
            {health?.stale ? "A agregação programada está atrasada. Os cartões abaixo usam fontes live sempre que possível. " : ""}
            {contractsMismatch
              ? `Há divergência entre autenticações (${health?.auth_users}), perfis (${health?.profiles}) e pseudônimos (${health?.pseudonyms}).`
              : ""}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Cadastros hoje" envelope={data.registered_today} />
        <KpiCard label="Usuários totais" envelope={data.total_users} />
        <KpiCard label="WVU (7d)" envelope={data.wvu} />
        <KpiCard label="Ativações hoje" envelope={data.activation} />
        <KpiCard label="Valor entregue" envelope={data.value_delivered} />
        <KpiCard
          label="Custo assessor hoje"
          envelope={data.agent_cost_cents_today}
          format={(v) => (v === null ? "—" : BRL.format(v / 100))}
        />
        <KpiCard label="Falha mensageria 7d" envelope={data.messaging_failure_rate_7d} suffix="%" />
      </div>

      {data.attention?.length > 0 && (
        <div className="surface-card p-4">
          <h3 className="mb-2 font-display text-base font-semibold">Pontos de atenção</h3>
          <ul className="space-y-1 text-sm">
            {data.attention.map((a) => (
              <li key={a.key} className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${a.severity === "high" ? "bg-rose-500" : a.severity === "medium" ? "bg-amber-500" : "bg-emerald-500"}`} />
                <span className="capitalize">{a.key.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground">— {a.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="surface-card p-4">
        <h3 className="mb-3 font-display text-base font-semibold">WVU — últimos 14 dias</h3>
        {data.series_wvu_14d?.length ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series_wvu_14d}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState title="Sem histórico ainda" description="Aguardando eventos de valor e uso significativo." />
        )}
      </div>
    </div>
  );
}
