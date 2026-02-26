import { useState } from 'react';
import { mockMetas } from '@/data/mockData';
import { ChevronRight, Plus, X } from 'lucide-react';

export default function Metas() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = mockMetas.find((m) => m.id === selectedId);

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Metas</h1>
        <button className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Plus size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {mockMetas.map((meta) => {
          const pct = Math.round((meta.valor_atual / meta.valor_objetivo) * 100);
          const restante = meta.valor_objetivo - meta.valor_atual;
          const mesesRestantes = meta.aporte_mensal_planejado > 0
            ? Math.ceil(restante / meta.aporte_mensal_planejado)
            : null;

          return (
            <button
              key={meta.id}
              onClick={() => setSelectedId(meta.id)}
              className="ios-card ios-card-interactive w-full p-4 text-left"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-foreground">{meta.nome}</span>
                <ChevronRight size={14} className="text-muted-foreground" />
              </div>
              <div className="flex items-end justify-between mb-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Atual</p>
                  <p className="text-xs font-semibold text-foreground">R$ {meta.valor_atual.toLocaleString('pt-BR')}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Objetivo</p>
                  <p className="text-xs font-semibold text-foreground">R$ {meta.valor_objetivo.toLocaleString('pt-BR')}</p>
                </div>
              </div>
              <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground/60 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-muted-foreground">{pct}% concluído</span>
                {mesesRestantes && (
                  <span className="text-[10px] text-muted-foreground">~{mesesRestantes} meses restantes</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail Sheet */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end justify-center">
          <div className="w-full max-w-lg bg-card rounded-t-3xl p-5 pb-10 space-y-4 animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{selected.nome}</h2>
              <button onClick={() => setSelectedId(null)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="ios-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Valor atual</p>
                <p className="text-sm font-bold text-foreground mt-0.5">R$ {selected.valor_atual.toLocaleString('pt-BR')}</p>
              </div>
              <div className="ios-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Falta</p>
                <p className="text-sm font-bold text-foreground mt-0.5">
                  R$ {(selected.valor_objetivo - selected.valor_atual).toLocaleString('pt-BR')}
                </p>
              </div>
              <div className="ios-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Aporte mensal</p>
                <p className="text-sm font-bold text-foreground mt-0.5">
                  R$ {selected.aporte_mensal_planejado.toLocaleString('pt-BR')}
                </p>
              </div>
              <div className="ios-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Prazo</p>
                <p className="text-sm font-bold text-foreground mt-0.5">
                  {new Date(selected.prazo).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">Projeção com aporte atual</p>
              <div className="space-y-2">
                {[3, 6, 12].map((m) => {
                  const projetado = Math.min(
                    selected.valor_objetivo,
                    selected.valor_atual + selected.aporte_mensal_planejado * m
                  );
                  const pct = Math.round((projetado / selected.valor_objetivo) * 100);
                  return (
                    <div key={m} className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">{m} meses</span>
                        <span className="text-foreground font-medium">R$ {projetado.toLocaleString('pt-BR')} ({pct}%)</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-foreground/50" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground italic">"{selected.motivacao_emocional}"</p>
          </div>
        </div>
      )}
    </div>
  );
}
