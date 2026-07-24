import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";

type Row = {
  day: string;
  surface: string;
  runs: number;
  runs_ok: number;
  runs_error: number;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
  latency_p50: number | null;
  latency_p95: number | null;
};

export default function OperacaoAssistente() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ daily: Row[] }>("admin_v2_assistant_health", { _days: 14 })
      .then((r) => setRows(r.daily))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessor"
        description="Custo, latência e sucesso do assessor. Fórmula v1."
      />
      <div className="surface-card p-4 overflow-x-auto">
        {rows?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Dia</th>
                <th>Surface</th>
                <th className="text-right">Runs</th>
                <th className="text-right">OK</th>
                <th className="text-right">Erro</th>
                <th className="text-right">Tokens in</th>
                <th className="text-right">Tokens out</th>
                <th className="text-right">Custo (R$)</th>
                <th className="text-right">P50</th>
                <th className="text-right">P95</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2 text-xs">{r.day}</td>
                  <td>{r.surface}</td>
                  <td className="text-right tabular-nums">{r.runs}</td>
                  <td className="text-right tabular-nums">{r.runs_ok}</td>
                  <td className="text-right tabular-nums">{r.runs_error}</td>
                  <td className="text-right tabular-nums">{r.tokens_in.toLocaleString("pt-BR")}</td>
                  <td className="text-right tabular-nums">{r.tokens_out.toLocaleString("pt-BR")}</td>
                  <td className="text-right tabular-nums">
                    {(r.cost_cents / 100).toFixed(2)}
                  </td>
                  <td className="text-right tabular-nums">{r.latency_p50 ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.latency_p95 ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Sem execuções" />
        )}
      </div>
    </div>
  );
}
