import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, RefreshCw, Siren } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { MetricTile } from "@/components/admin/kit/MetricTile";
import { ChartLegend, SmoothChart, type SmoothSeries } from "@/components/admin/kit/SmoothChart";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";
import { adminErrorMessage } from "@/lib/admin/adminRpc";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { PRESET_LABELS, resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";
import { useCommandCenter, useOpsHealth } from "@/lib/admin/useCommandCenter";
import { dict } from "@/lib/admin/displayDictionary";
import {
  buildAttention, errorLabel, modelName, serviceState, servicesAttention, type OpsService, formatCompact, formatInt, formatMs, formatPct, formatUsd, pathLabel, pctDelta,
  type AttentionItem, type CommandCenterData,
} from "@/lib/admin/commandCenter";

const dayLabel = (iso: string) => {
  const [date, hour] = iso.split("T");
  const [, m, d] = date.split("-");
  return hour ? `${hour.slice(0, 2)}h` : `${d}/${m}`;
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

/** Comparativo de modelos: acerto de primeira, tempo, falha final e custo por 1.000 conversas. */
export function ModelComparison({ models }: { models: CommandCenterData["by_model"] }) {
  const rows = models.filter((m) => m.turns > 0 || m.attempts > 0);
  if (!rows.length) return <p className="rounded-2xl bg-secondary/40 px-3 py-6 text-center text-xs text-muted-foreground">Sem chamadas de IA no período.</p>;
  return (
    <ul className="space-y-4">
      {rows.map((m) => {
        const firstTry = m.first_try_failure_rate == null ? null : 1 - m.first_try_failure_rate;
        const per1k = m.turns > 0 ? (m.cost_usd / m.turns) * 1000 : null;
        const tone = firstTry == null ? "bg-primary" : firstTry >= 0.9 ? "bg-success" : firstTry >= 0.75 ? "bg-warning" : "bg-destructive";
        return (
          <li key={m.model} className="space-y-2 rounded-2xl border border-border/60 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate font-semibold">{modelName(m.model)}</p>
              <p className="shrink-0 text-xs text-muted-foreground">{formatInt(m.turns)} atendidas · {formatInt(m.attempts)} tentativas</p>
            </div>
            <div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Acerta de primeira</span><span className="font-semibold tabular-nums">{firstTry == null ? "—" : formatPct(firstTry)}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(3, (firstTry ?? 1) * 100)}%` }} /></div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Típico</dt><dd className="font-semibold tabular-nums">{formatMs(m.p50)}</dd></div>
              <div><dt className="text-muted-foreground">Mais lentas</dt><dd className="font-semibold tabular-nums">{formatMs(m.p95)}</dd></div>
              <div><dt className="text-muted-foreground">Falha final</dt><dd className={`font-semibold tabular-nums ${m.error_rate >= 0.25 ? "text-destructive" : ""}`}>{m.turns ? formatPct(m.error_rate) : "—"}</dd></div>
              <div><dt className="text-muted-foreground">Custo / 1.000</dt><dd className="font-semibold tabular-nums">{per1k == null ? "—" : formatUsd(per1k)}</dd></div>
            </dl>
            {m.escalated > 0 && <p className="text-[11px] text-muted-foreground">{m.escalated} vezes escalado para um modelo maior.</p>}
          </li>
        );
      })}
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
        <Panel title="Eficiência por modelo" subtitle="Quem acerta de primeira, quão rápido responde e quanto custa">
          <ModelComparison models={data.by_model} />
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

function SystemRoutines({ services }: { services: OpsService[] }) {
  if (!services.length) return null;
  const rows = [...services].sort((a, b) => {
    const rank = { stale: 0, failing: 1, ok: 2 } as const;
    return rank[serviceState(a)] - rank[serviceState(b)];
  });
  const bad = rows.filter((s) => serviceState(s) !== "ok").length;
  return (
    <details className="surface-card p-4 md:p-5" open={bad > 0}>
      <summary className="cursor-pointer font-display text-base font-semibold">
        Rotinas do sistema <span className="ml-1 text-xs font-normal text-muted-foreground">{bad ? `${bad} com problema` : `${rows.length} saudáveis`}</span>
      </summary>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.map((s) => {
          const st = serviceState(s);
          return (
            <li key={s.job_key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${st === "ok" ? "bg-success" : st === "failing" ? "bg-warning" : "bg-destructive"}`} aria-hidden />
                <span className="truncate">{dict.job(s.job_key)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{s.last_run_at ? new Date(s.last_run_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca"}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Overview({ data }: { data: CommandCenterData }) {
  const t = data.totals;
  const ops = useOpsHealth();
  const attention = useMemo(
    () => buildAttention(data, servicesAttention(ops.data?.services ?? [], (k) => dict.job(k))),
    [data, ops.data],
  );
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

      <SystemRoutines services={ops.data?.services ?? []} />

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

export function usePeriodParams(defaultPreset: PeriodPresetKey = "7d") {
  const [params, setParams] = useSearchParams();
  const raw = params.get("periodo") as PeriodPresetKey | null;
  const preset: PeriodPresetKey = raw && raw in PRESET_LABELS ? raw : defaultPreset;
  const from = params.get("de");
  const to = params.get("ate");
  const range: PeriodRange = preset === "custom" && from && to ? { from, to } : resolvePreset(preset === "custom" ? defaultPreset : preset);
  const setPeriod = (next: { preset: PeriodPresetKey; range: PeriodRange }) =>
    setParams((p) => {
      p.set("periodo", next.preset);
      if (next.preset === "custom") { p.set("de", next.range.from); p.set("ate", next.range.to); } else { p.delete("de"); p.delete("ate"); }
      return p;
    }, { replace: true });
  return { preset, range, setPeriod };
}

export default function CentralDeComando() {
  const { preset, range, setPeriod } = usePeriodParams("7d");
  const q = useCommandCenter(range);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
        description="O que precisa de ação agora, e como o Nino está em qualidade, velocidade, custo e entrega. Usuários de teste e o simulador ficam de fora."
        actions={
          <>
            <AdminDateFilter value={range} preset={preset} onChange={setPeriod} />
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
          Atualizado às {new Date(q.data.generated_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · atualiza sozinho a cada minuto · comparação com o período anterior de mesmo tamanho · {q.data.granularity === "hour" ? "gráficos por hora" : "gráficos por dia"}.
        </p>
      )}
    </div>
  );
}
