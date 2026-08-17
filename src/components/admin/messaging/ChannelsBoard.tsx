import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw, MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";
import { Section } from "@/components/admin/Section";
import { MetricRow, MetricTile } from "@/components/admin/kit/MetricTile";
import { HealthPill, type PillTone } from "@/components/admin/kit/HealthPill";
import { TrendChart } from "@/components/admin/kit/TrendChart";
import { WhatsAppSessionPanel } from "@/pages/admin/WhatsAppSessionPanel";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { useAdminPlatformStatus, type JobKey } from "@/hooks/useAdminPlatformStatus";
import { dict } from "@/lib/admin/displayDictionary";

type Monitor = {
  receipts_available: boolean;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  totals: {
    attempts: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    backlog: number;
  };
  daily: Array<{ day: string; attempts: number; sent: number; failed: number }>;
};

const JOB_LABEL: Record<JobKey, string> = {
  "whatsapp-send": "Envio de mensagens",
  "whatsapp-ack-watchdog": "Vigilância de confirmação",
  "split-reminders-dispatch": "Lembretes da divisão",
  "recurring-generate": "Lançamentos recorrentes",
};

const JOB_TONE: Record<string, PillTone> = {
  healthy: "success",
  delayed: "warn",
  failing: "danger",
  idle: "neutral",
  not_scheduled: "warn",
};

const JOB_STATE: Record<string, string> = {
  healthy: "Rodando normalmente",
  delayed: "Atrasado",
  failing: "Falhando",
  idle: "Sem trabalho",
  not_scheduled: "Não agendado",
};

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Canais: o WhatsApp está de pé? A fila está andando? Os serviços rodaram?
 * Tudo em linguagem de operação, com ação direta de reprocessar.
 */
export function ChannelsBoard() {
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const { data: platform } = useAdminPlatformStatus();

  const monitor = useQuery({
    queryKey: ["admin_v2_whatsapp_monitor", 14],
    queryFn: async (): Promise<Monitor> => {
      try {
        return await callAdminRpc<Monitor>("admin_v2_whatsapp_monitor", { _days: 14 });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar o monitor de canais"));
      }
    },
    staleTime: 30_000,
  });

  const retryFailures = async () => {
    setRetrying(true);
    try {
      const result = await callAdminRpc<{ requeued: number }>("admin_v2_retry_failed_outbound", {
        _limit: 100,
      });
      adminToast.success(`${result?.requeued ?? 0} mensagem(ns) recolocada(s) na fila`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin_v2_whatsapp_monitor"] }),
        qc.invalidateQueries({ queryKey: ["admin_message_activity"] }),
      ]);
    } catch (error) {
      adminToast.error(adminErrorMessage(error, "Não foi possível reprocessar as falhas"));
    } finally {
      setRetrying(false);
    }
  };

  const totals = monitor.data?.totals;
  const outbox = platform?.outbox;
  const wa = platform?.whatsapp;
  const waTone: PillTone =
    wa?.status === "connected"
      ? "success"
      : wa?.status === "unstable" || wa?.status === "connecting" || wa?.status === "awaiting_qr"
        ? "warn"
        : wa?.status
          ? "danger"
          : "neutral";

  return (
    <div className="space-y-6">
      <Section
        title="WhatsApp"
        icon={MessageCircle}
        description="Estado da conexão usada para falar com os clientes."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void retryFailures()}
            disabled={retrying || (outbox?.failed ?? 0) === 0}
          >
            {retrying ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            Reprocessar falhas
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <HealthPill tone={waTone}>
            {wa?.status === "connected"
              ? "Conectado"
              : wa?.status
                ? dict.status(wa.status)
                : "Sem leitura"}
          </HealthPill>
          <HealthPill tone="neutral">última atividade {when(wa?.last_seen_at)}</HealthPill>
          {typeof wa?.latency_ms === "number" && (
            <HealthPill tone={wa.latency_ms > 2000 ? "warn" : "neutral"}>
              resposta em {wa.latency_ms} ms
            </HealthPill>
          )}
          <HealthPill tone="info">{wa?.active_links ?? 0} clientes conectados</HealthPill>
        </div>
      </Section>

      {monitor.isLoading ? (
        <SkeletonStats count={4} />
      ) : monitor.isError ? (
        <EmptyState
          title="Não foi possível carregar o desempenho dos canais"
          description={(monitor.error as Error).message}
        />
      ) : (
        <>
          <MetricRow>
            <MetricTile
              label="Tentativas (14 dias)"
              value={(totals?.attempts ?? 0).toLocaleString("pt-BR")}
              spark={(monitor.data?.daily ?? []).map((d) => d.attempts)}
            />
            <MetricTile
              label="Enviadas"
              value={(totals?.sent ?? 0).toLocaleString("pt-BR")}
              spark={(monitor.data?.daily ?? []).map((d) => d.sent)}
            />
            <MetricTile
              label="Falhas"
              value={(totals?.failed ?? 0).toLocaleString("pt-BR")}
              polarity="lower_is_better"
              spark={(monitor.data?.daily ?? []).map((d) => d.failed)}
            />
            <MetricTile
              label="Na fila agora"
              value={(outbox?.queued ?? totals?.backlog ?? 0).toLocaleString("pt-BR")}
              hint={`${(outbox?.failed ?? 0).toLocaleString("pt-BR")} falha(s) reprocessável(is)`}
            />
          </MetricRow>

          <Section
            title="Evolução dos envios"
            description="Tentativas, envios e falhas por dia nos últimos 14 dias."
          >
            <TrendChart
              kind="bar"
              xKey="day"
              data={(monitor.data?.daily ?? []).map((d) => ({
                ...d,
                day: new Date(`${d.day}T12:00:00`).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                }),
              }))}
              series={[
                { key: "sent", label: "Enviadas", tone: "success" },
                { key: "failed", label: "Falhas", tone: "danger" },
              ]}
              caption={
                monitor.data?.receipts_available
                  ? "Confirmações de entrega ativas no provedor."
                  : "O provedor ainda não confirma entrega e leitura; contamos apenas o envio."
              }
            />
          </Section>
        </>
      )}

      <Section title="Serviços de envio" description="Cada rotina, quando rodou e o que vem a seguir.">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(JOB_LABEL) as JobKey[]).map((key) => {
            const job = platform?.jobs?.[key];
            return (
              <article key={key} className="surface-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{JOB_LABEL[key]}</p>
                  <HealthPill tone={JOB_TONE[job?.status ?? "idle"] ?? "neutral"}>
                    {JOB_STATE[job?.status ?? "idle"] ?? "Sem leitura"}
                  </HealthPill>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <div>
                    <dt>Último ciclo</dt>
                    <dd className="text-foreground">{when(job?.last_run_at)}</dd>
                  </div>
                  <div>
                    <dt>Próximo ciclo</dt>
                    <dd className="text-foreground">{when(job?.next_run_at)}</dd>
                  </div>
                  <div>
                    <dt>Processadas</dt>
                    <dd className="text-foreground tabular-nums">{job?.processed ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Falhas</dt>
                    <dd className="text-foreground tabular-nums">{job?.failed ?? 0}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </Section>

      <Section title="Conexão e pareamento" description="Vincular ou restabelecer o número usado pelo Nino.">
        <WhatsAppSessionPanel />
      </Section>
    </div>
  );
}
