import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
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
  if (error) return <EmptyState title="Não foi possível carregar" description={error} />;

  const uploaded = data?.uploaded ?? 0;
  const confirmed = data?.confirmed ?? 0;
  const rateLabel =
    uploaded <= 0
      ? "—"
      : `${(((confirmed / uploaded) * 100)).toFixed(1).replace(".0", "")}%`;
  const insufficient = uploaded > 0 && uploaded < 10;

  return (
    <div className="space-y-6">
      <PageHeader title="IA & OCR" description="Documentos processados nos últimos 30 dias." />
      {uploaded === 0 ? (
        <EmptyState
          title="Nenhum documento processado nos últimos 30 dias"
          description="Uploads pelo assessor ou WhatsApp aparecem aqui automaticamente."
        />
      ) : (
        <>
          {insufficient ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
              Amostra pequena ({uploaded} uploads) — a taxa pode variar bastante.
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <div className="surface-card p-4">
              <div className="text-[11px] uppercase text-muted-foreground">Uploads</div>
              <div className="font-display text-2xl font-bold tabular-nums">{uploaded}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[11px] uppercase text-muted-foreground">Confirmados</div>
              <div className="font-display text-2xl font-bold tabular-nums">{confirmed}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[11px] uppercase text-muted-foreground">Taxa de confirmação</div>
              <div className="font-display text-2xl font-bold tabular-nums">{rateLabel}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
