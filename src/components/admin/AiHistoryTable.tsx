// Histórico dia a dia de consumo de tokens e latência.
// Só formata e soma a série que a RPC já entregou: nenhum dia é preenchido
// artificialmente e métrica ausente aparece como "—", nunca como zero.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export type AiHistoryRow = {
  day: string;
  runs: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  tokens_per_run: number;
  ai_p50_latency_ms: number | null;
  ai_p95_latency_ms: number | null;
  e2e_p50_latency_ms: number | null;
  e2e_p95_latency_ms: number | null;
};

const num = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const ms = (v: number | null | undefined) => (v == null ? "—" : `${(v / 1000).toFixed(1)}s`);
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Média das medianas disponíveis — usada só na visão semanal, sempre rotulada. */
function avgOf(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (!present.length) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

function isoWeekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function groupByWeek(rows: AiHistoryRow[]): AiHistoryRow[] {
  const map = new Map<string, AiHistoryRow[]>();
  for (const row of rows) {
    const key = isoWeekStart(row.day);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()].map(([day, group]) => {
    const runs = group.reduce((a, r) => a + Number(r.runs ?? 0), 0);
    const tokens_in = group.reduce((a, r) => a + Number(r.tokens_in ?? 0), 0);
    const tokens_out = group.reduce((a, r) => a + Number(r.tokens_out ?? 0), 0);
    const tokens_total = group.reduce((a, r) => a + Number(r.tokens_total ?? 0), 0);
    return {
      day,
      runs,
      tokens_in,
      tokens_out,
      tokens_total,
      tokens_per_run: runs > 0 ? tokens_total / runs : 0,
      ai_p50_latency_ms: avgOf(group.map((r) => r.ai_p50_latency_ms)),
      ai_p95_latency_ms: avgOf(group.map((r) => r.ai_p95_latency_ms)),
      e2e_p50_latency_ms: avgOf(group.map((r) => r.e2e_p50_latency_ms)),
      e2e_p95_latency_ms: avgOf(group.map((r) => r.e2e_p95_latency_ms)),
    };
  });
}

export function AiHistoryTable({ series }: { series: AiHistoryRow[] }) {
  const [grain, setGrain] = useState<"day" | "week">("day");

  const rows = useMemo(() => {
    const base = grain === "week" ? groupByWeek(series) : series;
    return [...base].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [series, grain]);

  const totals = useMemo(() => {
    const runs = series.reduce((a, r) => a + Number(r.runs ?? 0), 0);
    const tokens_total = series.reduce((a, r) => a + Number(r.tokens_total ?? 0), 0);
    return {
      runs,
      tokens_in: series.reduce((a, r) => a + Number(r.tokens_in ?? 0), 0),
      tokens_out: series.reduce((a, r) => a + Number(r.tokens_out ?? 0), 0),
      tokens_total,
      tokens_per_run: runs > 0 ? tokens_total / runs : 0,
    };
  }, [series]);

  const label = (iso: string) => (grain === "week" ? `semana de ${dayLabel(iso)}` : dayLabel(iso));

  return (
    <section className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Histórico de tokens e latência</h3>
          <p className="text-xs text-muted-foreground">
            O mesmo recorte dos gráficos, número por número.
            {grain === "week" ? " Latência semanal é a média das medianas dos dias com medição." : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={grain === "day" ? "default" : "outline"} onClick={() => setGrain("day")}>
            Por dia
          </Button>
          <Button size="sm" variant={grain === "week" ? "default" : "outline"} onClick={() => setGrain("week")}>
            Por semana
          </Button>
        </div>
      </header>

      {!rows.length ? (
        <p className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
          Nenhum dia com telemetria neste recorte.
        </p>
      ) : (
        <>
          {/* Desktop: tabela com cabeçalho fixo */}
          <div className="hidden max-h-[420px] overflow-auto rounded-2xl border border-border/70 md:block">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{grain === "week" ? "Semana" : "Dia"}</th>
                  <th className="px-3 py-2 text-right font-medium">Conversas</th>
                  <th className="px-3 py-2 text-right font-medium">Entrada</th>
                  <th className="px-3 py-2 text-right font-medium">Saída</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens/conversa</th>
                  <th className="px-3 py-2 text-right font-medium">IA P50</th>
                  <th className="px-3 py-2 text-right font-medium">IA P95</th>
                  <th className="px-3 py-2 text-right font-medium">Ponta a ponta P50</th>
                  <th className="px-3 py-2 text-right font-medium">Ponta a ponta P95</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{label(r.day)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.runs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(r.tokens_in)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{num(r.tokens_out)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(r.tokens_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(r.tokens_per_run)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ms(r.ai_p50_latency_ms)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ms(r.ai_p95_latency_ms)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{ms(r.e2e_p50_latency_ms)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{ms(r.e2e_p95_latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: um cartão por período */}
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.day} className="rounded-2xl border border-border/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{label(r.day)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{num(r.runs)} conversas</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Tokens</dt>
                  <dd className="text-right font-semibold tabular-nums">{num(r.tokens_total)}</dd>
                  <dt className="text-muted-foreground">Entrada / saída</dt>
                  <dd className="text-right tabular-nums">{num(r.tokens_in)} / {num(r.tokens_out)}</dd>
                  <dt className="text-muted-foreground">Tokens por conversa</dt>
                  <dd className="text-right tabular-nums">{num(r.tokens_per_run)}</dd>
                  <dt className="text-muted-foreground">Latência de IA (P50/P95)</dt>
                  <dd className="text-right tabular-nums">{ms(r.ai_p50_latency_ms)} / {ms(r.ai_p95_latency_ms)}</dd>
                  <dt className="text-muted-foreground">Ponta a ponta (P50/P95)</dt>
                  <dd className="text-right tabular-nums">{ms(r.e2e_p50_latency_ms)} / {ms(r.e2e_p95_latency_ms)}</dd>
                </dl>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted-foreground">
            Total do recorte: {num(totals.runs)} conversas · {num(totals.tokens_total)} tokens (entrada{" "}
            {num(totals.tokens_in)} · saída {num(totals.tokens_out)}) · {num(totals.tokens_per_run)} tokens por conversa.
          </p>
        </>
      )}
    </section>
  );
}
