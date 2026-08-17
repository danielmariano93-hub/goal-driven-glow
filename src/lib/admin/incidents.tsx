import type { AdminIncident } from "@/components/admin/AttentionCard";
import type { PlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { dict } from "@/lib/admin/displayDictionary";
import { mapWhatsAppStatus } from "@/lib/admin/statusMapper";
import { universeNotes, type AdminUniverse } from "@/lib/admin/universe";

/**
 * Traduz sinais técnicos em incidentes acionáveis.
 *
 * Regra: todo item aqui responde "o que aconteceu", "por que importa" e
 * "o que eu faço agora". Nada entra sem ação possível.
 */

export type IncidentInput = {
  status?: PlatformStatus | null;
  universe?: AdminUniverse | null;
  attention?: Array<{ key: string; severity: string; value: number }> | null;
  messagingFailureRate?: number | null;
};

export function buildIncidents({
  status,
  universe,
  attention,
  messagingFailureRate,
}: IncidentInput): AdminIncident[] {
  const list: AdminIncident[] = [];

  // --- Canal WhatsApp -------------------------------------------------
  const wa = status?.whatsapp;
  if (wa && wa.status !== "connected") {
    const disconnected = wa.status === "disconnected";
    const statusView = mapWhatsAppStatus(wa.status);
    list.push({
      id: "whatsapp-channel",
      severity: disconnected ? "critical" : "warning",
      title: disconnected
        ? "WhatsApp desconectado"
        : "A conexão do WhatsApp precisa ser confirmada",
      impact: disconnected
        ? "Clientes que usam o WhatsApp ficam sem resposta e sem lembretes enquanto o canal estiver fora."
        : statusView.impact,
      lastCheckedAt: wa.last_seen_at,
      probableCause: statusView.label,
      action: {
        label: disconnected ? "Reconectar agora" : "Verificar canal",
        to: "/admin/operacoes?secao=whatsapp",
      },
      technical: (
        <span>
          status={wa.status} · error_code={wa.error_code ?? "—"} · latency={wa.latency_ms ?? "—"}ms
        </span>
      ),
    });
  }

  // --- Motor do Nino --------------------------------------------------
  const agent = status?.agent;
  if (agent && agent.status !== "working") {
    list.push({
      id: "agent-engine",
      severity: agent.status === "attention" ? "warning" : "critical",
      title: "O Nino está com dificuldade para responder",
      impact: agent.failures_24h
        ? `${agent.failures_24h} conversa(s) falharam nas últimas 24 horas.`
        : "Nenhuma falha registrada nas últimas 24 horas.",
      probableCause: agent.active_prompt ? undefined : "Nenhuma versão de instrução publicada.",
      action: { label: "Abrir Nino", to: "/admin/nino-ia?aba=qualidade" },
    });
  }

  // --- Automações e fila ----------------------------------------------
  const jobs = Object.entries(status?.jobs ?? {});
  const broken = jobs.filter(([, j]) => j?.status === "failing" || j?.status === "delayed");
  if (broken.length) {
    list.push({
      id: "jobs",
      severity: broken.some(([, j]) => j.status === "failing") ? "critical" : "warning",
      title: `${broken.length} automação(ões) fora do ritmo`,
      impact: "Lembretes e envios programados podem não sair no horário combinado com o cliente.",
      probableCause: broken.map(([key]) => dict.job(key)).join(", "),
      action: { label: "Ver automações", to: "/admin/operacoes" },
      technical: (
        <ul>
          {broken.map(([key, j]) => (
            <li key={key}>
              {key}: {j.status} · último erro {j.last_error_code ?? "—"}
            </li>
          ))}
        </ul>
      ),
    });
  }

  // --- Fila de envios ---------------------------------------------------
  const outbox = status?.outbox;
  if (outbox && (outbox.failed > 0 || outbox.queued > 20)) {
    list.push({
      id: "outbox",
      severity: outbox.failed > 0 ? "critical" : "warning",
      title:
        outbox.failed > 0
          ? `${outbox.failed} mensagem(ns) não chegaram ao cliente`
          : `${outbox.queued} mensagens aguardando envio`,
      impact: "Cada mensagem parada é um cliente sem a informação que o Nino prometeu.",
      action: { label: "Abrir comunicações", to: "/admin/comunicacoes" },
    });
  }

  if (messagingFailureRate != null && messagingFailureRate > 5) {
    list.push({
      id: "messaging-rate",
      severity: messagingFailureRate > 15 ? "critical" : "warning",
      title: `${messagingFailureRate.toFixed(1)}% das mensagens falharam nos últimos 7 dias`,
      impact: "Acima de 5% já compromete a confiança no canal.",
      action: { label: "Ver entregabilidade", to: "/admin/comunicacoes" },
    });
  }

  // --- Integridade dos números ------------------------------------------
  for (const note of universeNotes(universe)) {
    if (note.tone !== "warning") continue;
    list.push({
      id: `universe-${note.id}`,
      severity: "warning",
      title: note.title,
      impact: note.detail,
      action: { label: "Entender os números", to: "/admin/administracao?secao=auditoria" },
    });
  }

  // --- Sinais vindos do próprio cockpit ---------------------------------
  for (const item of attention ?? []) {
    if (item.severity !== "high" && item.severity !== "medium") continue;
    list.push({
      id: `cockpit-${item.key}`,
      severity: item.severity === "high" ? "critical" : "warning",
      title: `${dict.feature(item.key)} precisa de atenção`,
      impact: `Indicador em ${item.value}.`,
      action: { label: "Ver produto", to: "/admin/produto" },
    });
  }

  return list;
}

export function groupBySeverity(incidents: AdminIncident[]) {
  return {
    critical: incidents.filter((i) => i.severity === "critical"),
    warning: incidents.filter((i) => i.severity === "warning"),
    healthy: incidents.filter((i) => i.severity === "healthy"),
  };
}
