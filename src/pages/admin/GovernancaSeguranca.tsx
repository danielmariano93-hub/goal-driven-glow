import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { BreakGlassPanel } from "@/components/admin/BreakGlassPanel";

type Governance = {
  admins_total: number;
  admins_by_role: Record<string, number>;
  break_glass_active: number;
  break_glass_last_7d: number;
  reauth_last_7d: number;
};

export default function GovernancaSeguranca() {
  const [data, setData] = useState<Governance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    callAdminRpc<Governance>("admin_v2_governance_summary")
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Segurança"
        description="Papéis, quebra-de-vidro e reautenticação recente."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Admins</div>
          <div className="font-display text-2xl font-bold">{data?.admins_total}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Break-glass ativas</div>
          <div className="font-display text-2xl font-bold text-amber-600">
            {data?.break_glass_active}
          </div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Break-glass (7d)</div>
          <div className="font-display text-2xl font-bold">{data?.break_glass_last_7d}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Reauth (7d)</div>
          <div className="font-display text-2xl font-bold">{data?.reauth_last_7d}</div>
        </div>
      </div>

      <BreakGlassPanel onChange={load} />

      <div className="surface-card p-4">
        <h3 className="font-display text-base font-semibold mb-2">Admins por papel</h3>
        <ul className="text-sm space-y-1">
          {Object.entries(data?.admins_by_role ?? {}).map(([role, count]) => (
            <li key={role} className="flex justify-between border-b border-border/40 py-1">
              <span className="capitalize">{role.replace(/_/g, " ")}</span>
              <span className="tabular-nums font-semibold">{count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
