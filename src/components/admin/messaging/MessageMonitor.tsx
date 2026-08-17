import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonList } from "@/components/admin/AdminSkeleton";
import { MetricRow, MetricTile } from "@/components/admin/kit/MetricTile";
import { HealthPill, type PillTone } from "@/components/admin/kit/HealthPill";
import { SidePanel } from "@/components/admin/kit/SidePanel";
import { Timeline, type TimelineStep } from "@/components/admin/kit/Timeline";
import { adminToast } from "@/components/admin/adminToast";
import { dict } from "@/lib/admin/displayDictionary";
import {
  fetchMessages,
  fetchMetrics,
  fetchTimeline,
  reprocessMessage,
  type MessageRow,
} from "@/lib/admin/messageCenter";

const PERIODS = [
  { days: 1, label: "24 horas" },
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
];

const STATUS: Array<{ id: string; label: string; tone: PillTone }> = [
  { id: "queued", label: "Na fila", tone: "info" },
  { id: "processing", label: "Processando", tone: "info" },
  { id: "sent", label: "Enviada", tone: "success" },
  { id: "delivered", label: "Entregue", tone: "success" },
  { id: "read", label: "Lida", tone: "success" },
  { id: "failed", label: "Falhou", tone: "danger" },
  { id: "dead", label: "Desistiu", tone: "danger" },
];

function statusView(status: string) {
  return STATUS.find((s) => s.id === status) ?? { id: status, label: status, tone: "neutral" as PillTone };
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Monitor por mensagem: o que foi enviado, para quem, o que aconteceu e por quê.
 * Traduz o erro do provedor e permite reprocessar sem sair da tela.
 */
export function MessageMonitor() {
  const qc = useQueryClient();
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState<string>("");
  const [surface, setSurface] = useState<string>("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const range = useMemo(
    () => ({ from: isoDaysAgo(days), to: new Date().toISOString() }),
    [days],
  );

  const metrics = useQuery({
    queryKey: ["admin_message_metrics", range.from],
    queryFn: () => fetchMetrics(range.from, range.to),
    staleTime: 30_000,
  });

  const list = useQuery({
    queryKey: ["admin_message_activity", range.from, status, surface, term],
    queryFn: () =>
      fetchMessages({
        from: range.from,
        to: range.to,
        status: status || null,
        surface: surface || null,
        search: term || null,
        limit: 200,
      }),
    staleTime: 20_000,
  });

  const timeline = useQuery({
    queryKey: ["admin_message_timeline", openId],
    enabled: !!openId,
    queryFn: () => fetchTimeline(openId!),
  });

  const retry = useMutation({
    mutationFn: (id: string) => reprocessMessage(id),
    onSuccess: async () => {
      adminToast.success("Mensagem recolocada na fila de envio");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin_message_activity"] }),
        qc.invalidateQueries({ queryKey: ["admin_message_timeline"] }),
        qc.invalidateQueries({ queryKey: ["admin_message_metrics"] }),
      ]);
    },
    onError: () => adminToast.error("Não foi possível reprocessar agora. Tente novamente."),
  });

  const m = metrics.data;
  const rows = list.data ?? [];
  const current = timeline.data?.message ?? rows.find((r) => r.id === openId) ?? null;

  const steps: TimelineStep[] = (timeline.data?.events ?? []).map((event) => ({
    id: event.id,
    label: statusView(event.status).label,
    at: event.occurred_at,
    tone: statusView(event.status).tone,
  }));

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricTile label="Mensagens no período" value={(m?.total ?? 0).toLocaleString("pt-BR")} />
        <MetricTile
          label="Taxa de entrega"
          value={`${(m?.delivery_rate ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          hint={`${(m?.delivered ?? 0).toLocaleString("pt-BR")} entregues · fora do app`}
        />
        <MetricTile
          label="Falhas"
          value={(m?.failed ?? 0).toLocaleString("pt-BR")}
          hint={m?.failed ? "há mensagens para reprocessar" : "nenhuma falha registrada"}
        />
        <MetricTile
          label="Tempo até enviar"
          value={
            m?.avg_queued_to_sent_ms
              ? `${Math.round(m.avg_queued_to_sent_ms / 1000)}s`
              : "—"
          }
          hint="média entre entrar na fila e sair"
        />
      </MetricRow>

      <div className="surface-card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setDays(p.days)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                days === p.days
                  ? "bg-gradient-brand text-primary-foreground shadow-brand"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filtrar por situação"
            className="h-9 rounded-xl border border-border bg-background px-3 text-xs"
          >
            <option value="">Todas as situações</option>
            {STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            aria-label="Filtrar por canal"
            className="h-9 rounded-xl border border-border bg-background px-3 text-xs"
          >
            <option value="">Todos os canais</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="app">Aplicativo</option>
          </select>
        </div>
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(search.trim());
          }}
          role="search"
        >
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por destinatário, conteúdo ou cliente"
            className="h-9 pl-9"
            aria-label="Buscar mensagem"
          />
        </form>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          <RefreshCw size={14} className={list.isFetching ? "animate-spin" : ""} />
          Atualizar
        </Button>
      </div>

      {list.isLoading ? (
        <SkeletonList rows={6} />
      ) : list.isError ? (
        <EmptyState
          title="Não foi possível carregar as mensagens"
          description="Tente novamente em instantes."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhuma mensagem no período"
          description="Amplie o período ou limpe os filtros para ver o histórico."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Quando</th>
                  <th className="px-4 py-3 font-semibold">Fluxo</th>
                  <th className="px-4 py-3 font-semibold">Canal</th>
                  <th className="px-4 py-3 font-semibold">Destinatário</th>
                  <th className="px-4 py-3 font-semibold">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setOpenId(row.id)}
                    className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-secondary/60"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {when(row.sent_at ?? row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{dict.feature(row.feature ?? "unknown")}</p>
                      <p className="max-w-[420px] truncate text-xs text-muted-foreground">{row.preview}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">{dict.channel(row.channel)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.recipient}</td>
                    <td className="px-4 py-3">
                      <HealthPill tone={statusView(row.status).tone}>
                        {statusView(row.status).label}
                      </HealthPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setOpenId(row.id)}
                className="surface-card p-4 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold">
                    {dict.feature(row.feature ?? "unknown")}
                  </p>
                  <HealthPill tone={statusView(row.status).tone}>
                    {statusView(row.status).label}
                  </HealthPill>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.preview}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {dict.channel(row.channel)} · {when(row.sent_at ?? row.created_at)}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      <MessageDetail
        row={current}
        steps={steps}
        loading={timeline.isLoading}
        onClose={() => setOpenId(null)}
        onRetry={(id) => retry.mutate(id)}
        retrying={retry.isPending}
      />
    </div>
  );
}

function MessageDetail({
  row,
  steps,
  loading,
  onClose,
  onRetry,
  retrying,
}: {
  row: MessageRow | null;
  steps: TimelineStep[];
  loading: boolean;
  onClose: () => void;
  onRetry: (id: string) => void;
  retrying: boolean;
}) {
  const canRetry = !!row && ["failed", "dead", "queued"].includes(row.status);
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={row ? dict.feature(row.feature ?? "unknown") : "Mensagem"}
      description={row ? `${dict.channel(row.channel)} · ${when(row.created_at)}` : undefined}
      footer={
        row ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            {canRetry && (
              <Button onClick={() => onRetry(row.id)} disabled={retrying}>
                {retrying ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
                Reprocessar
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {!row ? null : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            <HealthPill tone={statusView(row.status).tone}>{statusView(row.status).label}</HealthPill>
            <HealthPill tone="neutral">{row.attempts} tentativa(s)</HealthPill>
            {row.surface && <HealthPill tone="info">{dict.surface(row.surface)}</HealthPill>}
          </div>

          <div className="surface-card p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Conteúdo enviado
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{row.preview}</p>
            <p className="mt-3 text-[11px] text-muted-foreground">Para {row.recipient}</p>
          </div>

          {row.last_error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-xs font-semibold text-destructive">Por que falhou</p>
              <p className="mt-1 text-xs text-destructive/90">
                {dict.commReason(row.last_error) || row.last_error}
              </p>
            </div>
          )}

          <div>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Caminho da mensagem
            </p>
            {loading ? (
              <p className="text-xs text-muted-foreground">Carregando eventos…</p>
            ) : (
              <Timeline steps={steps} />
            )}
          </div>
        </div>
      )}
    </SidePanel>
  );
}
