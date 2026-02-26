import { useState } from 'react';
import { useFinancial } from '@/context/FinancialContext';
import { Plus, ChevronRight, X, Trash2 } from 'lucide-react';
import { MetaForm } from '@/components/MetaForm';
import { Button } from '@/components/ui/button';
import type { Meta } from '@/types/financial';

export default function Metas() {
  const { state, dispatch } = useFinancial();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Meta | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [aporteValor, setAporteValor] = useState('');

  const selected = state.metas.find(m => m.id === selectedId);
  const aportesMeta = selected ? state.aportes.filter(a => a.meta_id === selected.id) : [];

  const registrarAporte = () => {
    if (!selected || !aporteValor) return;
    dispatch({
      type: 'ADD_APORTE',
      payload: {
        id: crypto.randomUUID(),
        meta_id: selected.id,
        data: new Date().toISOString().slice(0, 10),
        valor: parseFloat(aporteValor),
      },
    });
    setAporteValor('');
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Metas</h1>
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Plus size={16} strokeWidth={2.5} />
        </button>
      </div>

      <div className="space-y-3">
        {state.metas.map(meta => {
          const pct = meta.valor_objetivo > 0 ? Math.round((meta.valor_atual / meta.valor_objetivo) * 100) : 0;
          const restante = meta.valor_objetivo - meta.valor_atual;
          const mesesRestantes = meta.aporte_mensal_planejado > 0 ? Math.ceil(restante / meta.aporte_mensal_planejado) : null;

          return (
            <button key={meta.id} onClick={() => setSelectedId(meta.id)} className="ios-card ios-card-interactive w-full p-4 text-left">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{meta.nome}</span>
                  {meta.status === 'pausada' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-medium">pausada</span>}
                  {meta.status === 'concluida' && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">concluída</span>}
                </div>
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
                <div className="h-full rounded-full bg-foreground/60 transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-muted-foreground">{pct}% concluído</span>
                {mesesRestantes && <span className="text-[10px] text-muted-foreground">~{mesesRestantes} meses</span>}
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
              <div className="flex gap-2">
                <button onClick={() => { setEditing(selected); setFormOpen(true); setSelectedId(null); }} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <span className="text-[10px] font-medium">Edit</span>
                </button>
                <button onClick={() => { dispatch({ type: 'DELETE_META', payload: selected.id }); setSelectedId(null); }} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <Trash2 size={12} className="text-destructive" />
                </button>
                <button onClick={() => setSelectedId(null)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="ios-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Valor atual</p>
                <p className="text-sm font-bold text-foreground mt-0.5">R$ {selected.valor_atual.toLocaleString('pt-BR')}</p>
              </div>
              <div className="ios-card p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Falta</p>
                <p className="text-sm font-bold text-foreground mt-0.5">R$ {(selected.valor_objetivo - selected.valor_atual).toLocaleString('pt-BR')}</p>
              </div>
            </div>

            {/* Projeção */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Projeção com aporte atual</p>
              <div className="space-y-2">
                {[3, 6, 12].map(m => {
                  const projetado = Math.min(selected.valor_objetivo, selected.valor_atual + selected.aporte_mensal_planejado * m);
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

            {/* Registrar aporte */}
            <div className="flex gap-2">
              <input type="number" placeholder="Valor do aporte" value={aporteValor} onChange={e => setAporteValor(e.target.value)}
                className="flex-1 h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
              <Button onClick={registrarAporte} size="sm" className="rounded-xl text-xs">Aportar</Button>
            </div>

            {/* Histórico de aportes */}
            {aportesMeta.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Histórico de aportes</p>
                <div className="space-y-1">
                  {aportesMeta.slice(0, 5).map(a => (
                    <div key={a.id} className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">{new Date(a.data).toLocaleDateString('pt-BR')}</span>
                      <span className="text-foreground font-medium">R$ {a.valor.toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected.motivacao_emocional && (
              <p className="text-[10px] text-muted-foreground italic">"{selected.motivacao_emocional}"</p>
            )}
          </div>
        </div>
      )}

      <MetaForm open={formOpen} onOpenChange={setFormOpen} meta={editing} />
    </div>
  );
}
