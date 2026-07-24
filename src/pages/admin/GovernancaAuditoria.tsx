import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";
import { formatDateTime } from "@/lib/admin/formulas";

type AuditEvent = {
  action: string;
  actor_user_id: string | null;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type Response = {
  events: AuditEvent[];
  instrumentation_started_at: string | null;
};

export default function GovernancaAuditoria() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<Response>("admin_v2_audit_list", { _limit: 200 })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Falha ao carregar auditoria"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar a auditoria" description={error} />;

  const rows = data?.events ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoria" description="Ações administrativas e acessos protegidos registrados de forma rastreável." />

      {rows.length ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <AdminResponsiveList
            rows={rows}
            rowKey={(row, index) => `${row.created_at}-${index}`}
            columns={[
              { key: "when", label: "Quando", render: (row) => formatDateTime(row.created_at) },
              { key: "action", label: "Ação", render: (row) => dict.action(row.action) },
              {
                key: "actor",
                label: "Administrador",
                render: (row) => row.actor_email || (row.actor_user_id ? `ID ${row.actor_user_id.slice(0, 8)}…` : "Sistema"),
              },
              {
                key: "target",
                label: "Alvo",
                render: (row) => row.target_email || (row.target_user_id ? `Cliente ${row.target_user_id.slice(0, 8)}…` : "—"),
              },
            ]}
          />
        </section>
      ) : (
        <EmptyState
          title="A auditoria detalhada começou recentemente"
          description="Ainda não há ações administrativas suficientes para formar um histórico."
        />
      )}
    </div>
  );
}
