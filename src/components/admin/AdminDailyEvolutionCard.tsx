import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { EmptyState } from "@/components/admin/EmptyState";

type Point = {
  day: string;
  new_clients: number;
  activated: number;
  active_unique: number;
  went_dormant: number;
  cumulative_clients: number;
  first_financial_action: number;
};

type Props = {
  series: Point[];
  sampleSize: number;
  sufficientSample: boolean;
  formulaVersion?: string;
};

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fmtDayFull(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function AdminDailyEvolutionCard({ series, sampleSize, sufficientSample, formulaVersion }: Props) {
  const hasData = series.length > 0 && series.some((p) => p.new_clients + p.active_unique + p.cumulative_clients > 0);

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold">Evolução diária</h3>
          <p className="text-xs text-muted-foreground">
            Novos, ativados e ativos únicos por dia — timezone America/Sao_Paulo.
          </p>
        </div>
        {!sufficientSample && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 border border-amber-200">
            amostra insuficiente (n={sampleSize})
          </span>
        )}
      </div>

      {!hasData ? (
        <EmptyState title="Sem movimentos no período" description="Ajuste o filtro de data para ver a evolução diária." />
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(v) => fmtDayFull(String(v))}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="new_clients" name="Novos" stroke="hsl(221 83% 53%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="activated" name="Ativados" stroke="hsl(160 84% 39%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="active_unique" name="Ativos únicos" stroke="hsl(43 96% 56%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cumulative_clients" name="Acumulado" stroke="hsl(280 65% 60%)" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Dia</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Novos</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Ativados</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Ativos</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Dormant</th>
                  <th className="py-1.5 pr-3 font-medium text-right">1ª mov. fin.</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {series.map((p) => (
                  <tr key={p.day} className="border-t border-border/60">
                    <td className="py-1.5 pr-3 tabular-nums">{fmtDayFull(p.day)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.new_clients}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.activated}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.active_unique}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.went_dormant}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.first_financial_action}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{p.cumulative_clients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {formulaVersion && (
            <p className="mt-2 text-[10px] text-muted-foreground">Fórmula: {formulaVersion}</p>
          )}
        </>
      )}
    </div>
  );
}
