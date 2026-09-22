import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import type { BehavioralEvolutionSnapshot } from "@/lib/behavioral/client";

function shortDate(day: string) {
  const [, month, date] = String(day).split("-");
  return month && date ? `${date}/${month}` : day;
}

export function MoneyMoodTimeline({ snapshot }: { snapshot: BehavioralEvolutionSnapshot }) {
  const data = snapshot.moodHistory.slice(-30).map((row) => ({
    ...row,
    label: shortDate(row.day),
    direct: row.control != null || row.urge != null,
  }));
  const controlValues = data.map((row) => row.control).filter((value): value is number => value != null);
  const urgeValues = data.map((row) => row.urge).filter((value): value is number => value != null);
  const controlAvg = controlValues.length ? controlValues.reduce((sum, value) => sum + value, 0) / controlValues.length : null;
  const urgeAvg = urgeValues.length ? urgeValues.reduce((sum, value) => sum + value, 0) / urgeValues.length : null;
  const trend = snapshot.moodTrend14;
  const directCount = data.filter((row) => row.direct).length;
  const estimatedCount = data.length - directCount;

  return (
    <section className="rounded-[26px] border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Money mood</p>
          <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Como sua relação com dinheiro está evoluindo</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Seus check-ins mais recentes medem tranquilidade diretamente. Registros do formato anterior seguem no histórico como referência estimada para preservar continuidade.
          </p>
        </div>
        <div className="rounded-2xl bg-secondary/70 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">30 dias</p>
          <p className="font-display text-2xl font-bold">{snapshot.moodAverage30 == null ? "—" : snapshot.moodAverage30.toFixed(1)}</p>
        </div>
      </div>

      {estimatedCount > 0 ? (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Nesta janela, há {directCount} medição{directCount === 1 ? "" : "ões"} direta{directCount === 1 ? "" : "s"} e {estimatedCount} ponto{estimatedCount === 1 ? "" : "s"} histórico{estimatedCount === 1 ? "" : "s"} estimado{estimatedCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      {data.length >= 2 ? (
        <div className="mt-4 h-[260px] sm:h-[290px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="moneyMoodFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                  <stop offset="58%" stopColor="hsl(var(--primary))" stopOpacity={0.07} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <ReferenceArea y1={0} y2={3} fill="hsl(var(--destructive))" fillOpacity={0.025} />
              <ReferenceArea y1={3} y2={6} fill="hsl(var(--destructive))" fillOpacity={0.012} />
              <ReferenceArea y1={6} y2={8} fill="hsl(var(--primary))" fillOpacity={0.015} />
              <ReferenceArea y1={8} y2={10} fill="hsl(var(--success))" fillOpacity={0.025} />
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="2 8" strokeOpacity={0.58} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={30} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} axisLine={false} tickLine={false} width={30} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.14, strokeDasharray: "3 6" }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!active || !row) return null;
                  return (
                    <div className="min-w-[160px] rounded-2xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
                      <p className="text-xs font-semibold">{row.label}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{row.direct ? "Medição direta" : "Estimativa do check-in antigo"}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Tranquilidade <strong className="text-foreground">{row.score.toFixed(1)}</strong></p>
                      {row.control != null ? <p className="text-xs text-muted-foreground">Controle <strong className="text-foreground">{row.control}</strong></p> : null}
                      {row.urge != null ? <p className="text-xs text-muted-foreground">Vontade de gastar <strong className="text-foreground">{row.urge}</strong></p> : null}
                    </div>
                  );
                }}
              />
              <Area
                type="natural"
                dataKey="score"
                stroke="hsl(var(--primary))"
                strokeWidth={3.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#moneyMoodFill)"
                dot={{ r: 2.15, fill: "hsl(var(--card))", stroke: "hsl(var(--primary))", strokeWidth: 1.8 }}
                activeDot={{ r: 4.75, fill: "hsl(var(--primary))", stroke: "hsl(var(--card))", strokeWidth: 2.25 }}
                animationDuration={650}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 rounded-[22px] border border-dashed border-border bg-secondary/30 px-4 py-8 text-center">
          <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">Mais alguns check-ins e sua evolução aparece aqui</p>
          <p className="mt-1 text-xs text-muted-foreground">O Nino não inventa pontos para preencher dias sem resposta.</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-secondary/20">
        <div className="p-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Tranquilidade</p>
          <p className="mt-1 text-lg font-bold">{snapshot.moodAverage30 == null ? "—" : snapshot.moodAverage30.toFixed(1)}</p>
        </div>
        <div className="p-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Controle</p>
          <p className="mt-1 text-lg font-bold">{controlAvg == null ? "—" : controlAvg.toFixed(1)}</p>
        </div>
        <div className="p-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Vontade</p>
          <p className="mt-1 text-lg font-bold">{urgeAvg == null ? "—" : urgeAvg.toFixed(1)}</p>
        </div>
      </div>

      {trend != null && Math.abs(trend) >= 0.3 ? (
        <div className={`mt-3 flex items-start gap-2 rounded-2xl p-3 ${trend > 0 ? "bg-success/10" : "bg-brand-coral/10"}`}>
          {trend > 0 ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-brand-coral" />}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sua média dos últimos 14 dias está <strong className="text-foreground">{Math.abs(trend).toFixed(1)} ponto{Math.abs(trend) >= 2 ? "s" : ""} {trend > 0 ? "acima" : "abaixo"}</strong> das duas semanas anteriores. {directCount < 3 ? "Como a maior parte da janela ainda vem do formato antigo, leia esta tendência como indicativa." : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
