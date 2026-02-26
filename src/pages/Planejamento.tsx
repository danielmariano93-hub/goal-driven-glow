import { useState, useMemo } from 'react';
import { calcularGastoTotal, calcularRendaTotal, mockContasFixas, mockGastos, mockMetas } from '@/data/mockData';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export default function Planejamento() {
  const renda = calcularRendaTotal();
  const gastoFixoTotal = mockContasFixas.reduce((s, c) => s + c.valor, 0);
  const gastoVariavelTotal = mockGastos.reduce((s, g) => s + g.valor, 0);
  const gastoTotal = gastoFixoTotal + gastoVariavelTotal;
  const saldoAtual = renda - gastoTotal;

  const [reducaoFixo, setReducaoFixo] = useState(0);
  const [reducaoVariavel, setReducaoVariavel] = useState(0);
  const [aumentoAporte, setAumentoAporte] = useState(0);

  const novoGastoFixo = gastoFixoTotal * (1 - reducaoFixo / 100);
  const novoGastoVariavel = gastoVariavelTotal * (1 - reducaoVariavel / 100);
  const novoSaldo = renda - novoGastoFixo - novoGastoVariavel + aumentoAporte;

  const metaPrincipal = mockMetas.find((m) => m.prioridade === 'alta');
  const restanteMeta = metaPrincipal ? metaPrincipal.valor_objetivo - metaPrincipal.valor_atual : 0;
  const mesesAtual = saldoAtual > 0 && restanteMeta > 0 ? Math.ceil(restanteMeta / saldoAtual) : null;
  const mesesSimulado = novoSaldo > 0 && restanteMeta > 0 ? Math.ceil(restanteMeta / novoSaldo) : null;

  const chartData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      mes: `Mês ${i + 1}`,
      atual: Math.round(saldoAtual * (i + 1)),
      simulado: Math.round(novoSaldo * (i + 1)),
    }));
  }, [saldoAtual, novoSaldo]);

  return (
    <div className="space-y-5 pt-2">
      <h1 className="text-xl font-bold text-foreground">Planejamento</h1>

      {/* Resumo atual */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Resumo do mês atual</h3>
        <div className="space-y-2">
          {[
            { label: 'Renda', value: renda },
            { label: 'Gastos fixos', value: gastoFixoTotal },
            { label: 'Gastos variáveis', value: gastoVariavelTotal },
            { label: 'Saldo mensal', value: saldoAtual, highlight: true },
          ].map((item) => (
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

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground">Redução gastos fixos</span>
            <span className="text-xs font-semibold text-foreground">{reducaoFixo}%</span>
          </div>
          <input
            type="range" min={0} max={50} value={reducaoFixo}
            onChange={(e) => setReducaoFixo(+e.target.value)}
            className="w-full h-1 rounded-full appearance-none bg-secondary accent-foreground"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground">Redução gastos variáveis</span>
            <span className="text-xs font-semibold text-foreground">{reducaoVariavel}%</span>
          </div>
          <input
            type="range" min={0} max={50} value={reducaoVariavel}
            onChange={(e) => setReducaoVariavel(+e.target.value)}
            className="w-full h-1 rounded-full appearance-none bg-secondary accent-foreground"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground">Aumento de aporte mensal</span>
            <span className="text-xs font-semibold text-foreground">R$ {aumentoAporte}</span>
          </div>
          <input
            type="range" min={0} max={3000} step={100} value={aumentoAporte}
            onChange={(e) => setAumentoAporte(+e.target.value)}
            className="w-full h-1 rounded-full appearance-none bg-secondary accent-foreground"
          />
        </div>
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
            <p className={`text-sm font-bold ${novoSaldo > saldoAtual ? 'text-success' : 'text-foreground'}`}>
              R$ {Math.round(novoSaldo).toLocaleString('pt-BR')}
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
                <p className={`text-sm font-bold ${mesesSimulado && mesesAtual && mesesSimulado < mesesAtual ? 'text-success' : 'text-foreground'}`}>
                  {mesesSimulado ? `${mesesSimulado} meses` : '—'}
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
              contentStyle={{
                background: 'hsl(0,0%,100%)',
                border: 'none',
                borderRadius: '10px',
                fontSize: '10px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
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
