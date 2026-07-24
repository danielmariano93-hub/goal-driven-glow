import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";

type AuditEvent = {
  action: string;
  actor_admin_id: string;
  target_kind: string | null;
  created_at: string;
};

export default function GovernancaAuditoria() {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ events: AuditEvent[] }>("admin_v2_audit_list", { _limit: 200 })
      .then((r) => setRows(r.events))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoria" description="Ações administrativas registradas (imutáveis)." />
      <div className="surface-card p-4 overflow-x-auto">
        {rows?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Quando</th>
                <th>Ação</th>
                <th>Ator</th>
                <th>Alvo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2 text-xs">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                  <td>{r.action}</td>
                  <td className="font-mono text-xs">{r.actor_admin_id?.slice(0, 8)}…</td>
                  <td>{r.target_kind ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Sem eventos" />
        )}
      </div>
    </div>
  );
}
