import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { formatDateTime, formatRate, rate } from "@/lib/admin/formulas";

type Day = { day: string; attempts: number; sent: number; failed: number };
type Totals = { attempts: number; sent: number; delivered: number; read: number; failed: number; backlog: number };
type Response = {
  receipts_available: boolean;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  totals: Totals;
  daily: Day[];
};

export default function OperacaoWhatsApp() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<Response>("admin_v2_whatsapp_monitor", { _days: 14 })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Falha ao carregar WhatsApp"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar o monitoramento do WhatsApp" description={error} />;

  const totals = data?.totals;
  if (!totals) return <EmptyState title="Sem dados do WhatsApp" />;

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp" description="Acompanhe volume, saúde e falhas sem acessar conteúdo ou telefones." />

      {!data?.receipts_available ? (
        <div className="rounded-2xl border border-[#FF6B5F]/25 bg-[#FF6B5F]/5 px-4 py-3 text-sm">
          <strong>Confirmação indisponível.</strong> Os envios são registrados, mas o provedor ainda não está
          populando confirmações de entrega e leitura.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard label="Tentativas" value={totals.attempts} tone="brand" />
        <AdminMetricCard label="Enviadas" value={totals.sent} />
        <AdminMetricCard label="Falhas" value={totals.failed} tone={totals.failed ? "critical" : "neutral"} />
        <AdminMetricCard label="Backlog" value={totals.backlog} />
        <AdminMetricCard label="Taxa de envio" value={formatRate(rate(totals.sent, totals.attempts))} />
        <AdminMetricCard
          label="Taxa de entrega"
          value={data?.receipts_available ? formatRate(rate(totals.delivered, totals.sent)) : "—"}
        />
        <AdminMetricCard
          label="Taxa de leitura"
          value={data?.receipts_available ? formatRate(rate(totals.read, totals.delivered)) : "—"}
        />
        <AdminMetricCard
          label="Última atividade"
          value={<span className="text-base">{formatDateTime(data?.last_outbound_at)}</span>}
        />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Evolução dos últimos 14 dias</h2>
        <AdminResponsiveList
          rows={data?.daily ?? []}
          rowKey={(row) => row.day}
          columns={[
            { key: "day", label: "Dia", render: (row) => new Date(`${row.day}T12:00:00`).toLocaleDateString("pt-BR") },
            { key: "attempts", label: "Tentativas", render: (row) => row.attempts, align: "right" },
            { key: "sent", label: "Enviadas", render: (row) => row.sent, align: "right" },
            { key: "failed", label: "Falhas", render: (row) => row.failed, align: "right" },
          ]}
        />
      </section>
    </div>
  );
}
