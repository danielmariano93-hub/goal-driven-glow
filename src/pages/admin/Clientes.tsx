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
  registered_at: string;
  onboarding_completed_at: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
  total_events: number;
  significant_actions: number;
  has_financial_data: boolean;
  lifecycle_status: string;
};

type Identity = {
  pseudo_id: string;
  display_name: string | null;
  email: string | null;
};

type ClientResponse = {
  clients: Client[];
  totals?: { registered: number; with_profile: number; with_financial_data: number };
  measured_at?: string;
};

export default function Clientes() {
  const { can, loading: permissionsLoading } = usePlatformPermissions();
  const [rows, setRows] = useState<Client[] | null>(null);
  const [totals, setTotals] = useState<ClientResponse["totals"]>();
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (permissionsLoading) return;
    setLoading(true);
    callAdminRpc<ClientResponse>("admin_v2_clients_list", { _limit: 200 })
      .then(async (response) => {
        setRows(response.clients);
        setTotals(response.totals);
        const ids = response.clients.map((client) => client.pseudo_id);
        if (!ids.length) return;

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
        description="Todo cadastro aparece imediatamente, mesmo antes do primeiro lançamento ou conversa com o Nino."
      />

      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Cadastrados</p><p className="mt-1 text-2xl font-semibold">{totals.registered}</p></div>
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Com perfil</p><p className="mt-1 text-2xl font-semibold">{totals.with_profile}</p></div>
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Com dados financeiros</p><p className="mt-1 text-2xl font-semibold">{totals.with_financial_data}</p></div>
        </div>
      )}

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
              { key: "registered", label: "Cadastro", render: (row) => formatDateTime(row.registered_at) },
              { key: "status", label: "Status", render: (row) => dict.status(row.lifecycle_status) },
              { key: "onboarding", label: "Onboarding", render: (row) => row.onboarding_completed_at ? "Concluído" : "Pendente" },
              { key: "last", label: "Última atividade", render: (row) => formatDateTime(row.last_event_at) },
              { key: "events", label: "Eventos", render: (row) => row.total_events, align: "right" },
              { key: "financial", label: "Dados financeiros", render: (row) => row.has_financial_data ? "Sim" : "Ainda não" },
            ]}
          />
        </section>
      ) : (
        <EmptyState title="Nenhum cliente encontrado" description="Os novos cadastros aparecerão aqui imediatamente." />
      )}
    </div>
  );
}
