import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { formatInt, formatMs } from "@/lib/admin/commandCenter";
import { DEVICE_LABEL, perfTone, screenLabel, TONE_TEXT, trendPct, type PerfTone, type ScreenPerfReport } from "@/lib/admin/screenPerf";
import { ChartLegend, SmoothChart, type SmoothSeries } from "@/components/admin/kit/SmoothChart";
import { MetricTile } from "@/components/admin/kit/MetricTile";

const TONE_CLASS: Record<PerfTone, string> = {
  bom: "bg-success/15 text-success", atencao: "bg-warning/15 text-warning", ruim: "bg-destructive/15 text-destructive", sem_dados: "bg-secondary text-muted-foreground",
};
const BAR_CLASS: Record<PerfTone, string> = { bom: "bg-success", atencao: "bg-warning", ruim: "bg-destructive", sem_dados: "bg-primary" };

export function useScreenPerf(days: number) {
  return useQuery({
    queryKey: ["admin-perf-screens", days],
    queryFn: () => callAdminRpc<ScreenPerfReport>("admin_perf_screens", { _days: days }),
    staleTime: 60_000,
  });
}

const dayLabel = (iso: string) => { const [, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}`; };

/** Indicador "Tela pronta": quanto tempo as pessoas esperam para uma tela ficar utilizável, medido no aparelho delas. */
export function ScreenPerformanceBoard({ days }: { days: number }) {
  const q = useScreenPerf(days);
  const r = q.data;
  const series: SmoothSeries[] = [
    { key: "p75", label: "3 em cada 4 aberturas (p75)", kind: "area", color: "hsl(var(--primary))", format: formatMs },
    { key: "p50", label: "Típica (mediana)", kind: "line", color: "hsl(var(--success))", format: formatMs, dashed: true },
  ];
  const tone = perfTone(r?.soft.p75);
  const trend = r ? trendPct(r.daily) : null;
  return (
    <section className="space-y-4" aria-labelledby="perf-telas">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="perf-telas" className="flex items-center gap-2 font-display text-base font-semibold"><Gauge size={16} aria-hidden /> Velocidade das telas</h2>
          <p className="max-w-3xl text-xs text-muted-foreground">
            Quanto tempo a pessoa espera, no celular dela, entre abrir uma tela e ela ficar pronta (conteúdo na tela e sem carregamento pendente).
            Usamos o p75 (3 em cada 4 aberturas levam até esse tempo), que representa melhor o que se sente do que a média. Boa: até 2 s · Atenção: até 4 s · Lenta: acima.
          </p>
        </div>
        {r && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}>{TONE_TEXT[tone]}</span>}
      </header>

      {q.isLoading && <p className="rounded-2xl bg-secondary/40 px-3 py-6 text-center text-xs text-muted-foreground">Carregando…</p>}
      {q.isError && <p className="rounded-2xl bg-destructive/10 px-3 py-6 text-center text-xs text-destructive">Não consegui ler as medições agora.</p>}
      {r && r.overall.n === 0 && (
        <p className="rounded-2xl bg-secondary/40 px-3 py-6 text-center text-xs text-muted-foreground">
          Ainda sem medições. Elas aparecem assim que as pessoas usarem a versão nova do app (a medição é automática e não coleta dados pessoais).
        </p>
      )}
      {r && r.overall.n > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricTile label="Tela pronta (p75)" value={formatMs(r.soft.p75)} polarity="lower_is_better" deltaPct={trend} hint="Ao navegar entre telas já dentro do app." emphasis />
            <MetricTile label="Aberturas rápidas" value={r.overall.fast_pct == null ? "—" : `${String(r.overall.fast_pct).replace(".", ",")}%`} polarity="higher_is_better" hint="Prontas em até 2 s (3 s na primeira abertura do app)." />
            <MetricTile label="Abrir o app (p75)" value={formatMs(r.cold.p75)} polarity="lower_is_better" hint={r.cold.n ? `${formatInt(r.cold.n)} aberturas · 1º conteúdo ${formatMs(r.cold.fcp_p75)} · maior elemento ${formatMs(r.cold.lcp_p75)}` : "Sem aberturas diretas no período."} />
            <MetricTile label="Medições" value={formatInt(r.overall.n)} hint={`${formatInt(r.overall.users)} pessoa(s) · ${formatInt(r.overall.timed_out)} sem terminar em 20 s`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="surface-card min-w-0 space-y-3 p-4 md:p-5">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-display text-sm font-semibold">Evolução por dia</h3><p className="text-xs text-muted-foreground">Para ver se uma versão nova melhorou ou piorou.</p></div>
                <ChartLegend series={series} />
              </header>
              <SmoothChart data={r.daily} xKey="day" series={series} formatX={dayLabel} formatY={formatMs} />
            </div>

            <div className="surface-card min-w-0 space-y-3 p-4 md:p-5">
              <header><h3 className="font-display text-sm font-semibold">Telas mais lentas</h3><p className="text-xs text-muted-foreground">Só telas com pelo menos 3 aberturas. Da mais lenta para a mais rápida.</p></header>
              {r.screens.length === 0 ? <p className="rounded-2xl bg-secondary/40 px-3 py-6 text-center text-xs text-muted-foreground">Poucas aberturas por tela ainda.</p> : (
                <ul className="space-y-2.5">
                  {r.screens.slice(0, 10).map((s) => {
                    const t = perfTone(s.p75);
                    return (
                      <li key={s.route}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate font-medium">{screenLabel(s.route)}</span>
                          <span className="shrink-0 tabular-nums font-semibold">{formatMs(s.p75)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${BAR_CLASS[t]}`} style={{ width: `${Math.max(3, Math.min(100, (s.p75 / 6000) * 100))}%` }} /></div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{formatInt(s.n)} aberturas · mediana {formatMs(s.p50)} · piores 5% {formatMs(s.p95)} · rápidas {String(s.fast_pct).replace(".", ",")}%{s.timed_out ? ` · ${s.timed_out} sem terminar` : ""}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="surface-card min-w-0 space-y-2 p-4 md:p-5">
              <h3 className="font-display text-sm font-semibold">Por aparelho</h3>
              <ul className="space-y-1.5 text-sm">
                {r.devices.map((d) => (
                  <li key={`${d.device}-${d.standalone}`} className="flex items-baseline justify-between gap-3">
                    <span>{DEVICE_LABEL[d.device] ?? d.device}{d.standalone ? " · app instalado" : " · navegador"}</span>
                    <span className="tabular-nums"><b>{formatMs(d.p75)}</b> <span className="text-[11px] text-muted-foreground">({formatInt(d.n)})</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="surface-card min-w-0 space-y-2 p-4 md:p-5">
              <h3 className="font-display text-sm font-semibold">Por versão do app</h3>
              <ul className="space-y-1.5 text-sm">
                {r.builds.map((b) => (
                  <li key={b.build} className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs">{b.build} <span className="font-sans text-[11px] text-muted-foreground">· visto em {new Date(b.last_seen).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span></span>
                    <span className="tabular-nums"><b>{formatMs(b.p75)}</b> <span className="text-[11px] text-muted-foreground">({formatInt(b.n)})</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
