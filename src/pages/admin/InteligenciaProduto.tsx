import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";
import { formatRate, rate, sampleLabel } from "@/lib/admin/formulas";

type Feature = { feature: string; events: number; users: number; share: number };
type Opportunity = {
  feature: string;
  initiated: number;
  completed: number;
  value_delivered: number;
};

export default function InteligenciaProduto() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loadingFeatures, setLoadingFeatures] = useState(true);
  const [loadingOpportunities, setLoadingOpportunities] = useState(true);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [opportunityError, setOpportunityError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ features: Feature[] }>("admin_v2_product_features", { _days: 30 })
      .then((response) => setFeatures(response.features))
      .catch((e) => setFeatureError(e?.message ?? "Falha ao carregar adoção"))
      .finally(() => setLoadingFeatures(false));

    callAdminRpc<{ opportunities: Opportunity[] }>("admin_v2_product_opportunities")
      .then((response) => setOpportunities(response.opportunities))
      .catch((e) => setOpportunityError(e?.message ?? "Falha ao carregar oportunidades"))
      .finally(() => setLoadingOpportunities(false));
  }, []);

  const ranked = useMemo(() => [...features].sort((a, b) => b.users - a.users), [features]);
  const validOpportunities = opportunities.filter((item) => item.initiated > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência de Produto"
        description="Veja como as pessoas descobrem, usam e recebem valor de cada experiência do Nino."
      />

      <div className="rounded-2xl border border-[#6D4AFF]/20 bg-[#6D4AFF]/5 p-4 text-sm">
        A instrumentação em tempo real ainda está em implantação. Parte do histórico foi reconstruída a partir de registros existentes.
      </div>

      {loadingFeatures ? (
        <AdminSkeleton />
      ) : featureError ? (
        <EmptyState title="Não foi possível carregar a adoção" description={featureError} />
      ) : ranked.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AdminMetricCard label="Maior alcance" value={dict.feature(ranked[0]?.feature)} tone="brand" />
            <AdminMetricCard label="Usuários alcançados" value={ranked[0]?.users ?? 0} />
            <AdminMetricCard label="Usos registrados" value={ranked[0]?.events ?? 0} />
            <AdminMetricCard label="Participação" value={formatRate(ranked[0]?.share ?? null)} />
          </div>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="font-semibold">Adoção por experiência</h2>
              <p className="text-sm text-muted-foreground">Alcance e frequência nos últimos 30 dias.</p>
            </div>
            <div className="grid gap-3">
              {ranked.map((item) => (
                <article key={item.feature} className="rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">{dict.feature(item.feature)}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.users} usuários · {item.events} usos
                      </p>
                    </div>
                    <span className="rounded-full bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#4338FF]">
                      {formatRate(item.share)}
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E7E5EE]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#6D4AFF] via-[#4338FF] to-[#FF6B5F]"
                      style={{ width: `${Math.min(item.share, 100)}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <EmptyState title="Ainda não há adoção suficiente para analisar" />
      )}

      {loadingOpportunities ? (
        <AdminSkeleton />
      ) : opportunityError ? (
        <EmptyState title="Não foi possível carregar as oportunidades" description={opportunityError} />
      ) : (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">Sinais para investigar</h2>
            <p className="text-sm text-muted-foreground">Nenhum resultado abaixo deve ser interpretado como causalidade.</p>
          </div>
          {validOpportunities.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {validOpportunities.map((item) => {
                const sample = sampleLabel(item.initiated);
                const completion = rate(item.completed, item.initiated);
                const value = rate(item.value_delivered, item.initiated);
                return (
                  <article key={item.feature} className="rounded-2xl border border-border p-4">
                    <h3 className="font-semibold">{dict.feature(item.feature)}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {sample
                        ? `${item.initiated} pessoa(s) iniciaram. ${sample} para avaliar conversão.`
                        : `${formatRate(completion)} concluíram e ${formatRate(value)} receberam valor.`}
                    </p>
                    <div className="mt-4 flex gap-4 text-sm">
                      <span>Iniciaram: <strong>{item.initiated}</strong></span>
                      <span>Concluíram: <strong>{item.completed}</strong></span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Ainda não há base válida para apontar oportunidades"
              description="Experiências sem início registrado foram excluídas da análise."
            />
          )}
        </section>
      )}
    </div>
  );
}
