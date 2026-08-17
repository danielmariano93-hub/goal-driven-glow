import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { ServiceRow } from "@/components/admin/kit/ServiceRow";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";
import { formatRate } from "@/lib/admin/formulas";

type Service = {
  job_key: string;
  last_run_at: string | null;
  next_run_at: string | null;
  last_ok: boolean | null;
  processed: number;
  failed: number;
  last_error_code: string | null;
};

type Agent = {
  runs: number;
  runs_ok: number;
  runs_error: number;
  success_rate: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
};

type HealthResponse = {
  services: Service[];
  agent: Agent;
};

/** Janela máxima aceitável sem heartbeat antes de tratar como não comprovado. */
const STALE_MS = 24 * 60 * 60 * 1000;

function serviceState(service: Service) {
  if (!service.last_run_at) return { label: "Sem execução comprovada", tone: "critical" as const };
  const age = Date.now() - new Date(service.last_run_at).getTime();
  if (Number.isFinite(age) && age > STALE_MS) {
    return { label: "Sem execução comprovada (24h+)", tone: "critical" as const };
  }
  if (service.last_ok === false || service.failed > 0) return { label: "Atenção", tone: "critical" as const };
  return { label: "Saudável", tone: "positive" as const };
}


export default function OperacaoSaude() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<HealthResponse>("admin_v2_operations_health", { _hours: 24 })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Falha ao carregar a saúde"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar a saúde da operação" description={error} />;

  const services = data?.services ?? [];
  const healthyServices = services.filter((item) => serviceState(item).label === "Saudável");
  const needsAttention = services
    .filter((item) => serviceState(item).label !== "Saudável")
    .sort((a, b) => b.failed - a.failed);
  const healthy = healthyServices.length;
  const attention = needsAttention.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saúde da operação"
        description="Veja rapidamente o que está saudável, o que exige atenção e o que parou de atualizar."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard label="Serviços monitorados" value={services.length} tone="brand" />
        <AdminMetricCard label="Saudáveis" value={healthy} tone="positive" />
        <AdminMetricCard label="Exigem atenção" value={attention} tone={attention ? "critical" : "neutral"} />
        <AdminMetricCard
          label="Sucesso do Nino"
          value={formatRate(data?.agent?.success_rate)}
          detail={`${data?.agent?.runs ?? 0} execuções nas últimas 24h`}
        />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="font-semibold">Serviços e rotinas</h2>
          <p className="text-sm text-muted-foreground">
            Primeiro o que exige atenção. O que está saudável fica recolhido.
          </p>
        </div>

        {needsAttention.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum serviço exige atenção agora.</p>
        ) : (
          <ul>
            {needsAttention.map((row) => (
              <ServiceRow
                key={row.job_key}
                name={dict.job(row.job_key)}
                state={serviceState(row).label}
                tone="danger"
                lastRunAt={row.last_run_at}
                processed={row.processed}
                failed={row.failed}
                reason={row.last_error_code}
              />
            ))}
          </ul>
        )}

        {healthyServices.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Saudáveis ({healthyServices.length})
            </summary>
            <ul className="mt-2">
              {healthyServices.map((row) => (
                <ServiceRow
                  key={row.job_key}
                  name={dict.job(row.job_key)}
                  state="Saudável"
                  tone="success"
                  lastRunAt={row.last_run_at}
                  processed={row.processed}
                  failed={row.failed}
                />
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Desempenho do Nino</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminMetricCard label="Execuções" value={data?.agent?.runs ?? 0} />
          <AdminMetricCard label="Concluídas" value={data?.agent?.runs_ok ?? 0} tone="positive" />
          <AdminMetricCard label="Erros" value={data?.agent?.runs_error ?? 0} tone="critical" />
          <AdminMetricCard
            label="Latência p95"
            value={data?.agent?.p95_ms == null ? "—" : `${Math.round(data.agent.p95_ms)} ms`}
          />
        </div>
      </section>
    </div>
  );
}
