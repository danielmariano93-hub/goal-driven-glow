import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { usePlatformPermissions } from "@/hooks/usePlatformPermissions";
import { dict } from "@/lib/admin/displayDictionary";
import { formatDateTime } from "@/lib/admin/formulas";

type Client = {
  pseudo_id: string;
  first_event_at: string | null;
  last_event_at: string | null;
  total_events: number;
  significant_actions: number;
  lifecycle_status: string;
};

type Identity = {
  pseudo_id: string;
  display_name: string | null;
  email: string | null;
};

export default function Clientes() {
  const { can, loading: permissionsLoading } = usePlatformPermissions();
  const [rows, setRows] = useState<Client[] | null>(null);
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ clients: Client[] }>("admin_v2_clients_list", { _limit: 200 })
      .then(async (response) => {
        setRows(response.clients);
        const ids = response.clients.map((client) => client.pseudo_id);
        if (!ids.length || permissionsLoading) return;

        if (can("clients.identity.read")) {
          const result = await callAdminRpc<{ clients: Identity[] }>("admin_v2_clients_identity", { _pseudo_ids: ids });
          setIdentities(Object.fromEntries(result.clients.map((item) => [item.pseudo_id, item])));
        } else if (can("clients.identity.masked")) {
          const result = await callAdminRpc<{ clients: Identity[] }>("admin_v2_clients_identity_masked", { _pseudo_ids: ids });
          setIdentities(Object.fromEntries(result.clients.map((item) => [item.pseudo_id, item])));
        }
      })
      .catch((e) => setError(e?.message ?? "Falha ao carregar clientes"))
      .finally(() => setLoading(false));
  }, [permissionsLoading]);

  const clients = useMemo(() => rows ?? [], [rows]);

  if (loading || permissionsLoading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar os clientes" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Acompanhe a jornada e administre contas sem acessar a vida financeira de ninguém."
      />

      {clients.length ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <AdminResponsiveList
            rows={clients}
            rowKey={(row) => row.pseudo_id}
            columns={[
              {
                key: "client",
                label: "Cliente",
                render: (row) => {
                  const identity = identities[row.pseudo_id];
                  return (
                    <div>
                      <p className="font-semibold">{identity?.display_name || `Cliente ${row.pseudo_id.slice(0, 6)}`}</p>
                      <p className="text-xs text-muted-foreground">{identity?.email || "Identidade protegida"}</p>
                    </div>
                  );
                },
              },
              { key: "status", label: "Status", render: (row) => dict.status(row.lifecycle_status) },
              { key: "first", label: "Primeiro evento", render: (row) => formatDateTime(row.first_event_at) },
              { key: "last", label: "Última atividade", render: (row) => formatDateTime(row.last_event_at) },
              { key: "events", label: "Eventos", render: (row) => row.total_events, align: "right" },
              { key: "actions", label: "Ações relevantes", render: (row) => row.significant_actions, align: "right" },
            ]}
          />
        </section>
      ) : (
        <EmptyState title="Nenhum cliente encontrado" description="Os novos cadastros aparecerão aqui." />
      )}
    </div>
  );
}
