import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type Row = {
  day: string;
  feature: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

export default function OperacaoWhatsApp() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ daily: Row[] }>("admin_v2_whatsapp_monitor", { _days: 14 })
      .then((r) => setRows(r.daily))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const receiptsAvailable = useMemo(
    () => (rows ?? []).some((r) => (r.delivered ?? 0) > 0 || (r.read ?? 0) > 0),
    [rows],
  );

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp" description="Entregas e falhas por dia. Sem conteúdo." />
      {rows?.length && !receiptsAvailable ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          Recibos de <strong>entregue/lido</strong> ainda não chegam do provedor — colunas exibidas como <code>—</code>.
        </div>
      ) : null}
      <div className="surface-card p-4 overflow-x-auto">
        {rows?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Dia</th>
                <th>Feature</th>
                <th className="text-right">Enviadas</th>
                <th className="text-right">Entregues</th>
                <th className="text-right">Lidas</th>
                <th className="text-right">Falhas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2 text-xs">{r.day}</td>
                  <td>{dict.feature(r.feature)}</td>
                  <td className="text-right tabular-nums">{r.sent}</td>
                  <td className="text-right tabular-nums">{receiptsAvailable ? r.delivered : "—"}</td>
                  <td className="text-right tabular-nums">{receiptsAvailable ? r.read : "—"}</td>
                  <td className={`text-right tabular-nums ${r.failed > 0 ? "text-rose-600" : ""}`}>
                    {r.failed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Sem tráfego no WhatsApp"
            description="Novas mensagens aparecem aqui em até 15 minutos."
          />
        )}
      </div>
    </div>
  );
}
