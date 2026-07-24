import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { formatRate } from "@/lib/admin/formulas";

type OcrTotals = {
  uploaded: number;
  confirmed: number;
  partially_confirmed: number;
  partial: number;
  failed: number;
  canceled: number;
  eligible: number;
  confirmation_rate: number | null;
  failure_rate: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  backlog: number;
};

type OcrDay = {
  day: string;
  uploaded: number;
  confirmed: number;
  partial: number;
  failed: number;
  canceled: number;
};

type OcrResponse = {
  totals: OcrTotals;
  daily: OcrDay[];
  source_kind: string;
};

export default function OperacaoIaOcr() {
  const [data, setData] = useState<OcrResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<OcrResponse>("admin_v2_ia_ocr_metrics", { _days: 30 })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Falha ao carregar OCR"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar a leitura de documentos" description={error} />;

  const totals = data?.totals;
  if (!totals || totals.uploaded === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Leitura de documentos" description="Acompanhe volume, qualidade e falhas das importações." />
        <EmptyState title="Nenhum documento processado" description="Os primeiros envios aparecerão aqui." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Leitura de documentos" description="Acompanhe volume, qualidade e falhas das importações." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard label="Enviados" value={totals.uploaded} tone="brand" />
        <AdminMetricCard label="Confirmados" value={totals.confirmed} tone="positive" />
        <AdminMetricCard
          label="Resultados parciais"
          value={totals.partial + totals.partially_confirmed}
          detail="Exigem alguma revisão do usuário"
          tone="warning"
        />
        <AdminMetricCard label="Falhas" value={totals.failed} tone={totals.failed > 0 ? "critical" : "neutral"} />
        <AdminMetricCard label="Taxa de confirmação" value={formatRate(totals.confirmation_rate)} />
        <AdminMetricCard label="Taxa de falha" value={formatRate(totals.failure_rate)} />
        <AdminMetricCard label="Cancelados" value={totals.canceled} />
        <AdminMetricCard label="Backlog" value={totals.backlog} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="font-semibold">Evolução diária</h2>
          <p className="text-sm text-muted-foreground">Resultados agregados, sem documentos ou valores individuais.</p>
        </div>
        <AdminResponsiveList
          rows={data?.daily ?? []}
          rowKey={(row) => row.day}
          columns={[
            { key: "day", label: "Dia", render: (row) => new Date(`${row.day}T12:00:00`).toLocaleDateString("pt-BR") },
            { key: "uploaded", label: "Enviados", render: (row) => row.uploaded, align: "right" },
            { key: "confirmed", label: "Confirmados", render: (row) => row.confirmed, align: "right" },
            { key: "partial", label: "Parciais", render: (row) => row.partial, align: "right" },
            { key: "failed", label: "Falhas", render: (row) => row.failed, align: "right" },
          ]}
        />
      </section>
    </div>
  );
}
