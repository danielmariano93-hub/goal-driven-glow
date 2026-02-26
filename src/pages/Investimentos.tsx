import { useState, useMemo } from 'react';
import { useFinancial } from '@/context/FinancialContext';
import { Plus, Trash2, TrendingUp, TrendingDown, PiggyBank, Edit2 } from 'lucide-react';
import { InvestimentoForm } from '@/components/InvestimentoForm';
import type { Investimento } from '@/types/financial';

export default function Investimentos() {
  const { state, dispatch } = useFinancial();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Investimento | null>(null);

  const totalAplicado = useMemo(() => state.investimentos.reduce((s, i) => s + i.valor_aplicado, 0), [state.investimentos]);
  const totalAtual = useMemo(() => state.investimentos.reduce((s, i) => s + i.valor_atual, 0), [state.investimentos]);
  const rendimentoTotal = totalAtual - totalAplicado;
  const rendimentoPct = totalAplicado > 0 ? ((rendimentoTotal / totalAplicado) * 100) : 0;

  const porTipo = useMemo(() => {
    const map: Record<string, number> = {};
    state.investimentos.forEach(i => { map[i.tipo] = (map[i.tipo] || 0) + i.valor_atual; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [state.investimentos]);

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Investimentos</h1>
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Plus size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="ios-card p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <PiggyBank size={14} className="text-primary" />
            </div>
            <span className="text-[10px] text-muted-foreground">Total aplicado</span>
          </div>
          <p className="text-sm font-bold text-foreground">R$ {totalAplicado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="ios-card p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
              <PiggyBank size={14} className="text-success" />
            </div>
            <span className="text-[10px] text-muted-foreground">Valor atual</span>
          </div>
          <p className="text-sm font-bold text-foreground">R$ {totalAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="ios-card p-3.5 col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${rendimentoTotal >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
              {rendimentoTotal >= 0 ? <TrendingUp size={14} className="text-success" /> : <TrendingDown size={14} className="text-destructive" />}
            </div>
            <span className="text-[10px] text-muted-foreground">Rendimento</span>
          </div>
          <p className={`text-sm font-bold ${rendimentoTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
            {rendimentoTotal >= 0 ? '+' : ''}R$ {rendimentoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            <span className="text-[10px] font-medium ml-1">({rendimentoPct >= 0 ? '+' : ''}{rendimentoPct.toFixed(1)}%)</span>
          </p>
        </div>
      </div>

      {/* Distribuição */}
      {porTipo.length > 0 && (
        <div className="ios-card p-4">
          <h3 className="text-xs text-muted-foreground font-medium mb-3">Distribuição por tipo</h3>
          <div className="space-y-2">
            {porTipo.map(([tipo, valor]) => {
              const pct = totalAtual > 0 ? (valor / totalAtual) * 100 : 0;
              return (
                <div key={tipo} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{tipo}</span>
                    <span className="text-[10px] text-muted-foreground">{pct.toFixed(0)}% · R$ {valor.toLocaleString('pt-BR')}</span>
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

      {/* List */}
      <div className="ios-card divide-y divide-border overflow-hidden">
        {state.investimentos.length === 0 && (
          <div className="text-center py-8">
            <PiggyBank size={32} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Nenhum investimento cadastrado</p>
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="mt-3 h-8 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-medium">
              Adicionar primeiro investimento
            </button>
          </div>
        )}
        {state.investimentos.map(inv => {
          const rend = inv.valor_atual - inv.valor_aplicado;
          const rendPct = inv.valor_aplicado > 0 ? ((rend / inv.valor_aplicado) * 100) : 0;
          return (
            <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => { setEditing(inv); setFormOpen(true); }} className="flex-1 min-w-0 text-left">
                <span className="text-xs font-medium text-foreground">{inv.tipo}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{inv.rendimento_estimado}% a.a.</span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] text-muted-foreground">{inv.liquidez.replace('_', ' ')}</span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className={`text-[10px] font-medium ${rend >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {rend >= 0 ? '+' : ''}{rendPct.toFixed(1)}%
                  </span>
                </div>
              </button>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-foreground tabular-nums">R$ {inv.valor_atual.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-muted-foreground">aplicado: R$ {inv.valor_aplicado.toLocaleString('pt-BR')}</p>
              </div>
              <button onClick={() => dispatch({ type: 'DELETE_INVESTIMENTO', payload: inv.id })} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <Trash2 size={12} className="text-destructive" />
              </button>
            </div>
          );
        })}
      </div>

      <InvestimentoForm open={formOpen} onOpenChange={setFormOpen} investimento={editing} />
    </div>
  );
}
