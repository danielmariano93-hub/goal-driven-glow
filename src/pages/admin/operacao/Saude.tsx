import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type Heartbeat = {
  job_key: string;
  last_run_at: string | null;
  last_ok: boolean | null;
  processed: number;
  failed: number;
};

type AgentDay = {
  surface: string;
  runs: number;
  runs_ok: number;
  runs_error: number;
  latency_p50: number | null;
  latency_p95: number | null;
};

export default function OperacaoSaude() {
  const [data, setData] = useState<{ heartbeats: Heartbeat[]; today_agent: AgentDay[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ heartbeats: Heartbeat[]; today_agent: AgentDay[] }>("admin_v2_operations_health")
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Saúde da operação" description="Jobs, agregações e latência do assessor." />

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Heartbeats de jobs</h3>
        {data?.heartbeats.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Job</th>
                <th>Último run</th>
                <th>Status</th>
                <th className="text-right">Processados</th>
                <th className="text-right">Falhas</th>
              </tr>
            </thead>
            <tbody>
              {data.heartbeats.map((h) => (
                <tr key={h.job_key} className="border-t border-border/40">
                  <td className="py-2">{dict.job(h.job_key)}</td>
                  <td className="text-xs">
                    {h.last_run_at ? new Date(h.last_run_at).toLocaleString("pt-BR") : "nunca"}
                  </td>
                  <td>
                    <span
                      className={`inline-block h-2 w-2 rounded-full mr-1 ${
                        h.last_ok === true
                          ? "bg-emerald-500"
                          : h.last_ok === false
                          ? "bg-rose-500"
                          : "bg-neutral-400"
                      }`}
                    />
                    {h.last_ok === null ? "—" : h.last_ok ? "ok" : "erro"}
                  </td>
                  <td className="text-right tabular-nums">{h.processed}</td>
                  <td className="text-right tabular-nums">{h.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Sem jobs registrados" />
        )}
      </div>

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Assessor hoje</h3>
        {data?.today_agent.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Surface</th>
                <th className="text-right">Runs</th>
                <th className="text-right">OK</th>
                <th className="text-right">Erro</th>
                <th className="text-right">P50 (ms)</th>
                <th className="text-right">P95 (ms)</th>
              </tr>
            </thead>
            <tbody>
              {data.today_agent.map((a, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2">{dict.surface(a.surface)}</td>
                  <td className="text-right tabular-nums">{a.runs}</td>
                  <td className="text-right tabular-nums">{a.runs_ok}</td>
                  <td className="text-right tabular-nums">{a.runs_error}</td>
                  <td className="text-right tabular-nums">{a.latency_p50 ?? "—"}</td>
                  <td className="text-right tabular-nums">{a.latency_p95 ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Sem execuções hoje" />
        )}
      </div>
    </div>
  );
}
