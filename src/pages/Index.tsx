import { useFinancial, useIndicadores } from '@/context/FinancialContext';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { ScoreRing } from '@/components/ScoreRing';
import { AlertCard } from '@/components/AlertCard';

function MicroBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export default function Index() {
  const { state } = useFinancial();
  const ind = useIndicadores('2026-02');

  const patrimonioHistorico = [
    { mes: 'Set', valor: ind.patrimonioLiquido - 3300 },
    { mes: 'Out', valor: ind.patrimonioLiquido - 2900 },
    { mes: 'Nov', valor: ind.patrimonioLiquido - 1900 },
    { mes: 'Dez', valor: ind.patrimonioLiquido - 2300 },
    { mes: 'Jan', valor: ind.patrimonioLiquido - 900 },
    { mes: 'Fev', valor: ind.patrimonioLiquido },
  ];

  const trend = ind.saldoMes >= 0;

  return (
    <div className="space-y-5 pt-2">
      {/* Header */}
      <div>
        <p className="text-xs text-muted-foreground font-medium">Fevereiro 2026</p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight mt-0.5">
          R$ {ind.patrimonioLiquido.toLocaleString('pt-BR')}
        </h1>
        <div className="flex items-center gap-1 mt-1">
          {trend ? <TrendingUp size={12} className="text-success" /> : <TrendingDown size={12} className="text-destructive" />}
          <span className={`text-xs font-medium ${trend ? 'text-success' : 'text-destructive'}`}>
            {trend ? '+' : ''}R$ {ind.saldoMes.toLocaleString('pt-BR')} este mês
          </span>
        </div>
      </div>

      {/* Indicadores */}
      <div className="ios-card p-4 space-y-4">
        {[
          { label: 'Patrimônio líquido', value: `R$ ${ind.patrimonioLiquido.toLocaleString('pt-BR')}` },
          { label: 'Saldo do mês', value: `R$ ${ind.saldoMes.toLocaleString('pt-BR')}`, positive: ind.saldoMes > 0 },
          { label: 'Total investido', value: `R$ ${ind.totalInvestido.toLocaleString('pt-BR')}` },
          { label: 'Total em dívidas', value: `R$ ${ind.totalDividas.toLocaleString('pt-BR')}` },
          { label: 'Renda comprometida', value: `${ind.rendaComprometida}%`, bar: { value: ind.rendaComprometida, max: 100, color: ind.rendaComprometida > 70 ? 'hsl(0,72%,51%)' : ind.rendaComprometida > 50 ? 'hsl(38,92%,50%)' : 'hsl(152,55%,41%)' } },
        ].map((item) => (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span className={`text-sm font-semibold ${item.positive === false ? 'text-destructive' : 'text-foreground'}`}>{item.value}</span>
            </div>
            {'bar' in item && item.bar && <MicroBar {...item.bar} />}
          </div>
        ))}
      </div>

      {/* Scores */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-4">Scores</h3>
        <div className="flex justify-around">
          <div className="relative">
            <ScoreRing value={ind.scoreFinanceiro} label="Financeiro" />
          </div>
          <div className="relative">
            <ScoreRing value={ind.scoreEmocional} label="Emocional" />
          </div>
        </div>
      </div>

      {/* Evolução */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Evolução do patrimônio</h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={patrimonioHistorico}>
            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: 'hsl(0,0%,46%)' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '10px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
            />
            <Line type="monotone" dataKey="valor" stroke="hsl(220,14%,20%)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'hsl(220,14%,20%)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Alertas */}
      {state.alertas.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground font-medium">Alertas</h3>
          {state.alertas.map(a => <AlertCard key={a.id} alerta={a} />)}
        </div>
      )}

      {/* Metas resumo */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Metas em andamento</h3>
        <div className="space-y-3">
          {state.metas.filter(m => m.status === 'ativa').slice(0, 3).map((meta) => {
            const pct = Math.round((meta.valor_atual / meta.valor_objetivo) * 100);
            return (
              <div key={meta.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{meta.nome}</span>
                  <span className="text-[10px] text-muted-foreground">{pct}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full bg-foreground/70 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
