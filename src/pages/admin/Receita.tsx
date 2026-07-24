import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";

type Rev = { status: string; note: string; active_users_last_30d: number };

export default function Receita() {
  const [data, setData] = useState<Rev | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<Rev>("admin_v2_revenue_summary")
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Receita" description="Assinatura, MRR e conversão." />
      <div className="surface-card p-6">
        <h3 className="font-display text-base font-semibold mb-2">Status da integração</h3>
        <p className="text-sm text-muted-foreground">{data?.note}</p>
        <div className="mt-4 text-sm">
          <span className="text-muted-foreground">Usuários ativos (últimos 30d):</span>{" "}
          <span className="tabular-nums font-semibold">{data?.active_users_last_30d ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
