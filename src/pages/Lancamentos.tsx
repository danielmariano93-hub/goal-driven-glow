import { useState, useMemo } from 'react';
import { mockGastos, mockReceitas } from '@/data/mockData';
import { CATEGORIAS_GASTO } from '@/types/financial';
import { Plus, Search, ChevronDown } from 'lucide-react';

type Registro = {
  id: string;
  data: string;
  tipo: 'receita' | 'gasto';
  categoria: string;
  descricao: string;
  valor: number;
  emocao?: string;
};

export default function Lancamentos() {
  const [filtroMes, setFiltroMes] = useState('2026-02');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<'data' | 'valor'>('data');

  const registros = useMemo(() => {
    const receitas: Registro[] = mockReceitas.map((r) => ({
      id: r.id,
      data: r.data,
      tipo: 'receita',
      categoria: r.categoria,
      descricao: r.categoria,
      valor: r.valor,
    }));
    const gastos: Registro[] = mockGastos.map((g) => ({
      id: g.id,
      data: g.data,
      tipo: 'gasto',
      categoria: g.categoria,
      descricao: g.descricao,
      valor: g.valor,
      emocao: g.emocao,
    }));

    let all = [...receitas, ...gastos];

    if (filtroMes) all = all.filter((r) => r.data.startsWith(filtroMes));
    if (filtroCategoria) all = all.filter((r) => r.categoria === filtroCategoria);
    if (busca) {
      const q = busca.toLowerCase();
      all = all.filter((r) => r.descricao.toLowerCase().includes(q) || r.categoria.toLowerCase().includes(q));
    }

    if (ordenacao === 'data') all.sort((a, b) => b.data.localeCompare(a.data));
    else all.sort((a, b) => b.valor - a.valor);

    return all;
  }, [filtroMes, filtroCategoria, busca, ordenacao]);

  const getCategoriaLabel = (val: string) =>
    CATEGORIAS_GASTO.find((c) => c.value === val)?.label || val.charAt(0).toUpperCase() + val.slice(1);

  const totalReceitas = registros.filter((r) => r.tipo === 'receita').reduce((s, r) => s + r.valor, 0);
  const totalGastos = registros.filter((r) => r.tipo === 'gasto').reduce((s, r) => s + r.valor, 0);

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Lançamentos</h1>
        <button className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center">
          <Plus size={16} strokeWidth={2.5} />
        </button>
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
          <input
            type="text"
            placeholder="Buscar lançamento..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filtroMes}
            onChange={(e) => setFiltroMes(e.target.value)}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none"
          >
            <option value="2026-02">Fev 2026</option>
            <option value="2026-01">Jan 2026</option>
            <option value="">Todos</option>
          </select>
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none"
          >
            <option value="">Todas categorias</option>
            {CATEGORIAS_GASTO.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as 'data' | 'valor')}
            className="h-8 px-3 rounded-lg bg-secondary text-xs text-foreground outline-none appearance-none"
          >
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
        {registros.map((r) => (
          <button
            key={`${r.tipo}-${r.id}`}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-secondary/50"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground truncate">{r.descricao || getCategoriaLabel(r.categoria)}</span>
                {r.emocao && (
                  <span className="text-[10px] text-muted-foreground">{r.emocao}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(r.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                </span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] text-muted-foreground">{getCategoriaLabel(r.categoria)}</span>
              </div>
            </div>
            <span className={`text-sm font-semibold tabular-nums ${r.tipo === 'receita' ? 'text-success' : 'text-foreground'}`}>
              {r.tipo === 'receita' ? '+' : '-'}R$ {r.valor.toLocaleString('pt-BR')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
