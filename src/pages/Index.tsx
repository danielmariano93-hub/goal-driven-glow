import { useFinancial, useIndicadores } from '@/context/FinancialContext';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Plus, Target, CreditCard, BarChart3, Wallet, PiggyBank, Receipt, MessageCircle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { ScoreRing } from '@/components/ScoreRing';
import { AlertCard } from '@/components/AlertCard';

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const mesLabel = () => new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

const formatBRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Index() {
  const { state } = useFinancial();
  const navigate = useNavigate();
  const ind = useIndicadores(mesAtual());

  const trend = ind.saldoMes >= 0;
  const hasData = state.lancamentos.length > 0 || state.metas.length > 0 || state.dividas.length > 0;

  const acoes = [
    { label: 'Lançamento', icon: Plus, path: '/app/lancamentos' },
    { label: 'Metas', icon: Target, path: '/app/metas' },
    { label: 'Antes de gastar', icon: BarChart3, path: '/app/planejamento' },
    { label: 'Dívidas', icon: CreditCard, path: '/app/dividas' },
  ];

  // Projeção patrimonial simples (F3 vai substituir por simulação real mês a mês)
  const patrimonioHistorico = Array.from({ length: 6 }, (_, i) => {
    const m = 5 - i;
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    return {
      mes: d.toLocaleDateString('pt-BR', { month: 'short' }),
      valor: Math.max(0, ind.patrimonioLiquido - ind.saldoMes * m),
    };
  });

  return (
    <div className="space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header com gradiente da marca */}
      <div className="relative overflow-hidden md:rounded-3xl md:border md:border-border">
        <div className="absolute inset-0 bg-gradient-brand-dark" aria-hidden />
        <div className="absolute inset-0 grid-pattern opacity-10" aria-hidden />
        <div className="relative px-5 pt-7 pb-14 md:pt-9 md:pb-12">
          <p className="text-white/70 text-xs font-medium capitalize">{mesLabel()}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-white font-numeric">
              R$ {formatBRL(ind.patrimonioLiquido)}
            </h1>
          </div>
          <p className="text-white/60 text-[11px] mt-1">Patrimônio líquido estimado</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-2.5 py-1 backdrop-blur">
            {trend ? <TrendingUp size={12} className="text-brand-coral" /> : <TrendingDown size={12} className="text-brand-coral" />}
            <span className="text-xs font-medium text-white font-numeric">
              {trend ? '+' : ''}R$ {formatBRL(ind.saldoMes)} este mês
            </span>
          </div>
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="px-4 md:px-0 -mt-10 md:mt-0">
        <div className="surface-card p-4 md:p-5">
          <div className="grid grid-cols-4 gap-3">
            {acoes.map(a => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  onClick={() => navigate(a.path)}
                  className="group flex flex-col items-center gap-1.5"
                >
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-brand-soft border border-border/60 grid place-items-center transition-transform group-hover:-translate-y-0.5 group-active:scale-95">
                    <Icon size={20} className="text-accent" />
                  </div>
                  <span className="text-[10px] md:text-xs font-medium text-foreground text-center leading-tight">
                    {a.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-0 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            icon={Wallet}
            iconColor="text-accent"
            iconBg="bg-accent/10"
            label="Saldo do mês"
            value={`R$ ${formatBRL(ind.saldoMes)}`}
            tone={ind.saldoMes >= 0 ? 'positive' : 'negative'}
          />
          <KpiCard
            icon={Receipt}
            iconColor="text-warning"
            iconBg="bg-warning/10"
            label="Renda comprometida"
            value={`${ind.rendaComprometida}%`}
          />
          <KpiCard
            icon={PiggyBank}
            iconColor="text-success"
            iconBg="bg-success/10"
            label="Investido"
            value={`R$ ${formatBRL(ind.totalInvestido)}`}
          />
          <KpiCard
            icon={CreditCard}
            iconColor="text-destructive"
            iconBg="bg-destructive/10"
            label="Dívidas"
            value={`R$ ${formatBRL(ind.totalDividas)}`}
          />
        </div>

        {/* Scores (F3 vai substituir por indicadores factuais) */}
        <div className="surface-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Indicadores</h3>
            <span className="text-[10px] text-muted-foreground">estimativas</span>
          </div>
          <div className="flex justify-around">
            <ScoreRing value={ind.scoreFinanceiro} label="Financeiro" />
            <ScoreRing value={ind.scoreEmocional} label="Emocional" />
          </div>
        </div>

        {/* Evolução */}
        {hasData && (
          <div className="surface-card p-4">
            <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
              Evolução do patrimônio
            </h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={patrimonioHistorico}>
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '12px',
                    fontSize: '11px',
                    boxShadow: 'var(--shadow-lg)',
                  }}
                  formatter={(v: number) => [`R$ ${formatBRL(v)}`, '']}
                />
                <Line
                  type="monotone"
                  dataKey="valor"
                  stroke="hsl(var(--accent))"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: 'hsl(var(--accent))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Alertas */}
        {state.alertas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Alertas</h3>
            {state.alertas.map(a => <AlertCard key={a.id} alerta={a} />)}
          </div>
        )}

        {/* Metas resumo */}
        {state.metas.filter(m => m.status === 'ativa').length > 0 && (
          <div className="surface-card p-4">
            <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
              Metas em andamento
            </h3>
            <div className="space-y-3.5">
              {state.metas.filter(m => m.status === 'ativa').slice(0, 3).map((meta) => {
                const pct = meta.valor_objetivo > 0 ? Math.round((meta.valor_atual / meta.valor_objetivo) * 100) : 0;
                return (
                  <div key={meta.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{meta.nome}</span>
                      <span className="text-[11px] text-muted-foreground font-numeric">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-brand transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasData && (
          <div className="surface-card-lg p-6 md:p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-brand text-white shadow-brand grid place-items-center mx-auto mb-4">
              <MessageCircle size={22} />
            </div>
            <h3 className="font-display text-lg font-semibold text-foreground mb-1.5">
              Comece com uma conversa
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
              Adicione seu primeiro lançamento, sua primeira meta ou uma dívida para ver os indicadores
              se atualizarem em tempo real.
            </p>
            <button
              onClick={() => navigate('/app/lancamentos')}
              className="btn-brand mt-5"
            >
              Adicionar primeiro lançamento
              <Plus size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  tone,
}: {
  icon: typeof Wallet;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  const valueClass =
    tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="surface-card p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center`}>
          <Icon size={14} className={iconColor} />
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-sm font-bold font-numeric ${valueClass}`}>{value}</p>
    </div>
  );
}
