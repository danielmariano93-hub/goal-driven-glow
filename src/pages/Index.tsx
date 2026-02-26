import {
  calcularPatrimonioLiquido,
  calcularPercentualComprometido,
  calcularRendaTotal,
  calcularGastoTotal,
  calcularIndiceDisciplina,
  mockMetas,
} from '@/data/mockData';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

const patrimonioHistorico = [
  { mes: 'Set', valor: 2800 },
  { mes: 'Out', valor: 3200 },
  { mes: 'Nov', valor: 4100 },
  { mes: 'Dez', valor: 3800 },
  { mes: 'Jan', valor: 5200 },
  { mes: 'Fev', valor: 6100 },
];

function MicroBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export default function Index() {
  const patrimonio = calcularPatrimonioLiquido();
  const renda = calcularRendaTotal();
  const gastoTotal = calcularGastoTotal();
  const saldoMes = renda - gastoTotal;
  const comprometido = calcularPercentualComprometido();
  const disciplina = calcularIndiceDisciplina();

  const indicators = [
    { label: 'Patrimônio líquido', value: `R$ ${patrimonio.toLocaleString('pt-BR')}`, bar: null },
    { label: 'Saldo do mês', value: `R$ ${saldoMes.toLocaleString('pt-BR')}`, bar: null, positive: saldoMes > 0 },
    { label: 'Renda comprometida', value: `${comprometido}%`, bar: { value: comprometido, max: 100, color: comprometido > 70 ? 'hsl(0,72%,51%)' : comprometido > 50 ? 'hsl(38,92%,50%)' : 'hsl(152,55%,41%)' } },
    { label: 'Score comportamental', value: `${disciplina}/100`, bar: { value: disciplina, max: 100, color: disciplina > 70 ? 'hsl(152,55%,41%)' : disciplina > 40 ? 'hsl(38,92%,50%)' : 'hsl(0,72%,51%)' } },
  ];

  return (
    <div className="space-y-5 pt-2">
      {/* Header */}
      <div>
        <p className="text-xs text-muted-foreground font-medium">Fevereiro 2026</p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight mt-0.5">
          R$ {patrimonio.toLocaleString('pt-BR')}
        </h1>
        <div className="flex items-center gap-1 mt-1">
          <TrendingUp size={12} className="text-success" />
          <span className="text-xs text-success font-medium">+2.3% este mês</span>
        </div>
      </div>

      {/* Indicators */}
      <div className="ios-card p-4 space-y-4">
        {indicators.map((ind) => (
          <div key={ind.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{ind.label}</span>
              <span className={`text-sm font-semibold ${ind.positive === false ? 'text-destructive' : 'text-foreground'}`}>
                {ind.value}
              </span>
            </div>
            {ind.bar && <MicroBar {...ind.bar} />}
          </div>
        ))}
      </div>

      {/* Evolução */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Evolução do patrimônio</h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={patrimonioHistorico}>
            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: 'hsl(0,0%,46%)' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: 'hsl(0,0%,100%)',
                border: 'none',
                borderRadius: '10px',
                fontSize: '11px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
            />
            <Line
              type="monotone"
              dataKey="valor"
              stroke="hsl(220,14%,20%)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'hsl(220,14%,20%)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Metas resumo */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Metas em andamento</h3>
        <div className="space-y-3">
          {mockMetas.map((meta) => {
            const pct = Math.round((meta.valor_atual / meta.valor_objetivo) * 100);
            return (
              <div key={meta.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{meta.nome}</span>
                  <span className="text-[10px] text-muted-foreground">{pct}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-foreground/70 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
