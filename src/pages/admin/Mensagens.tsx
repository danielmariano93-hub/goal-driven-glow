import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCheck, ChevronDown, ChevronRight, Clock3, MessageCircle,
  RefreshCw, RotateCw, Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMessages, fetchMetrics, fetchTimeline, reprocessMessage,
  type Metrics, type TimelineEvent,
} from "@/lib/admin/messageCenter";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonList, SkeletonStats } from "@/components/admin/AdminSkeleton";
import { FilterBar, type ActiveFilter } from "@/components/admin/FilterBar";
import { adminToast } from "@/components/admin/adminToast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ConversationRow = { id: string; created_at: string; direction: "inbound" | "outbound"; source: string; contact: string | null; preview: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Aguardando envio", cls: "bg-warning/15 text-warning-foreground border-warning/30" },
  processing: { label: "Enviando", cls: "bg-primary/10 text-primary border-primary/30" },
  sent: { label: "Enviada", cls: "bg-primary/10 text-primary border-primary/30" },
  delivered: { label: "Entregue", cls: "bg-success/15 text-success border-success/30" },
  read: { label: "Lida", cls: "bg-success/15 text-success border-success/30" },
  failed: { label: "Falhou", cls: "bg-destructive/10 text-destructive border-destructive/30" },
  dead: { label: "Falha definitiva", cls: "bg-destructive/15 text-destructive border-destructive/40" },
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

const ALL = "__all__";

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
      const { data, error } = await (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<{ data: ConversationRow[] | null; error: unknown }>)(
        "admin_conversation_activity",
        { p_from: period.from, p_to: period.to, p_limit: 100 },
      );
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
      adminToast.success("Mensagem reenfileirada");
      await qc.invalidateQueries({ queryKey: ["admin_message_activity"] });
    } catch (e) {
      adminToast.fromError(e, "Não foi possível reprocessar");
    }
  };

  const activeFilters: ActiveFilter[] = [
    status && { key: "status", label: `Status: ${STATUS[status]?.label ?? status}`, onClear: () => setStatus("") },
    surface && { key: "surface", label: `Superfície: ${SURFACE_LABEL[surface] ?? surface}`, onClear: () => setSurface("") },
    feature && { key: "feature", label: `Funcionalidade: ${friendlyKind(feature)}`, onClear: () => setFeature("") },
    search && { key: "search", label: `Busca: "${search}"`, onClear: () => setSearch("") },
  ].filter(Boolean) as ActiveFilter[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mensagens"
        description="Histórico único do WhatsApp, assessor no app, notificações, insights e Divisão do Rolê."
        actions={
          <>
            <Select value={periodKey} onValueChange={setPeriodKey}>
              <SelectTrigger className="w-[180px]" aria-label="Período"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Atualizar">
              <RefreshCw size={14}/> Atualizar
            </Button>
          </>
        }
      />

      {metrics.isLoading ? <SkeletonStats count={6} /> : (
        <StatGrid cols={6}>
          <StatCard icon={MessageCircle} label="Total" value={metrics.data?.total ?? 0} />
          <StatCard icon={Clock3} label="Na fila" value={metrics.data?.queued ?? 0} />
          <StatCard icon={Send} label="Enviadas" value={metrics.data?.sent ?? 0} tone="primary" />
          <StatCard icon={CheckCheck} label="Entregues" value={metrics.data?.delivered ?? 0} tone="success" />
          <StatCard icon={AlertCircle} label="Falhas" value={metrics.data?.failed ?? 0} tone={metrics.data?.failed ? "destructive" : "default"} />
          <StatCard icon={CheckCheck} label="Taxa entrega" value={metrics.data?.delivery_rate ?? 0} suffix="%" tone="success" />
        </StatGrid>
      )}

      <BreakdownGrid metrics={metrics.data ?? null} />

      <Section title="Histórico de mensagens">
        <div className="surface-card p-4 space-y-4">
          <FilterBar active={activeFilters} onClearAll={() => { setStatus(""); setSurface(""); setFeature(""); setSearch(""); }}>
            <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? "" : v)}>
              <SelectTrigger className="w-[180px]" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os status</SelectItem>
                {Object.entries(STATUS).map(([value, s]) => <SelectItem key={value} value={value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={surface || ALL} onValueChange={(v) => setSurface(v === ALL ? "" : v)}>
              <SelectTrigger className="w-[180px]" aria-label="Superfície"><SelectValue placeholder="Superfície" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as superfícies</SelectItem>
                {Object.entries(SURFACE_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={feature || ALL} onValueChange={(v) => setFeature(v === ALL ? "" : v)}>
              <SelectTrigger className="w-[200px]" aria-label="Funcionalidade"><SelectValue placeholder="Funcionalidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as funcionalidades</SelectItem>
                {features.map((value) => <SelectItem key={value} value={value}>{friendlyKind(value)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="search"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por telefone, conteúdo ou funcionalidade"
              className="min-w-[220px] flex-1"
              aria-label="Buscar mensagens"
            />
          </FilterBar>

          {messages.isLoading && <SkeletonList rows={5} />}
          {messages.isError && (
            <EmptyState title="Não foi possível carregar o histórico" description={(messages.error as Error)?.message} />
          )}
          {!messages.isLoading && (messages.data?.length ?? 0) === 0 && (
            <EmptyState title="Nenhuma mensagem neste período" compact />
          )}

          <div className="divide-y divide-border">
            {(messages.data ?? []).map((m) => {
              const s = STATUS[m.status] ?? { label: m.status, cls: "bg-secondary text-foreground border-border" };
              const canReprocess = (m.status === "failed" || m.status === "dead") && m.channel !== "inapp";
              const isOpen = expanded === m.id;
              return (
                <article key={m.id} className="py-3">
                  <div className="grid gap-2 md:grid-cols-[minmax(140px,160px)_1fr_auto] md:items-start">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
                      <p className="text-[11px] text-muted-foreground break-all">{m.recipient} · tentativa {m.attempts}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {SURFACE_LABEL[m.surface ?? ""] ?? m.surface ?? m.channel}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{friendlyKind(m.feature || m.kind)}</p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">{m.preview}</p>
                      {m.last_error && <p className="mt-1 text-xs text-destructive break-words">{friendlyError(m.last_error)}</p>}
                    </div>
                    <div className="flex flex-col items-start gap-1.5 md:items-end">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${s.cls}`}>
                        {s.label}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : m.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Ocultar linha do tempo" : "Ver linha do tempo"}
                        >
                          {isOpen ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                          Linha do tempo
                        </button>
                        {canReprocess && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] px-2"
                            onClick={() => doReprocess(m.id)}
                            aria-label="Reprocessar mensagem"
                          >
                            <RotateCw size={11}/> Reprocessar
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  {isOpen && <TimelinePanel id={m.id} />}
                </article>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Conversas do assessor" description="Mensagens do app e do WhatsApp, já armazenadas de forma mascarada.">
        <div className="surface-card p-4">
          {conversations.isLoading && <SkeletonList rows={3} />}
          {!conversations.isLoading && (conversations.data?.length ?? 0) === 0 && (
            <EmptyState title="Sem conversas neste período" compact />
          )}
          <div className="divide-y divide-border">
            {(conversations.data ?? []).map((m) => (
              <article key={m.id} className="grid gap-2 py-3 md:grid-cols-[160px_130px_1fr]">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
                  <p className="text-[11px] text-muted-foreground break-words">{m.contact ?? "Usuário do app"}</p>
                </div>
                <div>
                  <Badge variant="secondary" className="text-[11px]">
                    {m.source} · {m.direction === "inbound" ? "recebida" : "respondida"}
                  </Badge>
                </div>
                <p className="break-words text-sm text-muted-foreground">{m.preview}</p>
              </article>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function TimelinePanel({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["admin_message_timeline", id],
    queryFn: () => fetchTimeline(id),
  });
  if (q.isLoading) return <p className="mt-2 pl-4 text-xs text-muted-foreground">Carregando…</p>;
  if (q.isError || !q.data) return <p className="mt-2 pl-4 text-xs text-destructive">Não foi possível carregar a linha do tempo.</p>;
  const events = q.data.events ?? [];
  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-muted/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Linha do tempo</p>
      <ol className="mt-2 space-y-1.5">
        <li className="grid gap-1 md:grid-cols-[160px_1fr] text-xs">
          <span className="text-muted-foreground">{new Date(q.data.message.created_at).toLocaleString("pt-BR")}</span>
          <span>Criada — status inicial <b>queued</b>.</span>
        </li>
        {q.data.message.sent_at && (
          <li className="grid gap-1 md:grid-cols-[160px_1fr] text-xs">
            <span className="text-muted-foreground">{new Date(q.data.message.sent_at).toLocaleString("pt-BR")}</span>
            <span>Enviada ao provedor{q.data.message.provider_message_id ? ` (id ${q.data.message.provider_message_id.slice(0, 12)}…)` : ""}.</span>
          </li>
        )}
        {events.map((e: TimelineEvent) => (
          <li key={e.id} className="grid gap-1 md:grid-cols-[160px_1fr] text-xs">
            <span className="text-muted-foreground">{new Date(e.occurred_at).toLocaleString("pt-BR")}</span>
            <span>ACK: <b>{e.status}</b></span>
          </li>
        ))}
        {q.data.message.last_error && (
          <li className="grid gap-1 md:grid-cols-[160px_1fr] text-xs text-destructive">
            <span>Última tentativa</span>
            <span className="break-words">{q.data.message.last_error}</span>
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
      <BreakdownCard title="Por superfície" data={metrics.by_surface} labelMap={SURFACE_LABEL} />
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
                  <span className="ml-2 text-muted-foreground font-numeric tabular-nums">{value} · {pct}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
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
