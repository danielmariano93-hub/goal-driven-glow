import { useFinancial, useIndicadores } from '@/context/FinancialContext';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Plus, Target, CreditCard, BarChart3, Wallet, PiggyBank, Receipt, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { ScoreRing } from '@/components/ScoreRing';
import { AlertCard } from '@/components/AlertCard';

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const mesLabel = () => {
  return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export default function Index() {
  const { state } = useFinancial();
  const navigate = useNavigate();
  const ind = useIndicadores(mesAtual());

  const trend = ind.saldoMes >= 0;
  const hasData = state.lancamentos.length > 0 || state.metas.length > 0 || state.dividas.length > 0;

  const acoes = [
    { label: 'Lançamento', icon: Plus, color: 'bg-primary', path: '/lancamentos' },
    { label: 'Metas', icon: Target, color: 'bg-success', path: '/metas' },
    { label: 'Dívidas', icon: CreditCard, color: 'bg-destructive', path: '/dividas' },
    { label: 'Relatórios', icon: BarChart3, color: 'bg-warning', path: '/relatorios' },
  ];

  // Projecao patrimonial simples (6 meses para tras baseado no saldo)
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
    <div className="space-y-5 -mx-4 -mt-2">
      {/* Header colorido estilo banco */}
      <div className="bg-primary px-5 pt-6 pb-10 rounded-b-3xl">
        <p className="text-primary-foreground/70 text-xs font-medium capitalize">{mesLabel()}</p>
        <h1 className="text-2xl font-bold text-primary-foreground tracking-tight mt-1">
          R$ {ind.patrimonioLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </h1>
        <p className="text-primary-foreground/60 text-[10px] mt-0.5">Patrimônio líquido</p>
        <div className="flex items-center gap-1 mt-2">
          {trend ? <TrendingUp size={12} className="text-green-300" /> : <TrendingDown size={12} className="text-red-300" />}
          <span className={`text-xs font-medium ${trend ? 'text-green-300' : 'text-red-300'}`}>
            {trend ? '+' : ''}R$ {ind.saldoMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} este mês
          </span>
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="px-4 -mt-6">
        <div className="ios-card p-4">
          <div className="grid grid-cols-4 gap-3">
            {acoes.map(a => {
              const Icon = a.icon;
              return (
                <button key={a.label} onClick={() => navigate(a.path)} className="flex flex-col items-center gap-1.5">
                  <div className={`w-12 h-12 rounded-2xl ${a.color} flex items-center justify-center`}>
                    <Icon size={20} className="text-white" />
                  </div>
                  <span className="text-[10px] font-medium text-foreground">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {/* Cards de resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="ios-card p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wallet size={14} className="text-primary" />
              </div>
              <span className="text-[10px] text-muted-foreground">Saldo do mês</span>
            </div>
            <p className={`text-sm font-bold ${ind.saldoMes >= 0 ? 'text-success' : 'text-destructive'}`}>
              R$ {ind.saldoMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="ios-card p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-warning/10 flex items-center justify-center">
                <Receipt size={14} className="text-warning" />
              </div>
              <span className="text-[10px] text-muted-foreground">Comprometida</span>
            </div>
            <p className="text-sm font-bold text-foreground">{ind.rendaComprometida}%</p>
          </div>
          <div className="ios-card p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                <PiggyBank size={14} className="text-success" />
              </div>
              <span className="text-[10px] text-muted-foreground">Investido</span>
            </div>
            <p className="text-sm font-bold text-foreground">
              R$ {ind.totalInvestido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="ios-card p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center">
                <CreditCard size={14} className="text-destructive" />
              </div>
              <span className="text-[10px] text-muted-foreground">Dívidas</span>
            </div>
            <p className="text-sm font-bold text-foreground">
              R$ {ind.totalDividas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Scores */}
        <div className="ios-card p-4">
          <h3 className="text-xs text-muted-foreground font-medium mb-4">Scores</h3>
          <div className="flex justify-around">
            <ScoreRing value={ind.scoreFinanceiro} label="Financeiro" />
            <ScoreRing value={ind.scoreEmocional} label="Emocional" />
          </div>
        </div>

        {/* Evolução */}
        {hasData && (
          <div className="ios-card p-4">
            <h3 className="text-xs text-muted-foreground font-medium mb-3">Evolução do patrimônio</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={patrimonioHistorico}>
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: 'hsl(220,9%,46%)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '10px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  formatter={(v: number) => [`R$ ${v.toLocaleString('pt-BR')}`, '']}
                />
                <Line type="monotone" dataKey="valor" stroke="hsl(221,83%,53%)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'hsl(221,83%,53%)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Alertas */}
        {state.alertas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground font-medium">Alertas</h3>
            {state.alertas.map(a => <AlertCard key={a.id} alerta={a} />)}
          </div>
        )}

        {/* Metas resumo */}
        {state.metas.filter(m => m.status === 'ativa').length > 0 && (
          <div className="ios-card p-4">
            <h3 className="text-xs text-muted-foreground font-medium mb-3">Metas em andamento</h3>
            <div className="space-y-3">
              {state.metas.filter(m => m.status === 'ativa').slice(0, 3).map((meta) => {
                const pct = meta.valor_objetivo > 0 ? Math.round((meta.valor_atual / meta.valor_objetivo) * 100) : 0;
                return (
                  <div key={meta.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{meta.nome}</span>
                      <span className="text-[10px] text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state boas-vindas */}
        {!hasData && (
          <div className="ios-card p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Wallet size={24} className="text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Bem-vindo ao seu ecossistema financeiro!</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Comece adicionando seus lançamentos, metas e dívidas para ver seus indicadores em tempo real.
            </p>
            <button onClick={() => navigate('/lancamentos')} className="mt-4 h-9 px-5 rounded-xl bg-primary text-primary-foreground text-xs font-medium">
              Adicionar primeiro lançamento
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
