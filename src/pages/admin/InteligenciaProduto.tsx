import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";

type Feature = { feature: string; events: number; users: number; share: number };
type Opportunity = {
  feature: string;
  initiated: number;
  completed: number;
  value_delivered: number;
  completion_rate: number;
  value_rate: number;
};

export default function InteligenciaProduto() {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      callAdminRpc<{ features: Feature[] }>("admin_v2_product_features", { _days: 30 }),
      callAdminRpc<{ opportunities: Opportunity[] }>("admin_v2_product_opportunities"),
    ])
      .then(([f, o]) => {
        setFeatures(f.features);
        setOpps(o.opportunities);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência de Produto"
        description="Uso por feature e oportunidades de conversão. Sem PII."
      />

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Features mais usadas (30d)</h3>
        {features?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Feature</th>
                <th className="text-right">Eventos</th>
                <th className="text-right">Usuários</th>
                <th className="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.feature} className="border-t border-border/40">
                  <td className="py-2">{f.feature}</td>
                  <td className="text-right tabular-nums">{f.events}</td>
                  <td className="text-right tabular-nums">{f.users}</td>
                  <td className="text-right tabular-nums">{f.share ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Sem eventos" />
        )}
      </div>

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-3">Oportunidades (baixa conversão)</h3>
        {(() => {
          const withInitiated = (opps ?? []).filter((o) => (o.initiated ?? 0) > 0);
          if (!withInitiated.length) {
            return (
              <EmptyState
                title="Sem oportunidades mapeadas"
                description="Aparecem aqui features com iniciados suficientes mas baixa conversão."
              />
            );
          }
          const fmt = (num: number | null, den: number | null) =>
            !den || den <= 0 || num === null ? "—" : `${((num / den) * 100).toFixed(1).replace(".0", "")}%`;
          return (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2">Feature</th>
                  <th className="text-right">Iniciados</th>
                  <th className="text-right">Concluídos</th>
                  <th className="text-right">Valor entregue</th>
                  <th className="text-right">Conclusão</th>
                  <th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {withInitiated.map((o) => (
                  <tr key={o.feature} className="border-t border-border/40">
                    <td className="py-2">{o.feature}</td>
                    <td className="text-right tabular-nums">{o.initiated}</td>
                    <td className="text-right tabular-nums">{o.completed}</td>
                    <td className="text-right tabular-nums">{o.value_delivered}</td>
                    <td className="text-right tabular-nums">{fmt(o.completed, o.initiated)}</td>
                    <td className="text-right tabular-nums">{fmt(o.value_delivered, o.initiated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
    </div>
  );
}
