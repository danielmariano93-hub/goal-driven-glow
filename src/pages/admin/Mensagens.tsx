import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCheck, ChevronDown, ChevronRight, Clock3, MessageCircle,
  RefreshCw, RotateCw, Send,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMessages, fetchMetrics, fetchTimeline, reprocessMessage,
  type MessageRow, type Metrics, type TimelineEvent,
} from "@/lib/admin/messageCenter";

type ConversationRow = { id: string; created_at: string; direction: "inbound" | "outbound"; source: string; contact: string | null; preview: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Aguardando envio", cls: "bg-amber-100 text-amber-800" },
  processing: { label: "Enviando", cls: "bg-blue-100 text-blue-800" },
  sent: { label: "Enviada", cls: "bg-blue-100 text-blue-800" },
  delivered: { label: "Entregue", cls: "bg-emerald-100 text-emerald-800" },
  read: { label: "Lida", cls: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-800" },
  dead: { label: "Falha definitiva", cls: "bg-red-100 text-red-800" },
};

const SURFACE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  app_assessor: "Assessor (app)",
  app_notification: "Notificação (app)",
  app_insight: "Insight (app)",
  system: "Sistema",
};

const PERIODS = [
  { key: "7d", label: "Últimos 7 dias", days: 7 },
  { key: "30d", label: "Últimos 30 dias", days: 30 },
  { key: "90d", label: "Últimos 90 dias", days: 90 },
];

export default function MensagensAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [surface, setSurface] = useState("");
  const [feature, setFeature] = useState("");
  const [search, setSearch] = useState("");
  const [periodKey, setPeriodKey] = useState("7d");
  const [expanded, setExpanded] = useState<string | null>(null);

  const period = useMemo(() => {
    const days = PERIODS.find((p) => p.key === periodKey)?.days ?? 7;
    return {
      from: new Date(Date.now() - days * 86400000).toISOString(),
      to: new Date().toISOString(),
    };
  }, [periodKey]);

  const messages = useQuery({
    queryKey: ["admin_message_activity", period.from, period.to, status, surface, feature, search],
    queryFn: () => fetchMessages({
      from: period.from, to: period.to,
      status, surface, feature, search, limit: 300,
    }),
    refetchInterval: 15000,
  });

  const metrics = useQuery({
    queryKey: ["admin_message_metrics", period.from, period.to],
    queryFn: () => fetchMetrics(period.from, period.to),
    refetchInterval: 15000,
  });

  const conversations = useQuery({
    queryKey: ["admin_conversation_activity", period.from, period.to],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_conversation_activity", {
        p_from: period.from, p_to: period.to, p_limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
    refetchInterval: 15000,
  });

  const features = useMemo(
    () => [...new Set((messages.data ?? []).map((m) => m.feature || m.kind).filter(Boolean))].sort(),
    [messages.data],
  );

  const refresh = () => {
    void messages.refetch();
    void metrics.refetch();
    void conversations.refetch();
  };

  const doReprocess = async (id: string) => {
    try {
      await reprocessMessage(id);
      toast.success("Mensagem reenfileirada.");
      await qc.invalidateQueries({ queryKey: ["admin_message_activity"] });
    } catch (e) {
      toast.error(`Não foi possível reprocessar: ${(e as Error).message}`);
    }
  };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Mensagens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Histórico único do WhatsApp, assessor no app, notificações, insights e Divisão do Rolê.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)}
                className="rounded-full border bg-background px-3 py-2 text-xs">
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <button onClick={refresh} className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs">
          <RefreshCw size={14}/> Atualizar
        </button>
      </div>
    </header>

    <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Metric icon={MessageCircle} label="Total" value={metrics.data?.total ?? 0}/>
      <Metric icon={Clock3} label="Na fila" value={metrics.data?.queued ?? 0}/>
      <Metric icon={Send} label="Enviadas" value={metrics.data?.sent ?? 0}/>
      <Metric icon={CheckCheck} label="Entregues/lidas" value={metrics.data?.delivered ?? 0}/>
      <Metric icon={AlertCircle} label="Falhas" value={metrics.data?.failed ?? 0}/>
      <Metric icon={CheckCheck} label="Taxa entrega" value={metrics.data?.delivery_rate ?? 0} suffix="%"/>
    </section>

    <BreakdownGrid metrics={metrics.data ?? null} />

    <section className="surface-card p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="rounded-xl border bg-background px-3 py-2 text-sm">
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
        </select>
        <select value={surface} onChange={(e) => setSurface(e.target.value)}
                className="rounded-xl border bg-background px-3 py-2 text-sm">
          <option value="">Todas as superfícies</option>
          {Object.entries(SURFACE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={feature} onChange={(e) => setFeature(e.target.value)}
                className="rounded-xl border bg-background px-3 py-2 text-sm">
          <option value="">Todas as funcionalidades</option>
          {features.map((value) => <option key={value} value={value}>{friendlyKind(value)}</option>)}
        </select>
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por telefone, conteúdo ou funcionalidade"
          className="min-w-[220px] flex-1 rounded-xl border bg-background px-3 py-2 text-sm"
        />
      </div>

      {messages.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando histórico…</p>}
      {messages.isError && (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          Não foi possível carregar o histórico. {(messages.error as Error)?.message}
        </p>
      )}
      {!messages.isLoading && (messages.data?.length ?? 0) === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem neste período.</p>
      )}

      <div className="divide-y">
        {(messages.data ?? []).map((m) => {
          const s = STATUS[m.status] ?? { label: m.status, cls: "bg-secondary text-foreground" };
          const canReprocess = (m.status === "failed" || m.status === "dead") && m.channel !== "inapp";
          const isOpen = expanded === m.id;
          return (
            <article key={m.id} className="py-3">
              <div className="grid gap-2 md:grid-cols-[150px_1fr_180px] md:items-start">
                <div>
                  <p className="text-xs font-medium">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {m.recipient} · tentativa {m.attempts}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {SURFACE_LABEL[m.surface ?? ""] ?? m.surface ?? m.channel}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{friendlyKind(m.feature || m.kind)}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{m.preview}</p>
                  {m.last_error && <p className="mt-1 text-xs text-red-600">{friendlyError(m.last_error)}</p>}
                </div>
                <div className="flex flex-col items-start gap-1.5 md:items-end">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${s.cls}`}>
                    {s.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                      Linha do tempo
                    </button>
                    {canReprocess && (
                      <button onClick={() => doReprocess(m.id)}
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:bg-accent">
                        <RotateCw size={11}/> Reprocessar
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {isOpen && <TimelinePanel id={m.id} />}
            </article>
          );
        })}
      </div>
    </section>

    <section className="surface-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Conversas do assessor</h2>
        <p className="text-xs text-muted-foreground">
          Mensagens do app e do WhatsApp, já armazenadas de forma mascarada.
        </p>
      </div>
      {conversations.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando conversas…</p>}
      <div className="divide-y">
        {(conversations.data ?? []).map((m) => (
          <article key={m.id} className="grid gap-2 py-3 md:grid-cols-[150px_110px_1fr]">
            <div>
              <p className="text-xs font-medium">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
              <p className="text-[11px] text-muted-foreground">{m.contact ?? "Usuário do app"}</p>
            </div>
            <div>
              <span className="rounded-full bg-secondary px-2 py-1 text-[11px]">
                {m.source} · {m.direction === "inbound" ? "recebida" : "respondida"}
              </span>
            </div>
            <p className="break-words text-sm text-muted-foreground">{m.preview}</p>
          </article>
        ))}
      </div>
    </section>
  </div>;
}

function TimelinePanel({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["admin_message_timeline", id],
    queryFn: () => fetchTimeline(id),
  });
  if (q.isLoading) return <p className="mt-2 pl-4 text-xs text-muted-foreground">Carregando…</p>;
  if (q.isError || !q.data) return <p className="mt-2 pl-4 text-xs text-red-600">Não foi possível carregar a linha do tempo.</p>;
  const events = q.data.events ?? [];
  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Linha do tempo</p>
      <ol className="mt-2 space-y-1.5">
        <li className="flex items-baseline gap-2 text-xs">
          <span className="w-40 text-muted-foreground">{new Date(q.data.message.created_at).toLocaleString("pt-BR")}</span>
          <span>Criada — status inicial <b>queued</b>.</span>
        </li>
        {q.data.message.sent_at && (
          <li className="flex items-baseline gap-2 text-xs">
            <span className="w-40 text-muted-foreground">{new Date(q.data.message.sent_at).toLocaleString("pt-BR")}</span>
            <span>Enviada ao provedor{q.data.message.provider_message_id ? ` (id ${q.data.message.provider_message_id.slice(0, 12)}…)` : ""}.</span>
          </li>
        )}
        {events.map((e: TimelineEvent) => (
          <li key={e.id} className="flex items-baseline gap-2 text-xs">
            <span className="w-40 text-muted-foreground">{new Date(e.occurred_at).toLocaleString("pt-BR")}</span>
            <span>ACK: <b>{e.status}</b></span>
          </li>
        ))}
        {q.data.message.last_error && (
          <li className="flex items-baseline gap-2 text-xs text-red-600">
            <span className="w-40">Última tentativa</span>
            <span>{q.data.message.last_error}</span>
          </li>
        )}
      </ol>
    </div>
  );
}

function BreakdownGrid({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return null;
  return (
    <section className="grid gap-3 md:grid-cols-3">
      <BreakdownCard title="Por canal" data={metrics.by_channel} />
      <BreakdownCard title="Por funcionalidade" data={metrics.by_feature} />
      <BreakdownCard title="Por superfície" data={metrics.by_surface}
                     labelMap={SURFACE_LABEL} />
    </section>
  );
}

function BreakdownCard({ title, data, labelMap }: {
  title: string; data: Record<string, number>; labelMap?: Record<string, string>;
}) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  return (
    <div className="surface-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Sem dados no período.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {entries.map(([key, value]) => {
            const pct = Math.round((value / total) * 100);
            return (
              <li key={key}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="truncate">{labelMap?.[key] ?? friendlyKind(key)}</span>
                  <span className="ml-2 text-muted-foreground">{value} · {pct}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, suffix }: {
  icon: typeof MessageCircle; label: string; value: number; suffix?: string;
}) {
  return (
    <div className="surface-card p-4">
      <Icon size={15} className="text-muted-foreground"/>
      <p className="mt-2 text-2xl font-bold">{value}{suffix ?? ""}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function friendlyKind(kind: string) {
  if (!kind) return "—";
  if (kind.startsWith("split_")) return `Divisão do Rolê · ${kind.replace("split_", "").split("_").join(" ")}`;
  if (kind.startsWith("notification_")) return `Notificação · ${kind.replace("notification_", "").split("_").join(" ")}`;
  if (kind === "agent") return "Resposta do assessor";
  if (kind === "agent_chat") return "Assessor no app";
  if (kind === "system") return "Mensagem de serviço";
  if (kind === "document_status") return "Status da importação";
  if (kind === "notification") return "Notificação";
  return kind.split("_").join(" ");
}

function friendlyError(error: string) {
  if (error.includes("timeout")) return "O provedor demorou para responder; uma nova tentativa será feita.";
  if (error.includes("not_configured")) return "Canal ainda não configurado.";
  return `Falha técnica: ${error.slice(0, 140)}`;
}
