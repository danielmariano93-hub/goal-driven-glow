import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type Row = {
  day: string;
  surface: string;
  feature: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

export default function OperacaoMensageria() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<{ daily: Row[] }>("admin_v2_messaging_activity", { _days: 14 })
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
      <PageHeader
        title="Mensageria"
        description="Fluxo agregado de mensagens por canal. Sem conteúdo, sem telefones."
      />
      {rows?.length && !receiptsAvailable ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          Confirmações de entrega/leitura ainda não estão sendo capturadas — as colunas <strong>Entregues</strong> e <strong>Lidas</strong> aparecem como <code>—</code> até o receipt chegar.
        </div>
      ) : null}
      <div className="surface-card p-4 overflow-x-auto">
        {rows?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Dia</th>
                <th>Surface</th>
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
                  <td>{dict.surface(r.surface)}</td>
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
            title="Sem tráfego nos últimos 14 dias"
            description="Novas mensagens aparecem aqui em até 15 minutos."
          />
        )}
      </div>
    </div>
  );
}
