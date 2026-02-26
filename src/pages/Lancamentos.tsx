import { useState, useMemo } from 'react';
import { useFinancial } from '@/context/FinancialContext';
import { CATEGORIAS_GASTO } from '@/types/financial';
import { Plus, Search, Download, Copy, Trash2 } from 'lucide-react';
import { LancamentoForm } from '@/components/LancamentoForm';
import { exportarCSV } from '@/lib/csv';
import type { Lancamento } from '@/types/financial';

export default function Lancamentos() {
  const { state, dispatch } = useFinancial();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [filtroMes, setFiltroMes] = useState(currentMonth);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'' | 'receita' | 'despesa'>('');
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<'data' | 'valor'>('data');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lancamento | null>(null);

  const registros = useMemo(() => {
    let all = [...state.lancamentos];
    if (filtroMes) all = all.filter(r => r.data.startsWith(filtroMes));
    if (filtroCategoria) all = all.filter(r => r.categoria === filtroCategoria);
    if (filtroTipo) all = all.filter(r => r.tipo === filtroTipo);
    if (busca) {
      const q = busca.toLowerCase();
      all = all.filter(r => r.descricao.toLowerCase().includes(q) || r.categoria.toLowerCase().includes(q));
    }
    if (ordenacao === 'data') all.sort((a, b) => b.data.localeCompare(a.data));
    else all.sort((a, b) => b.valor - a.valor);
    return all;
  }, [state.lancamentos, filtroMes, filtroCategoria, filtroTipo, busca, ordenacao]);

  const getCategoriaLabel = (val: string) =>
    CATEGORIAS_GASTO.find(c => c.value === val)?.label || val.charAt(0).toUpperCase() + val.slice(1);

  const mesesDisponiveis = useMemo(() => {
    const mesesSet = new Set<string>();
    state.lancamentos.forEach(l => {
      const ym = l.data.slice(0, 7);
      if (ym) mesesSet.add(ym);
    });
    // Always include current month
    mesesSet.add(currentMonth);
    return Array.from(mesesSet).sort().reverse().map(ym => {
      const [y, m] = ym.split('-').map(Number);
      const label = new Date(y, m - 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
      return { value: ym, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
  }, [state.lancamentos, currentMonth]);

  const totalReceitas = registros.filter(r => r.tipo === 'receita').reduce((s, r) => s + r.valor, 0);
  const totalGastos = registros.filter(r => r.tipo === 'despesa').reduce((s, r) => s + r.valor, 0);

  const duplicar = (l: Lancamento) => {
    dispatch({ type: 'ADD_LANCAMENTO', payload: { ...l, id: crypto.randomUUID() } });
  };

  const deletar = (id: string) => {
    dispatch({ type: 'DELETE_LANCAMENTO', payload: id });
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Lançamentos</h1>
        <div className="flex gap-2">
          <button onClick={() => exportarCSV(registros)} className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <Download size={14} className="text-muted-foreground" />
          </button>
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex gap-3">
        <div className="ios-card flex-1 p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Receitas</p>
          <p className="text-sm font-semibold text-success mt-0.5">R$ {totalReceitas.toLocaleString('pt-BR')}</p>
        </div>
        <div className="ios-card flex-1 p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Despesas</p>
          <p className="text-sm font-semibold text-destructive mt-0.5">R$ {totalGastos.toLocaleString('pt-BR')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Buscar lançamento..." value={busca} onChange={e => setBusca(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
        </div>
        <div className="flex gap-2 flex-wrap">
         <select value={filtroMes} onChange={e => setFiltroMes(e.target.value)}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none">
            {mesesDisponiveis.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            <option value="">Todos</option>
          </select>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="">Todas categorias</option>
            {CATEGORIAS_GASTO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as any)}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="">Todos tipos</option>
            <option value="receita">Receita</option>
            <option value="despesa">Despesa</option>
          </select>
          <select value={ordenacao} onChange={e => setOrdenacao(e.target.value as 'data' | 'valor')}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="data">Data</option>
            <option value="valor">Valor</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="ios-card divide-y divide-border overflow-hidden">
        {registros.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">Nenhum lançamento encontrado</p>
        )}
        {registros.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => { setEditing(r); setFormOpen(true); }} className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground truncate">{r.descricao}</span>
                {r.impulsivo && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">impulsivo</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {(() => { const [y, m, d] = r.data.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); })()}
                </span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-muted-foreground">{getCategoriaLabel(r.categoria)}</span>
                {r.emocao && <><span className="text-[10px] text-muted-foreground">·</span><span className="text-[10px] text-muted-foreground">{r.emocao}</span></>}
                {r.forma_pagamento && <><span className="text-[10px] text-muted-foreground">·</span><span className="text-[10px] text-muted-foreground">{r.forma_pagamento}</span></>}
              </div>
            </button>
            <span className={`text-sm font-semibold tabular-nums shrink-0 ${r.tipo === 'receita' ? 'text-success' : 'text-foreground'}`}>
              {r.tipo === 'receita' ? '+' : '-'}R$ {r.valor.toLocaleString('pt-BR')}
            </span>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => duplicar(r)} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center">
                <Copy size={12} className="text-muted-foreground" />
              </button>
              <button onClick={() => deletar(r.id)} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center">
                <Trash2 size={12} className="text-destructive" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <LancamentoForm open={formOpen} onOpenChange={setFormOpen} lancamento={editing} />
    </div>
  );
}
