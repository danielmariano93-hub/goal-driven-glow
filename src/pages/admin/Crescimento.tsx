import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable as AdminSkeleton } from "@/components/admin/AdminSkeleton";
import { EmptyState } from "@/components/admin/EmptyState";
import { growthInsights, retentionTone } from "@/lib/admin/growthInsights";
import { adminErrorMessage, callAdminRpc, withPeriod } from "@/lib/admin/adminRpc";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { resolvePreset, type PeriodPresetKey, type PeriodRange } from "@/lib/admin/periodPresets";
import { dict } from "@/lib/admin/displayDictionary";
import { FunnelBars } from "@/components/admin/kit/FunnelBars";

/** Agrupa as linhas por experiência e ordena as etapas como um funil real. */
function groupFunnel(rows: FunnelRow[]) {
  const map = new Map<string, FunnelRow[]>();
  for (const row of rows) {
    const list = map.get(row.feature) ?? [];
    list.push(row);
    map.set(row.feature, list);
  }
  return Array.from(map.entries())
    .map(([feature, steps]) => ({
      feature,
      steps: [...steps].sort((a, b) => b.users - a.users || b.events - a.events),
    }))
    .sort((a, b) => (b.steps[0]?.users ?? 0) - (a.steps[0]?.users ?? 0));
}

type Summary = {
  total_clients: number;
  new_clients: number;
  active_clients: number;
  activated_clients: number;
  dormant_clients: number;
  with_financial_data: number;
  period: { from: string; to: string; timezone: string };
  formula_version: string;
  universe: string;
};

type CohortRow = {
  cohort_week: string;
  week_offset: number;
  activated_users: number;
  retained_users: number;
  retention_rate: number;
};

type FunnelRow = { feature: string; step: string; users: number; events: number };
type Cohorts = { cohorts: CohortRow[] };
type Funnel = { funnel: FunnelRow[]; source_quality?: { live: number; backfill: number; proxy: number } };

export default function Crescimento() {
  const [preset, setPreset] = useState<PeriodPresetKey>("30d");
  const [range, setRange] = useState<PeriodRange>(() => resolvePreset("30d"));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cohorts, setCohorts] = useState<Cohorts | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setCohorts(null);
    setFunnel(null);

    Promise.allSettled([
      callAdminRpc<Summary>("admin_v2_growth_summary", withPeriod(range)),
      callAdminRpc<Cohorts>("admin_v2_growth_cohorts", { _weeks: 8 }),
      callAdminRpc<Funnel>("admin_v2_growth_funnel", { _days: Math.max(1, daysBetween(range)) }),
    ])
      .then(([summaryResult, cohortsResult, funnelResult]) => {
        if (summaryResult.status === "rejected") {
          setSummary(null);
          setError(adminErrorMessage(summaryResult.reason, "Falha ao carregar o resumo de crescimento"));
          return;
        }

        setSummary(summaryResult.value);
        if (cohortsResult.status === "fulfilled") {
          setCohorts(cohortsResult.value);
        }
        if (funnelResult.status === "fulfilled") {
          setFunnel(funnelResult.value);
        }
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const quality = funnel?.source_quality;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crescimento e retenção"
        description="Entenda quem chega, quem recebe valor e quem continua usando o Nino."
        actions={
          <AdminDateFilter
            preset={preset}
            value={range}
            onChange={({ preset: p, range: r }) => {
              setPreset(p);
              setRange(r);
            }}
          />
        }
      />

      {loading ? (
        <AdminSkeleton />
      ) : error ? (
        <EmptyState title="Não foi possível carregar o resumo" description={error} />
      ) : summary ? (
        <>
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Leitura do crescimento">
            {growthInsights(summary).map((i) => (
              <li key={i.key} className={`rounded-2xl border p-4 ${i.tone === "danger" ? "border-destructive/40 bg-destructive/5" : i.tone === "warning" ? "border-warning/50 bg-warning/5" : i.tone === "success" ? "border-success/30 bg-success/5" : "border-border bg-card"}`}>
                <p className="font-semibold leading-snug">{i.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>
              </li>
            ))}
          </ul>
          <section className="surface-card space-y-3 p-4 md:p-5">
            <h2 className="font-display text-base font-semibold">Da chegada ao uso</h2>
            <p className="text-xs text-muted-foreground">Quantos clientes existem em cada estágio agora e quantos chegaram no período.</p>
            <FunnelBars
              title=""
              steps={[
                { label: "Clientes cadastrados", users: summary.total_clients, events: 0 },
                { label: "Com dados financeiros", users: summary.with_financial_data, events: 0 },
                { label: "Ativados no período", users: summary.activated_clients, events: 0 },
                { label: "Ativos no período", users: summary.active_clients, events: 0 },
              ]}
            />
            <p className="text-xs text-muted-foreground">Novos no período: <b className="text-foreground">{summary.new_clients}</b> · Dormentes: <b className="text-foreground">{summary.dormant_clients}</b></p>
          </section>
        </>
      ) : null}

      {quality && quality.live === 0 ? (
        <div className="rounded-2xl border border-[#6D4AFF]/20 bg-[#6D4AFF]/5 p-4 text-sm">
          O histórico atual foi reconstruído por backfill/proxy. Tendências ficarão mais confiáveis após a instrumentação live acumular dados.
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Funil das experiências</h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Quantos clientes chegam a cada etapa de cada experiência e onde eles param.
        </p>
        {loading ? (
          <AdminSkeleton />
        ) : funnel?.funnel?.length ? (
          <div className="space-y-5">
            {groupFunnel(funnel.funnel).map((group) => (
              <FunnelBars
                key={group.feature}
                title={dict.feature(group.feature)}
                steps={group.steps.map((s) => ({
                  label: dict.step(s.step),
                  users: s.users,
                  events: s.events,
                }))}
                caption={
                  group.steps[0]?.users != null && group.steps[0].users < 5
                    ? "Amostra pequena: não leia tendência aqui."
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Ainda não há eventos live suficientes para desenhar o funil" />
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 font-semibold">Retenção por coorte</h2>
        {loading ? (
          <AdminSkeleton />
        ) : cohorts?.cohorts?.length ? (
          <RetentionGrid rows={cohorts.cohorts} />
        ) : (
          <EmptyState
            title="Ainda não há histórico suficiente para calcular retenção"
            description="A primeira leitura aparecerá quando a janela mínima de coorte for concluída."
          />
        )}
      </section>
    </div>
  );
}

function RetentionGrid({ rows }: { rows: CohortRow[] }) {
  const weeks = [...new Set(rows.map((r) => r.cohort_week))].sort();
  const offsets = [...new Set(rows.map((r) => r.week_offset))].sort((a, b) => a - b);
  const cell = (w: string, o: number) => rows.find((r) => r.cohort_week === w && r.week_offset === o);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-center text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 pr-2 text-left font-medium">Entrada</th>
            <th className="px-1 font-medium">Ativados</th>
            {offsets.map((o) => <th key={o} className="px-1 font-medium">Sem. {o}</th>)}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const base = cell(w, offsets[0]);
            return (
              <tr key={w}>
                <td className="py-1 pr-2 text-left tabular-nums">{w.slice(5).split("-").reverse().join("/")}</td>
                <td className="px-1 tabular-nums">{base?.activated_users ?? "—"}</td>
                {offsets.map((o) => {
                  const c = cell(w, o);
                  const rate = c ? (c.retention_rate > 1 ? c.retention_rate / 100 : c.retention_rate) : null;
                  return <td key={o} className="p-0.5"><div className={`rounded-md py-1 tabular-nums ${retentionTone(rate)}`}>{rate == null ? "·" : `${Math.round(rate * 100)}%`}</div></td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">Cada linha é uma semana de entrada; cada coluna, a fração que continuou usando depois de N semanas. Verde = retém bem, vermelho = perde rápido.</p>
    </div>
  );
}

function daysBetween(range: PeriodRange): number {
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000) + 1;
}
