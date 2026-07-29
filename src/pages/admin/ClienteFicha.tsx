import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Wallet, Bot, MessageCircle, Route as RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { AdminAsyncBoundary } from "@/components/admin/AdminAsyncBoundary";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";
import { formatDateTime } from "@/lib/admin/formulas";

type ClientProfile = {
  found: boolean;
  pseudo_id: string;
  summary?: {
    registered_at: string;
    onboarding_completed_at: string | null;
    timezone: string | null;
    detached_at: string | null;
  };
  journey?: {
    first_event_at: string | null;
    last_event_at: string | null;
    total_events: number;
    significant_actions: number;
    active_days: number;
    reconstructed_events: number;
  };
  finance?: {
    transactions: number;
    last_transaction_at: string | null;
    accounts: number;
    goals: number;
    documents: number;
  };
  nino?: { runs: number; errors: number; cost_cents: number; last_run_at: string | null; p95_latency_ms: number };
  communications?: {
    attempted: number;
    delivered: number;
    suppressed: number;
    interacted: number;
    last_at: string | null;
    suppression_reasons: string[];
  };
  channel?: {
    whatsapp_linked: boolean;
    messages_sent: number;
    messages_failed: number;
    last_message_at: string | null;
  };
  timeline?: Array<{
    event_name: string;
    feature: string | null;
    surface: string | null;
    outcome: string | null;
    event_source: string;
    occurred_at: string;
  }>;
  formula_version?: string;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function Fact({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function ClienteFicha() {
  const { pseudoId = "" } = useParams();
  const [data, setData] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    callAdminRpc<ClientProfile>("admin_v2_client_profile", { _pseudo_id: pseudoId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(adminErrorMessage(err, "Falha ao carregar a ficha do cliente"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pseudoId, reloadKey]);

  const journey = data?.journey;
  const finance = data?.finance;
  const nino = data?.nino;
  const comms = data?.communications;
  const channel = data?.channel;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Cliente ${pseudoId.slice(0, 6)}`}
        description="Tudo o que aconteceu com este cliente, sem sair da tela. Identidade permanece protegida."
        actions={
          <Link
            to="/admin/clientes"
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
          >
            <ArrowLeft size={14} aria-hidden />
            Voltar
          </Link>
        }
      />

      <AdminAsyncBoundary
        loading={loading}
        error={error}
        empty={!loading && !error && data?.found === false}
        emptyTitle="Cliente não encontrado"
        emptyDescription="Este identificador não corresponde a um cliente real (pode ser conta de teste, administração ou histórico reconstruído)."
        hasData={Boolean(data?.found)}
        onRetry={() => setReloadKey((k) => k + 1)}
      >
        {data?.found && (
          <div className="space-y-6">
            <Section title="Resumo">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Fact label="Cadastro" value={formatDateTime(data.summary?.registered_at ?? null)} />
                <Fact
                  label="Onboarding"
                  value={data.summary?.onboarding_completed_at ? "Concluído" : "Pendente"}
                  hint={data.summary?.onboarding_completed_at ? formatDateTime(data.summary.onboarding_completed_at) : undefined}
                />
                <Fact
                  label="WhatsApp"
                  value={channel?.whatsapp_linked ? "Conectado" : "Não conectado"}
                  hint={channel?.last_message_at ? `Última mensagem ${formatDateTime(channel.last_message_at)}` : undefined}
                />
                <Fact label="Última atividade" value={formatDateTime(journey?.last_event_at ?? null)} />
              </div>
            </Section>

            <Section title="Jornada" icon={RouteIcon} description="Uso real, sem contar histórico reconstruído nas ações.">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Fact label="Ações significativas" value={journey?.significant_actions ?? 0} />
                <Fact label="Dias com uso" value={journey?.active_days ?? 0} />
                <Fact label="Eventos no total" value={journey?.total_events ?? 0} />
                <Fact
                  label="Histórico reconstruído"
                  value={journey?.reconstructed_events ?? 0}
                  hint="Não representa uso ao vivo"
                />
              </div>
            </Section>

            <Section title="Situação financeira" icon={Wallet}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Fact label="Lançamentos" value={finance?.transactions ?? 0} />
                <Fact label="Contas" value={finance?.accounts ?? 0} />
                <Fact label="Metas" value={finance?.goals ?? 0} />
                <Fact label="Documentos enviados" value={finance?.documents ?? 0} />
              </div>
            </Section>

            <Section title="Interações com o Nino" icon={Bot}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Fact label="Conversas processadas" value={nino?.runs ?? 0} />
                <Fact label="Falhas" value={nino?.errors ?? 0} />
                <Fact label="Custo acumulado" value={BRL.format((nino?.cost_cents ?? 0) / 100)} />
                <Fact label="Última conversa" value={formatDateTime(nino?.last_run_at ?? null)} />
              </div>
            </Section>

            <Section title="Comunicações" icon={MessageCircle}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Fact label="Tentativas" value={comms?.attempted ?? 0} />
                <Fact label="Entregues" value={comms?.delivered ?? 0} />
                <Fact
                  label="Bloqueadas por regra"
                  value={comms?.suppressed ?? 0}
                  hint={(comms?.suppression_reasons ?? []).map((r) => dict.commReason(r)).join(", ") || undefined}
                />
                <Fact label="Mensagens com falha" value={channel?.messages_failed ?? 0} />
              </div>
            </Section>

            <Section title="Linha do tempo" description="Últimos 40 acontecimentos deste cliente.">
              {data.timeline?.length ? (
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <AdminResponsiveList
                    rows={data.timeline}
                    rowKey={(row) => `${row.occurred_at}-${row.event_name}`}
                    columns={[
                      { key: "when", label: "Quando", render: (r) => formatDateTime(r.occurred_at) },
                      { key: "what", label: "O que aconteceu", render: (r) => dict.feature(r.event_name) },
                      { key: "surface", label: "Onde", render: (r) => dict.surface(r.surface ?? "unknown") },
                      {
                        key: "source",
                        label: "Origem",
                        render: (r) => (r.event_source === "live" ? "Uso ao vivo" : "Histórico reconstruído"),
                      },
                    ]}
                  />
                </div>
              ) : (
                <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
                  Nenhum acontecimento registrado ainda.
                </p>
              )}
            </Section>

            <TechnicalDetails>
              <p>pseudo_id: {data.pseudo_id}</p>
              <p>formula_version: {data.formula_version}</p>
              <p>p95 de latência do Nino: {nino?.p95_latency_ms ?? 0} ms</p>
            </TechnicalDetails>
          </div>
        )}
      </AdminAsyncBoundary>
    </div>
  );
}
