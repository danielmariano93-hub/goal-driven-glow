import { useState } from 'react';
import { motion } from 'framer-motion';
import { MetricCard } from '@/components/MetricCard';
import { CircularScore } from '@/components/CircularScore';
import { GoalCard } from '@/components/GoalCard';
import { DebtCard } from '@/components/DebtCard';
import { InsightCard } from '@/components/InsightCard';
import { SpendingBarChart, SpendingPieChart } from '@/components/SpendingCharts';
import { QuickExpenseButton, QuickExpenseModal } from '@/components/QuickExpenseModal';
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
import { toast } from 'sonner';

const Index = () => {
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  const patrimonio = calcularPatrimonioLiquido();
  const comprometido = calcularPercentualComprometido();
  const impulsivo = calcularGastoImpulsivo();
  const disciplina = calcularIndiceDisciplina();
  const risco = calcularIndiceRisco();
  const renda = calcularRendaTotal();
  const gastoTotal = calcularGastoTotal();
  const saldoMes = renda - gastoTotal;
  const insights = gerarInsights();

  const handleExpenseSubmit = (data: any) => {
    toast.success('Gasto registrado!', {
      description: `R$ ${data.valor} em ${data.categoria}`,
    });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="container max-w-2xl mx-auto px-4 py-4">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Consciência Financeira</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Fevereiro 2026</p>
          </motion.div>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Key Metrics */}
        <section className="grid grid-cols-2 gap-3">
          <MetricCard
            title="Patrimônio Líquido"
            value={`R$ ${patrimonio.toLocaleString('pt-BR')}`}
            trend="up"
            trendValue="+2.3% mês"
            icon="💰"
          />
          <MetricCard
            title="Saldo do Mês"
            value={`R$ ${saldoMes.toLocaleString('pt-BR')}`}
            subtitle={`de R$ ${renda.toLocaleString('pt-BR')}`}
            variant={saldoMes > 0 ? 'success' : 'risk'}
            icon="📊"
          />
          <MetricCard
            title="Renda Comprometida"
            value={`${comprometido}%`}
            variant={comprometido > 70 ? 'risk' : comprometido > 50 ? 'warning' : 'success'}
            icon="📉"
          />
          <MetricCard
            title="Gasto Impulsivo"
            value={`${impulsivo}%`}
            variant={impulsivo > 30 ? 'risk' : impulsivo > 15 ? 'warning' : 'success'}
            icon="⚡"
          />
        </section>

        {/* Scores */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="apple-card"
        >
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            Índices
          </h3>
          <div className="flex justify-around">
            <CircularScore value={disciplina} label="Disciplina" variant="primary" />
            <CircularScore value={100 - risco} label="Saúde Financeira" variant="primary" />
            <CircularScore value={72} label="Estabilidade Emocional" variant="primary" />
          </div>
        </motion.section>

        {/* Insights */}
        <InsightCard insights={insights} />

        {/* Charts */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SpendingBarChart />
          <SpendingPieChart />
        </section>

        {/* Goals */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Metas
          </h2>
          <div className="space-y-3">
            {mockMetas.map((meta) => (
              <GoalCard key={meta.id} meta={meta} />
            ))}
          </div>
        </section>

        {/* Debts */}
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Dívidas Ativas
          </h2>
          <div className="space-y-3">
            {mockDividas.map((divida) => (
              <DebtCard key={divida.id} divida={divida} />
            ))}
          </div>
        </section>
      </main>

      {/* Quick Expense FAB */}
      <QuickExpenseButton onClick={() => setShowExpenseModal(true)} />
      {showExpenseModal && (
        <QuickExpenseModal
          onClose={() => setShowExpenseModal(false)}
          onSubmit={handleExpenseSubmit}
        />
      )}
    </div>
  );
};

export default Index;
