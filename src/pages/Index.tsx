import { MetricCard } from '@/components/MetricCard';
import { CircularScore } from '@/components/CircularScore';
import { InsightCard } from '@/components/InsightCard';
import {
  calcularPatrimonioLiquido,
  calcularPercentualComprometido,
  calcularGastoImpulsivo,
  calcularIndiceDisciplina,
  calcularIndiceRisco,
  calcularRendaTotal,
  calcularGastoTotal,
  gerarInsights,
  mockMetas,
  mockDividas,
} from '@/data/mockData';

const Index = () => {
  const patrimonio = calcularPatrimonioLiquido();
  const comprometido = calcularPercentualComprometido();
  const impulsivo = calcularGastoImpulsivo();
  const disciplina = calcularIndiceDisciplina();
  const risco = calcularIndiceRisco();
  const renda = calcularRendaTotal();
  const gastoTotal = calcularGastoTotal();
  const saldoMes = renda - gastoTotal;
  const insights = gerarInsights();

  const totalDividas = mockDividas.reduce((s, d) => s + d.valor_atual, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Patrimônio Líquido" value={`R$ ${patrimonio.toLocaleString('pt-BR')}`} trend="up" trendValue="+2.3% mês" icon="💰" />
        <MetricCard title="Saldo do Mês" value={`R$ ${saldoMes.toLocaleString('pt-BR')}`} subtitle={`de R$ ${renda.toLocaleString('pt-BR')}`} variant={saldoMes > 0 ? 'success' : 'risk'} icon="📊" />
        <MetricCard title="Renda Comprometida" value={`${comprometido}%`} variant={comprometido > 70 ? 'risk' : comprometido > 50 ? 'warning' : 'success'} icon="📉" />
        <MetricCard title="Gasto Impulsivo" value={`${impulsivo}%`} variant={impulsivo > 30 ? 'risk' : impulsivo > 15 ? 'warning' : 'success'} icon="⚡" />
      </div>

      {/* Scores */}
      <div className="apple-card">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">Índices</h3>
        <div className="flex justify-around">
          <CircularScore value={disciplina} label="Disciplina" variant="primary" />
          <CircularScore value={100 - risco} label="Saúde Financeira" variant="primary" />
          <CircularScore value={72} label="Estabilidade Emocional" variant="primary" />
        </div>
      </div>

      {/* Insights */}
      <InsightCard insights={insights} />

      {/* Quick Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="apple-card">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Metas em Andamento</h3>
          <div className="space-y-3">
            {mockMetas.map((meta) => {
              const prog = Math.round((meta.valor_atual / meta.valor_objetivo) * 100);
              return (
                <div key={meta.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground font-medium">{meta.nome}</span>
                    <span className="text-muted-foreground">{prog}%</span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-success rounded-full" style={{ width: `${prog}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="apple-card">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Dívidas Ativas</h3>
          <p className="text-2xl font-bold text-foreground">R$ {totalDividas.toLocaleString('pt-BR')}</p>
          <div className="mt-3 space-y-2">
            {mockDividas.map((d) => (
              <div key={d.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{d.tipo}</span>
                <span className="text-foreground font-medium">R$ {d.valor_atual.toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
