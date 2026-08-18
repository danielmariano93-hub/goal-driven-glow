import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { Section } from "@/components/admin/Section";
import { EmptyState } from "@/components/admin/EmptyState";
import { HealthPill } from "@/components/admin/kit/HealthPill";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type QueueItem = {
  id: string;
  kind: string;
  channel: string;
  created_at: string;
  waiting_minutes: number;
  stuck: boolean;
  outbound_status: string | null;
  outbound_error: string | null;
};

type QueueHealthData = {
  stuck_minutes: number;
  waiting: number;
  stuck: number;
  items: QueueItem[];
};

function waitingLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

/**
 * Fila honesta: separa o que está apenas aguardando envio do que está preso,
 * e mostra o que o canal respondeu para cada registro.
 */
export function QueueHealth() {
  const q = useQuery({
    queryKey: ["admin_delivery_queue_health"],
    queryFn: async (): Promise<QueueHealthData> => {
      try {
        return await callAdminRpc<QueueHealthData>("admin_v2_delivery_queue_health", {
          _stuck_minutes: 30,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar a fila de envio"));
      }
    },
    staleTime: 30_000,
    retry: 1,
  });

  const data = q.data;

  return (
    <Section
      title="Fila de envio"
      icon={Clock}
      description="Registro só continua na fila enquanto o canal não confirmou. Quando o WhatsApp confirma entrega ou falha, o status muda sozinho."
    >
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando a fila…</p>
      ) : q.isError ? (
        <EmptyState title="Não foi possível carregar" description={(q.error as Error)?.message ?? "Erro desconhecido"} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Nada parado na fila"
          description="Todas as comunicações já foram confirmadas pelo canal."
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Aguardando envio</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{data.waiting}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Presas há mais de {data.stuck_minutes} min
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{data.stuck}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 text-left">Fluxo</th>
                  <th className="pr-4 text-left">Canal</th>
                  <th className="pr-4 text-left">Esperando</th>
                  <th className="text-left">Situação no canal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-4 font-medium text-foreground">{dict.commKind(item.kind)}</td>
                    <td className="pr-4 text-muted-foreground">{dict.channel(item.channel)}</td>
                    <td className="pr-4 tabular-nums text-muted-foreground">
                      {waitingLabel(item.waiting_minutes)}
                    </td>
                    <td>
                      <HealthPill tone={item.stuck ? "warn" : "info"}>
                        {item.outbound_error
                          ? item.outbound_error.slice(0, 60)
                          : item.outbound_status
                          ? dict.commStatus(item.outbound_status)
                          : "sem registro no canal"}
                      </HealthPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
