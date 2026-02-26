import { useState, useMemo } from 'react';
import { useFinancial, useIndicadores } from '@/context/FinancialContext';
import { simular } from '@/lib/engine';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export default function Planejamento() {
  const { state } = useFinancial();
  const ind = useIndicadores('2026-02');

  const [reducaoFixo, setReducaoFixo] = useState(0);
  const [reducaoVariavel, setReducaoVariavel] = useState(0);
  const [aumentoRenda, setAumentoRenda] = useState(0);
  const [aumentoAporte, setAumentoAporte] = useState(0);

  const resultado = useMemo(() => simular(state, { reducaoFixo, reducaoVariavel, aumentoRenda, aumentoAporte }), [state, reducaoFixo, reducaoVariavel, aumentoRenda, aumentoAporte]);

  const saldoAtual = ind.saldoMes;
  const metaPrincipal = state.metas.find(m => m.prioridade === 'alta' && m.status === 'ativa');
  const restanteMeta = metaPrincipal ? metaPrincipal.valor_objetivo - metaPrincipal.valor_atual : 0;
  const mesesAtual = saldoAtual > 0 && restanteMeta > 0 ? Math.ceil(restanteMeta / saldoAtual) : null;

  const chartData = useMemo(() => {
    const projecaoAtual = Array.from({ length: 12 }, (_, i) => Math.round(ind.patrimonioLiquido + saldoAtual * (i + 1)));
    return resultado.projecao12.map((v, i) => ({
      mes: `Mês ${i + 1}`,
      atual: projecaoAtual[i],
      simulado: v,
    }));
  }, [ind.patrimonioLiquido, saldoAtual, resultado.projecao12]);

  return (
    <div className="space-y-5 pt-2">
      <h1 className="text-xl font-bold text-foreground">Planejamento</h1>

      {/* Resumo atual */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Resumo do mês atual</h3>
        <div className="space-y-2">
          {[
            { label: 'Renda', value: ind.rendaTotal },
            { label: 'Gastos fixos', value: ind.gastosFixos },
            { label: 'Gastos variáveis', value: ind.gastosVariaveis },
            { label: 'Saldo mensal', value: saldoAtual, highlight: true },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span className={`text-sm font-semibold ${item.highlight ? (saldoAtual > 0 ? 'text-success' : 'text-destructive') : 'text-foreground'}`}>
                R$ {item.value.toLocaleString('pt-BR')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Campos editáveis */}
      <div className="ios-card p-4 space-y-4">
        <h3 className="text-xs text-muted-foreground font-medium">Cenário simulado</h3>
        {[
          { label: 'Redução gastos fixos', value: reducaoFixo, set: setReducaoFixo, max: 50, suffix: '%' },
          { label: 'Redução gastos variáveis', value: reducaoVariavel, set: setReducaoVariavel, max: 50, suffix: '%' },
          { label: 'Aumento de renda', value: aumentoRenda, set: setAumentoRenda, max: 5000, suffix: '', step: 100 },
          { label: 'Aumento de aporte', value: aumentoAporte, set: setAumentoAporte, max: 3000, suffix: '', step: 100 },
        ].map(item => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground">{item.label}</span>
              <span className="text-xs font-semibold text-foreground">
                {item.suffix === '%' ? `${item.value}%` : `R$ ${item.value}`}
              </span>
            </div>
            <input
              type="range" min={0} max={item.max} step={item.step || 1} value={item.value}
              onChange={e => item.set(+e.target.value)}
              className="w-full h-1 rounded-full appearance-none bg-secondary accent-foreground"
            />
          </div>
        ))}
      </div>

      {/* Comparação */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Comparação</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Saldo atual</p>
            <p className="text-sm font-bold text-foreground">R$ {saldoAtual.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Saldo simulado</p>
            <p className={`text-sm font-bold ${resultado.saldoSimulado > saldoAtual ? 'text-success' : 'text-foreground'}`}>
              R$ {resultado.saldoSimulado.toLocaleString('pt-BR')}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Renda comprometida atual</p>
            <p className="text-sm font-bold text-foreground">{ind.rendaComprometida}%</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Renda comprometida simulada</p>
            <p className={`text-sm font-bold ${resultado.rendaComprometida < ind.rendaComprometida ? 'text-success' : 'text-foreground'}`}>
              {resultado.rendaComprometida}%
            </p>
          </div>
          {metaPrincipal && (
            <>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Meta "{metaPrincipal.nome}"</p>
                <p className="text-sm font-bold text-foreground">{mesesAtual ? `${mesesAtual} meses` : '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Com simulação</p>
                <p className={`text-sm font-bold ${resultado.tempoMeta && mesesAtual && resultado.tempoMeta < mesesAtual ? 'text-success' : 'text-foreground'}`}>
                  {resultado.tempoMeta ? `${resultado.tempoMeta} meses` : '—'}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Projeção 12 meses</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData}>
            <XAxis dataKey="mes" tick={{ fontSize: 9, fill: 'hsl(0,0%,46%)' }} axisLine={false} tickLine={false} interval={1} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '10px', fontSize: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
            />
            <Line type="monotone" dataKey="atual" stroke="hsl(0,0%,80%)" strokeWidth={1.5} dot={false} name="Atual" />
            <Line type="monotone" dataKey="simulado" stroke="hsl(220,14%,20%)" strokeWidth={2} dot={false} name="Simulado" />
            <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
