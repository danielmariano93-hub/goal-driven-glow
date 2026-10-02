import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, RefreshCw, Siren } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { MetricTile } from "@/components/admin/kit/MetricTile";
import { ChartLegend, SmoothChart, type SmoothSeries } from "@/components/admin/kit/SmoothChart";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";
import { adminErrorMessage } from "@/lib/admin/adminRpc";
import { useCommandCenter } from "@/lib/admin/useCommandCenter";
import {
  buildAttention, errorLabel, formatCompact, formatInt, formatMs, formatPct, formatUsd, pathLabel, pctDelta,
  type AttentionItem, type CommandCenterData,
} from "@/lib/admin/commandCenter";

const PERIODS = [7, 14, 30] as const;

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

function Panel({ title, subtitle, legend, children }: { title: string; subtitle?: string; legend?: SmoothSeries[]; children: React.ReactNode }) {
  return (
    <section className="surface-card min-w-0 space-y-3 p-4 md:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {legend && <ChartLegend series={legend} />}
      </header>
      {children}
    </section>
  );
}

const SEVERITY = {
  critical: { icon: Siren, ring: "border-destructive/40 bg-destructive/5", tone: "text-destructive", label: "Urgente" },
  warning: { icon: AlertTriangle, ring: "border-warning/50 bg-warning/5", tone: "text-warning", label: "Atenção" },
  info: { icon: Info, ring: "border-border bg-card", tone: "text-primary", label: "Para observar" },
} as const;

function AttentionBoard({ items }: { items: AttentionItem[] }) {
  if (!items.length) {
    return (
      <div className="surface-card flex items-center gap-3 border-success/30 p-4">
        <CheckCircle2 className="text-success" size={22} aria-hidden />
        <div>
          <p className="font-semibold">Nada precisa de ação agora</p>
          <p className="text-xs text-muted-foreground">Falhas, tempo de resposta, entrega de mensagens e custo estão dentro do esperado.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-label="O que precisa de ação">
      {items.map((item) => {
        const s = SEVERITY[item.severity];
        const Icon = s.icon;
        return (
          <li key={item.key} className={`rounded-2xl border p-4 ${s.ring}`}>
            <div className="flex items-start gap-3">
              <Icon size={18} className={`mt-0.5 shrink-0 ${s.tone}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${s.tone}`}>{s.label}</p>
                <p className="font-semibold leading-snug">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                {item.to && (
                  <Link to={item.to} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Ver e agir <ArrowRight size={12} aria-hidden />
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RankedBars({
  rows, empty,
}: {
  rows: Array<{ key: string; label: string; value: number; valueLabel: string; meta?: string; danger?: boolean }>;
  empty: string;
}) {
  if (!rows.length) return <p className="rounded-2xl bg-secondary/40 px-3 py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums font-semibold">{r.valueLabel}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full ${r.danger ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }}
            />
          </div>
          {r.meta && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.meta}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Gráficos e rankings de desempenho da IA (latência, tokens, custo, modelos). */
export function AiPerformance({ data }: { data: CommandCenterData }) {
  const daily = data.daily;
  const latency: SmoothSeries[] = [
    { key: "p50", label: "Típica (mediana)", kind: "area", color: "hsl(var(--primary))", format: formatMs },
    { key: "p95", label: "Mais lentas (95%)", kind: "line", color: "hsl(var(--warning))", dashed: true, format: formatMs },
  ];
  const tokens: SmoothSeries[] = [
    { key: "tokens", label: "Tokens", kind: "area", color: "hsl(var(--primary))", format: formatInt },
    { key: "cost_usd", label: "Custo estimado", kind: "line", axis: "right", color: "hsl(var(--success))", format: formatUsd },
  ];
  const tokenData = daily.map((d) => ({ ...d, tokens: d.tokens_in + d.tokens_out }));
  const t = data.totals;
  const perTurn = t.turns > 0 ? t.cost / t.turns : 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tempo de resposta" subtitle="Da pergunta até a resposta, por dia" legend={latency}>
          <SmoothChart data={daily} xKey="day" series={latency} formatX={dayLabel} formatY={formatMs} />
        </Panel>
        <Panel title="Tokens e custo estimado" subtitle={`≈ ${formatUsd(perTurn)} por conversa · ${data.cost_note}`} legend={tokens}>
          <SmoothChart data={tokenData} xKey="day" series={tokens} formatX={dayLabel} formatY={formatCompact} formatYRight={(v) => `$${v.toFixed(3).replace(".", ",")}`} />
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Por modelo" subtitle="Quanto cada modelo responde, quão rápido e quanto falha">
          <RankedBars
            empty="Sem conversas no período."
            rows={data.by_model.map((m) => ({
              key: m.model_family,
              label: m.model_family,
              value: m.turns,
              valueLabel: `${formatInt(m.turns)} conversas`,
              danger: m.error_rate >= 0.25 && m.model_family !== "sem LLM",
              meta: `típica ${formatMs(m.p50)} · lentas ${formatMs(m.p95)} · falha ${formatPct(m.error_rate)}${m.tokens ? ` · ${formatCompact(m.tokens)} tokens · ${formatUsd(m.cost_usd)}` : ""}`,
            }))}
          />
        </Panel>
        <Panel title="Por caminho de resposta" subtitle="Como o Nino resolveu cada pergunta">
          <RankedBars
            empty="Sem conversas no período."
            rows={data.by_path.map((p) => ({
              key: p.path,
              label: pathLabel(p.path),
              value: p.turns,
              valueLabel: `${formatInt(p.turns)}`,
              danger: p.error_rate >= 0.25,
              meta: `lentas ${formatMs(p.p95)} · falha ${formatPct(p.error_rate)}`,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

function Overview({ data }: { data: CommandCenterData }) {
  const t = data.totals;
  const attention = useMemo(() => buildAttention(data), [data]);
  const daily = data.daily;
  const success = 1 - t.err_rate;
  const successPrev = 1 - t.err_rate_prev;
  const volume: SmoothSeries[] = [
    { key: "turns", label: "Conversas", kind: "area", color: "hsl(var(--primary))", format: formatInt },
    { key: "errors", label: "Com falha", kind: "line", color: "hsl(var(--destructive))", format: formatInt },
  ];
  const msg: SmoothSeries[] = [
    { key: "delivered", label: "Entregues", kind: "area", color: "hsl(var(--success))", format: formatInt },
    { key: "failed", label: "Falharam", kind: "line", color: "hsl(var(--destructive))", format: formatInt },
  ];
  const spark = (k: keyof CommandCenterData["daily"][number]) => daily.map((d) => Number(d[k] ?? 0));
  const perTurn = t.turns > 0 ? t.cost / t.turns : 0;

  return (
    <div className="space-y-6">
      <AttentionBoard items={attention} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricTile label="Conversas" value={formatInt(t.turns)} deltaPct={pctDelta(t.turns, t.turns_prev)} polarity="higher_is_better" spark={spark("turns")} />
        <MetricTile label="Pessoas atendidas" value={formatInt(t.users)} deltaPct={pctDelta(t.users, t.users_prev)} polarity="higher_is_better" spark={spark("users")} />
        <MetricTile label="Respostas sem falha" value={formatPct(success)} deltaPct={pctDelta(success, successPrev)} polarity="higher_is_better" spark={daily.map((d) => (d.turns ? 100 - (d.errors / d.turns) * 100 : 100))} hint={`${formatInt(Math.round(t.err_rate * t.turns))} falharam`} />
        <MetricTile label="Tempo típico" value={formatMs(t.p50)} deltaPct={pctDelta(t.p50, t.p50_prev)} polarity="lower_is_better" spark={spark("p50")} hint={`as mais lentas: ${formatMs(t.p95)}`} />
        <MetricTile label="Tokens" value={formatCompact(t.tin + t.tout)} deltaPct={pctDelta(t.tin + t.tout, t.tok_prev)} polarity="neutral" spark={daily.map((d) => d.tokens_in + d.tokens_out)} hint={`${formatCompact(t.tin)} entrada · ${formatCompact(t.tout)} saída`} />
        <MetricTile label="Custo estimado" value={formatUsd(t.cost)} deltaPct={pctDelta(t.cost, t.cost_prev)} polarity="lower_is_better" spark={spark("cost_usd")} hint={`≈ ${formatUsd(perTurn)} por conversa`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Conversas por dia" subtitle="Volume e quantas terminaram em falha" legend={volume}>
          <SmoothChart data={daily} xKey="day" series={volume} formatX={dayLabel} />
        </Panel>
        <Panel title="Mensagens enviadas pelo Nino" subtitle={`${formatInt(data.messaging.delivered)} entregues de ${formatInt(data.messaging.total)} no período`} legend={msg}>
          <SmoothChart data={data.messaging.daily} xKey="day" series={msg} formatX={dayLabel} />
        </Panel>
      </div>

      <AiPerformance data={data} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="O que mais dá errado" subtitle="Causas das conversas com falha, da mais frequente para a menos">
          <RankedBars
            empty="Nenhuma falha no período."
            rows={data.top_errors.map((e) => ({
              key: e.reason,
              label: errorLabel(e.reason),
              value: e.n,
              valueLabel: `${e.n}×`,
              danger: true,
              meta: `última em ${new Date(e.last_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
            }))}
          />
        </Panel>
        <Panel title="Por canal" subtitle="Onde as pessoas conversam com o Nino">
          <RankedBars
            empty="Sem conversas no período."
            rows={data.by_channel.map((c) => ({
              key: c.channel,
              label: c.channel === "whatsapp" ? "WhatsApp" : c.channel === "app" ? "App" : c.channel,
              value: c.turns,
              valueLabel: formatInt(c.turns),
              danger: c.error_rate >= 0.25,
              meta: `lentas ${formatMs(c.p95)} · falha ${formatPct(c.error_rate)}`,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

export function PeriodSwitch({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="group" aria-label="Período">
      {PERIODS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={days === d}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {d} dias
        </button>
      ))}
    </div>
  );
}

export default function CentralDeComando() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("dias"));
  const days = (PERIODS as readonly number[]).includes(requested) ? requested : 7;
  const q = useCommandCenter(days);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
        description="O que precisa de ação agora, e como o Nino está em qualidade, velocidade, custo e entrega. Usuários de teste e o simulador ficam de fora."
        actions={
          <>
            <PeriodSwitch days={days} onChange={(d) => setParams({ dias: String(d) }, { replace: true })} />
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              aria-label="Atualizar"
            >
              <RefreshCw size={13} className={q.isFetching ? "animate-spin" : ""} aria-hidden /> Atualizar
            </button>
          </>
        }
      />
      {q.isLoading && <SkeletonTable />}
      {q.isError && <p className="surface-card p-4 text-sm text-destructive">{adminErrorMessage(q.error, "Não foi possível carregar a visão geral")}</p>}
      {q.data && <Overview data={q.data} />}
      {q.data && (
        <p className="text-[11px] text-muted-foreground">
          Atualizado às {new Date(q.data.generated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · atualiza sozinho a cada minuto · período anterior = os {days} dias antes.
        </p>
      )}
    </div>
  );
}
