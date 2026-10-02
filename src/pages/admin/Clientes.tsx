import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { ArrowRight } from "lucide-react";
import { SEGMENTS, clientNarrative, clientNextAction, segmentCounts, segmentsOf, type ClientRow, type SegmentKey } from "@/lib/admin/clientSegments";
import { adminErrorMessage, callAdminRpc, withPeriod } from "@/lib/admin/adminRpc";
import { usePlatformPermissions } from "@/hooks/usePlatformPermissions";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";

type Client = ClientRow;

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

const TONE: Record<string, string> = {
  danger: "border-destructive/40 bg-destructive/5",
  warning: "border-warning/50 bg-warning/5",
  info: "border-border bg-card",
  success: "border-success/30 bg-success/5",
};
const CHIP: Record<string, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-secondary text-muted-foreground",
  success: "bg-success/10 text-success",
};

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

  const [segment, setSegment] = useState<SegmentKey | null>(null);

  useEffect(() => {
    if (!permsReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    callAdminRpc<ClientResponse>(
      "admin_v2_clients_list",
      withPeriod(range, {
        _limit: 200,
        _lifecycle: null,
        _financial: null,
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
  }, [permsReady, canReadIdentity, canReadMaskedIdentity, range.from, range.to]);

  const all = useMemo(() => rows ?? [], [rows]);
  const counts = useMemo(() => segmentCounts(all), [all]);
  const clients = useMemo(
    () => (segment ? all.filter((c) => segmentsOf(c).includes(segment)) : all),
    [all, segment],
  );

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


      <section aria-label="Segmentos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(SEGMENTS) as SegmentKey[]).map((key) => {
          const seg = SEGMENTS[key];
          const active = segment === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSegment(active ? null : key)}
              aria-pressed={active}
              className={`rounded-2xl border p-4 text-left transition ${TONE[seg.tone]} ${active ? "ring-2 ring-primary" : "hover:border-primary/40"}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{seg.label}</p>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums">{counts[key]}</p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{seg.hint}</p>
            </button>
          );
        })}
      </section>

      {totals && (
        <p className="text-xs text-muted-foreground">
          {totals.registered} clientes no total · {totals.with_financial_data} com dados financeiros · {totals.with_profile} com perfil.
          {segment ? ` Mostrando só “${SEGMENTS[segment].label}”.` : " Toque num segmento para filtrar."}
        </p>
      )}

      {clients.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {clients.map((row) => {
            const identity = identities[row.pseudo_id];
            const segs = segmentsOf(row);
            const action = clientNextAction(row);
            return (
              <li key={row.pseudo_id} className="surface-card p-4">
                <Link to={`/admin/clientes/${row.pseudo_id}`} className="block focus-visible:ring-2 focus-visible:ring-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{identity?.display_name || `Cliente ${row.pseudo_id.slice(0, 6)}`}</p>
                      <p className="truncate text-xs text-muted-foreground">{identity?.email || "Identidade protegida"}</p>
                    </div>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="mt-2 text-sm">{clientNarrative(row)}</p>
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div><dt className="inline">Eventos </dt><dd className="inline font-semibold text-foreground tabular-nums">{row.total_events}</dd></div>
                    <div><dt className="inline">Ações relevantes </dt><dd className="inline font-semibold text-foreground tabular-nums">{row.significant_actions}</dd></div>
                    <div><dt className="inline">Onboarding </dt><dd className="inline font-semibold text-foreground">{row.onboarding_completed_at ? "concluído" : "pendente"}</dd></div>
                    <div><dt className="inline">Dados financeiros </dt><dd className="inline font-semibold text-foreground">{row.has_financial_data ? "sim" : "ainda não"}</dd></div>
                  </dl>
                  {segs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {segs.map((k) => <span key={k} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP[SEGMENTS[k].tone]}`}>{SEGMENTS[k].label}</span>)}
                    </div>
                  )}
                  {action && <p className="mt-2 text-xs font-medium text-primary">→ {action}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title={segment ? "Ninguém neste segmento" : "Nenhum cliente no período"}
          description={segment ? "Boa notícia: nenhum cliente precisa dessa ação agora." : "Ajuste o período ou aguarde novos cadastros."}
        />
      )}
    </div>
  );
}
