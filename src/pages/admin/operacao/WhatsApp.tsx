import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminMetricCard } from "@/components/admin/AdminMetricCard";
import { AdminResponsiveList } from "@/components/admin/AdminResponsiveList";
import { Button } from "@/components/ui/button";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { formatDateTime, formatRate, rate } from "@/lib/admin/formulas";

type Day = { day: string; attempts: number; sent: number; failed: number };
type Totals = { attempts: number; sent: number; delivered: number; read: number; failed: number; backlog: number };
type MonitorResponse = {
  receipts_available: boolean;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  totals: Totals;
  daily: Day[];
};

type DimensionRow = {
  key: string;
  attempts: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  backlog: number;
};

type IntelligenceResponse = {
  period_days: number;
  generated_at: string;
  timezone: string;
  formula_version: string;
  health: {
    backlog_over_15m: number;
    backlog_over_2h: number;
    oldest_backlog_at: string | null;
    retryable_failures: number;
  };
  by_kind: DimensionRow[];
  by_context: DimensionRow[];
  failure_signals: Array<{ signal: string; occurrences: number }>;
  recommendations: Array<{
    severity: "critical" | "warning" | "info";
    code: string;
    title: string;
    description: string;
  }>;
};

export default function OperacaoWhatsApp() {
  const [monitor, setMonitor] = useState<MonitorResponse | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [monitorData, intelligenceData] = await Promise.all([
        callAdminRpc<MonitorResponse>("admin_v2_whatsapp_monitor", { _days: 14 }),
        callAdminRpc<IntelligenceResponse>("admin_v2_message_intelligence", { _days: 30 }),
      ]);
      setMonitor(monitorData);
      setIntelligence(intelligenceData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar WhatsApp");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retryFailures = async () => {
    setRetrying(true);
    try {
      const result = await callAdminRpc<{ requeued: number }>("admin_v2_retry_failed_outbound", { _limit: 100 });
      toast.success(`${result.requeued} mensagem(ns) reenfileirada(s)`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reenfileirar as mensagens");
    } finally {
      setRetrying(false);
    }
  };

  if (loading) return <AdminSkeleton />;
  if (error) return <EmptyState title="Não foi possível carregar o monitoramento do WhatsApp" description={error} />;

  const totals = monitor?.totals;
  if (!totals) return <EmptyState title="Sem dados do WhatsApp" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inteligência de mensagens"
        description="Saúde operacional e desempenho agregado, sem expor conteúdo ou telefones."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void retryFailures()}
            disabled={retrying || (intelligence?.health.retryable_failures ?? 0) === 0}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            Reprocessar falhas
          </Button>
        }
      />

      {!monitor.receipts_available ? (
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
          value={monitor.receipts_available ? formatRate(rate(totals.delivered, totals.sent)) : "—"}
        />
        <AdminMetricCard
          label="Taxa de leitura"
          value={monitor.receipts_available ? formatRate(rate(totals.read, totals.delivered)) : "—"}
        />
        <AdminMetricCard
          label="Última atividade"
          value={<span className="text-base">{formatDateTime(monitor.last_outbound_at)}</span>}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <AdminMetricCard label="Fila acima de 15 min" value={intelligence?.health.backlog_over_15m ?? 0} />
        <AdminMetricCard
          label="Fila acima de 2h"
          value={intelligence?.health.backlog_over_2h ?? 0}
          tone={(intelligence?.health.backlog_over_2h ?? 0) > 0 ? "critical" : "neutral"}
        />
        <AdminMetricCard label="Falhas reprocessáveis" value={intelligence?.health.retryable_failures ?? 0} />
        <AdminMetricCard
          label="Item mais antigo"
          value={<span className="text-base">{formatDateTime(intelligence?.health.oldest_backlog_at)}</span>}
        />
      </div>

      {(intelligence?.recommendations.length ?? 0) > 0 ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="font-semibold">Recomendações automáticas</h2>
          {intelligence?.recommendations.map((item) => (
            <div key={item.code} className="rounded-xl border border-border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm">{item.title}</strong>
                <span className="text-xs uppercase text-muted-foreground">{item.severity}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Desempenho por tipo de mensagem</h2>
        <AdminResponsiveList
          rows={intelligence?.by_kind ?? []}
          rowKey={(row) => row.key}
          columns={[
            { key: "key", label: "Tipo", render: (row) => row.key },
            { key: "attempts", label: "Tentativas", render: (row) => row.attempts, align: "right" },
            { key: "sent", label: "Enviadas", render: (row) => row.sent, align: "right" },
            { key: "failed", label: "Falhas", render: (row) => row.failed, align: "right" },
            {
              key: "read_rate",
              label: "Leitura",
              render: (row) => formatRate(rate(row.read, row.delivered)),
              align: "right",
            },
          ]}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Desempenho por contexto</h2>
        <AdminResponsiveList
          rows={intelligence?.by_context ?? []}
          rowKey={(row) => row.key}
          columns={[
            { key: "key", label: "Contexto", render: (row) => row.key },
            { key: "attempts", label: "Tentativas", render: (row) => row.attempts, align: "right" },
            { key: "sent", label: "Enviadas", render: (row) => row.sent, align: "right" },
            { key: "failed", label: "Falhas", render: (row) => row.failed, align: "right" },
            { key: "backlog", label: "Na fila", render: (row) => row.backlog, align: "right" },
          ]}
        />
      </section>

      {(intelligence?.failure_signals.length ?? 0) > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-4 font-semibold">Sinais de falha</h2>
          <AdminResponsiveList
            rows={intelligence?.failure_signals ?? []}
            rowKey={(row) => row.signal}
            columns={[
              { key: "signal", label: "Sinal técnico", render: (row) => row.signal },
              { key: "occurrences", label: "Ocorrências", render: (row) => row.occurrences, align: "right" },
            ]}
          />
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Evolução dos últimos 14 dias</h2>
        <AdminResponsiveList
          rows={monitor.daily ?? []}
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
