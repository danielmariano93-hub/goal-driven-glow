import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { callAdminRpc } from "@/lib/admin/adminRpc";

type Ocr = { uploaded: number; confirmed: number; confirmation_rate: number };

export default function OperacaoIaOcr() {
  const [data, setData] = useState<Ocr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callAdminRpc<Ocr>("admin_v2_ia_ocr_metrics", { _days: 30 })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Erro" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="IA & OCR" description="Documentos processados nos últimos 30 dias." />
      <div className="grid grid-cols-3 gap-3">
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Uploads</div>
          <div className="font-display text-2xl font-bold">{data?.uploaded}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Confirmados</div>
          <div className="font-display text-2xl font-bold">{data?.confirmed}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Taxa</div>
          <div className="font-display text-2xl font-bold">{data?.confirmation_rate}%</div>
        </div>
      </div>
    </div>
  );
}
