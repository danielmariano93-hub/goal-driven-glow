import { useState } from 'react';
import { useFinancial } from '@/context/FinancialContext';
import { Plus, Trash2 } from 'lucide-react';
import { DividaForm } from '@/components/DividaForm';
import { calcularCustoDivida, calcularJurosProjetado, compararAvalancheVsBolaNeve } from '@/lib/engine';
import type { Divida } from '@/types/financial';

export default function Dividas() {
  const { state, dispatch } = useFinancial();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Divida | null>(null);

  const totalDividas = state.dividas.reduce((s, d) => s + d.valor_atual, 0);
  const totalJuros = state.dividas.reduce((s, d) => s + calcularJurosProjetado(d), 0);
  const totalParcela = state.dividas.reduce((s, d) => s + d.valor_parcela, 0);

  const { avalanche, bolaNeve } = compararAvalancheVsBolaNeve(state.dividas);
  const estrategia = state.dividas.length > 0 && avalanche[0]?.id !== bolaNeve[0]?.id
    ? `Avalanche recomenda priorizar "${avalanche[0]?.nome}" (maior juros). Bola de Neve recomenda "${bolaNeve[0]?.nome}" (menor saldo).`
    : state.dividas.length > 0 ? `Priorize "${avalanche[0]?.nome}" — tem os maiores juros e menor saldo.` : '';

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Dívidas</h1>
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Plus size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Saldo total</p>
          <p className="text-sm font-bold text-foreground mt-0.5">R$ {totalDividas.toLocaleString('pt-BR')}</p>
        </div>
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Juros projetado</p>
          <p className="text-sm font-bold text-destructive mt-0.5">R$ {totalJuros.toLocaleString('pt-BR')}</p>
        </div>
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Impacto mensal</p>
          <p className="text-sm font-bold text-foreground mt-0.5">R$ {totalParcela.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {estrategia && (
        <div className="ios-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Estratégia recomendada</p>
          <p className="text-xs text-foreground leading-relaxed">{estrategia}</p>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-3">
        {state.dividas.map(d => (
          <div key={d.id} className="ios-card p-4">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => { setEditing(d); setFormOpen(true); }} className="text-left flex-1">
                <span className="text-sm font-semibold text-foreground">{d.nome}</span>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-muted-foreground">{d.taxa_juros}% a.m.</span>
                  <span className="text-[10px] text-muted-foreground">{d.parcelas_restantes} parcelas</span>
                  <span className="text-[10px] text-muted-foreground">R$ {d.valor_parcela.toLocaleString('pt-BR')}/mês</span>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">R$ {d.valor_atual.toLocaleString('pt-BR')}</span>
                <button onClick={() => dispatch({ type: 'DELETE_DIVIDA', payload: d.id })} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center">
                  <Trash2 size={12} className="text-destructive" />
                </button>
              </div>
            </div>
            <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full bg-foreground/40" style={{ width: `${Math.round(((d.parcelas_totais - d.parcelas_restantes) / d.parcelas_totais) * 100)}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">Custo total: R$ {calcularCustoDivida(d).toLocaleString('pt-BR')}</span>
              <span className="text-[10px] text-muted-foreground">Juros: R$ {calcularJurosProjetado(d).toLocaleString('pt-BR')}</span>
            </div>
          </div>
        ))}
      </div>

      <DividaForm open={formOpen} onOpenChange={setFormOpen} divida={editing} />
    </div>
  );
}
