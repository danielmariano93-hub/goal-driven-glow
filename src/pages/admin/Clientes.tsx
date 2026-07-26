import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { adminErrorMessage, callAdminRpc, withPeriod } from "@/lib/admin/adminRpc";
import { usePlatformPermissions } from "@/hooks/usePlatformPermissions";
import { dict } from "@/lib/admin/displayDictionary";
import { formatDateTime } from "@/lib/admin/formulas";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";

type Lifecycle = "new" | "activated" | "active" | "dormant" | "deleted";

type Client = {
  pseudo_id: string;
  registered_at: string;
  onboarding_completed_at: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
  total_events: number;
  significant_actions: number;
  has_financial_data: boolean;
  lifecycle_status: Lifecycle;
};

type Identity = {
  pseudo_id: string;
  display_name: string | null;
  email: string | null;
};

type ClientResponse = {
  clients: Client[];
  totals?: { registered: number; with_profile: number; with_financial_data: number };
  formula_version?: string;
  universe?: string;
};

const LIFECYCLE_OPTIONS: Array<{ key: "all" | Lifecycle; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "new", label: "Novos" },
  { key: "activated", label: "Ativados" },
  { key: "active", label: "Ativos" },
  { key: "dormant", label: "Dormant" },
];

type FinancialFilter = "all" | "with" | "without";

export default function Clientes() {
  const { permissions, ready: permsReady } = usePlatformPermissions();
  // Deps do useEffect precisam ser primitivas estáveis para não recarregar
  // a lista a cada render. `can` da hook é estável, mas isolamos os flags
  // aqui para deixar as dependências óbvias e à prova de regressão.
  const canReadIdentity = permissions.has("clients.identity.read");
  const canReadMaskedIdentity = permissions.has("clients.identity.masked");

  const [preset, setPreset] = useState<PeriodPresetKey>("30d");
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset("30d"));
  const [rows, setRows] = useState<Client[] | null>(null);
  const [totals, setTotals] = useState<ClientResponse["totals"]>();
  const [formulaVersion, setFormulaVersion] = useState<string | undefined>();
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | Lifecycle>("all");
  const [financialFilter, setFinancialFilter] = useState<FinancialFilter>("all");

  useEffect(() => {
    if (!permsReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    callAdminRpc<ClientResponse>(
      "admin_v2_clients_list",
      withPeriod(range, {
        _limit: 200,
        _lifecycle: lifecycleFilter === "all" ? null : lifecycleFilter,
        _financial: financialFilter === "all" ? null : financialFilter,
      }),
    )
      .then(async (response) => {
        if (cancelled) return;
        setRows(response.clients);
        setTotals(response.totals);
        setFormulaVersion(response.formula_version);
        const ids = response.clients.map((client) => client.pseudo_id);
        if (!ids.length) {
          setIdentities({});
          return;
        }

        // Identidade é enriquecimento opcional: uma falha aqui não pode apagar
        // a lista operacional de clientes que já foi carregada.
        try {
          if (canReadIdentity) {
            const result = await callAdminRpc<{ clients: Identity[] }>("admin_v2_clients_identity", { _pseudo_ids: ids });
            if (!cancelled) setIdentities(Object.fromEntries(result.clients.map((item) => [item.pseudo_id, item])));
          } else if (canReadMaskedIdentity) {
            const result = await callAdminRpc<{ clients: Identity[] }>("admin_v2_clients_identity_masked", { _pseudo_ids: ids });
            if (!cancelled) setIdentities(Object.fromEntries(result.clients.map((item) => [item.pseudo_id, item])));
          }
        } catch {
          if (!cancelled) setIdentities({});
        }
      })
      .catch((e) => { if (!cancelled) setError(adminErrorMessage(e, "Falha ao carregar clientes")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [permsReady, canReadIdentity, canReadMaskedIdentity, range.from, range.to, lifecycleFilter, financialFilter]);

  const clients = useMemo(() => rows ?? [], [rows]);

  if (loading || !permsReady) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar os clientes" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Clientes reais do produto — administradores da plataforma não aparecem aqui."
        actions={
          <AdminDateFilter
            preset={preset}
            value={range}
            onChange={({ preset: p, range: r }) => {
              setPreset(p);
              setRange(r);
            }}
          />
        }
        status={
          formulaVersion && (
            <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
              {formulaVersion}
            </span>
          )
        }
      />


      {totals && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Clientes cadastrados</p>
            <p className="mt-1 text-2xl font-semibold">{totals.registered}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Com perfil</p>
            <p className="mt-1 text-2xl font-semibold">{totals.with_profile}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Com dados financeiros</p>
            <p className="mt-1 text-2xl font-semibold">{totals.with_financial_data}</p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {LIFECYCLE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setLifecycleFilter(opt.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                lifecycleFilter === opt.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/50 hover:bg-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {(
            [
              { key: "all", label: "Todos" },
              { key: "with", label: "Com dados" },
              { key: "without", label: "Sem dados" },
            ] as Array<{ key: FinancialFilter; label: string }>
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFinancialFilter(opt.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                financialFilter === opt.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary/50 hover:bg-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
              { key: "onboarding", label: "Onboarding", render: (row) => (row.onboarding_completed_at ? "Concluído" : "Pendente") },
              { key: "last", label: "Última atividade", render: (row) => formatDateTime(row.last_event_at) },
              { key: "events", label: "Eventos", render: (row) => row.total_events, align: "right" },
              { key: "financial", label: "Dados financeiros", render: (row) => (row.has_financial_data ? "Sim" : "Ainda não") },
            ]}
          />
        </section>
      ) : (
        <EmptyState
          title="Nenhum cliente no filtro atual"
          description="Ajuste os filtros para ver outros clientes ou aguarde novos cadastros."
        />
      )}
    </div>
  );
}
