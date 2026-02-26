import { useState } from 'react';
import { useFinancial } from '@/context/FinancialContext';
import { Plus } from 'lucide-react';
import { EmocaoForm } from '@/components/EmocaoForm';
import { EMOCOES } from '@/types/financial';
import { calcularScoreEmocional, calcularIndiceImpulsividade } from '@/lib/engine';

export default function Emocoes() {
  const { state } = useFinancial();
  const [formOpen, setFormOpen] = useState(false);

  const scoreEmocional = calcularScoreEmocional(state);
  const indiceImpulsividade = calcularIndiceImpulsividade(state);

  const getEmocaoLabel = (val: string) => EMOCOES.find(e => e.value === val)?.label || val;

  // Correlação emoção vs categoria
  const despesas = state.lancamentos.filter(l => l.tipo === 'despesa' && l.emocao);
  const correlacao: Record<string, Record<string, number>> = {};
  despesas.forEach(l => {
    if (!correlacao[l.emocao!]) correlacao[l.emocao!] = {};
    correlacao[l.emocao!][l.categoria] = (correlacao[l.emocao!][l.categoria] || 0) + l.valor;
  });

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Emocional</h1>
        <button onClick={() => setFormOpen(true)} className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Plus size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Score emocional</p>
          <p className="text-lg font-bold text-foreground mt-0.5">{scoreEmocional}/100</p>
        </div>
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Impulsividade</p>
          <p className="text-lg font-bold text-foreground mt-0.5">{indiceImpulsividade}%</p>
        </div>
      </div>

      {/* Correlação */}
      {Object.keys(correlacao).length > 0 && (
        <div className="ios-card p-4">
          <h3 className="text-xs text-muted-foreground font-medium mb-3">Emoção × Categoria</h3>
          <div className="space-y-3">
            {Object.entries(correlacao).map(([emocao, cats]) => (
              <div key={emocao}>
                <p className="text-xs font-medium text-foreground mb-1">{getEmocaoLabel(emocao)}</p>
                <div className="space-y-1">
                  {Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                    <div key={cat} className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">{cat}</span>
                      <span className="text-foreground font-medium">R$ {val.toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="ios-card p-4">
        <h3 className="text-xs text-muted-foreground font-medium mb-3">Histórico</h3>
        <div className="space-y-3">
          {state.emocoes.length === 0 && <p className="text-xs text-muted-foreground">Nenhum registro ainda</p>}
          {state.emocoes.map(e => (
            <div key={e.id} className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-foreground">{e.nivel}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{getEmocaoLabel(e.emocao_principal)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(e.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
                {e.observacao && <p className="text-[10px] text-muted-foreground mt-0.5">{e.observacao}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <EmocaoForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
