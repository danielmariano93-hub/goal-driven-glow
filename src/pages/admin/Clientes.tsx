import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";

type Client = {
  pseudo_id: string;
  first_event_at: string | null;
  last_event_at: string | null;
  total_events: number;
  significant_actions: number;
  lifecycle_status: string;
};

export default function Clientes() {
  const [rows, setRows] = useState<Client[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ clients: Client[] }>("admin_v2_clients_list", { _limit: 200 })
      .then((r) => setRows(r.clients))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Lista pseudonimizada. Sem nome, e-mail ou telefone."
      />
      <div className="surface-card p-4 overflow-x-auto">
        {rows?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Pseudo ID</th>
                <th>Status</th>
                <th>Primeiro evento</th>
                <th>Último evento</th>
                <th className="text-right">Eventos</th>
                <th className="text-right">Ações significativas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pseudo_id} className="border-t border-border/40">
                  <td className="py-2 font-mono text-xs">{r.pseudo_id.slice(0, 8)}…</td>
                  <td>
                    <span
                      className={`inline-block h-2 w-2 rounded-full mr-1 ${
                        r.lifecycle_status === "active" ? "bg-emerald-500" : "bg-neutral-400"
                      }`}
                    />
                    {r.lifecycle_status}
                  </td>
                  <td className="text-xs">
                    {r.first_event_at ? new Date(r.first_event_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="text-xs">
                    {r.last_event_at ? new Date(r.last_event_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="text-right tabular-nums">{r.total_events}</td>
                  <td className="text-right tabular-nums">{r.significant_actions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Sem clientes ainda" />
        )}
      </div>
    </div>
  );
}
