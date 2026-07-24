import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";
import { formatDateTime, formatRate } from "@/lib/admin/formulas";

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

function serviceState(service: Service) {
  if (!service.last_run_at) return { label: "Ainda não executado", tone: "neutral" as const };
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
  const healthy = services.filter((item) => serviceState(item).label === "Saudável").length;
  const attention = services.length - healthy;

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
        <div className="mb-4">
          <h2 className="font-semibold">Serviços e rotinas</h2>
          <p className="text-sm text-muted-foreground">Nomes técnicos ficam disponíveis apenas no diagnóstico.</p>
        </div>
        <AdminResponsiveList
          rows={services}
          rowKey={(row) => row.job_key}
          columns={[
            { key: "service", label: "Serviço", render: (row) => dict.job(row.job_key) },
            { key: "status", label: "Estado", render: (row) => serviceState(row).label },
            { key: "last", label: "Última execução", render: (row) => formatDateTime(row.last_run_at) },
            { key: "processed", label: "Processados", render: (row) => row.processed, align: "right" },
            { key: "failed", label: "Falhas", render: (row) => row.failed, align: "right" },
          ]}
        />
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
