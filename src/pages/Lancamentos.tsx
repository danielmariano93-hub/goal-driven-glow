import { useState, useMemo } from 'react';
import { mockGastos, mockReceitas } from '@/data/mockData';
import { CATEGORIAS_GASTO, EMOCOES } from '@/types/financial';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

type FilterType = 'todos' | 'receita' | 'gasto';

export default function Lancamentos() {
  const [filterTipo, setFilterTipo] = useState<FilterType>('todos');
  const [filterCategoria, setFilterCategoria] = useState('');
  const [filterImpulsivo, setFilterImpulsivo] = useState<'' | 'sim' | 'nao'>('');

  const registros = useMemo(() => {
    const receitas = mockReceitas.map((r) => ({
      id: r.id,
      data: r.data,
      tipo: 'receita' as const,
      categoria: r.categoria,
      valor: r.valor,
      impulsivo: false,
      emocao: '',
      forma_pagamento: '-',
      descricao: r.categoria,
    }));
    const gastos = mockGastos.map((g) => ({
      id: g.id,
      data: g.data,
      tipo: 'gasto' as const,
      categoria: g.categoria,
      valor: g.valor,
      impulsivo: g.impulsivo,
      emocao: g.emocao || '',
      forma_pagamento: g.forma_pagamento,
      descricao: g.descricao,
    }));
    let all = [...receitas, ...gastos].sort((a, b) => b.data.localeCompare(a.data));

    if (filterTipo !== 'todos') all = all.filter((r) => r.tipo === filterTipo);
    if (filterCategoria) all = all.filter((r) => r.categoria === filterCategoria);
    if (filterImpulsivo === 'sim') all = all.filter((r) => r.impulsivo);
    if (filterImpulsivo === 'nao') all = all.filter((r) => !r.impulsivo);

    return all;
  }, [filterTipo, filterCategoria, filterImpulsivo]);

  const getCategoriaLabel = (val: string) =>
    CATEGORIAS_GASTO.find((c) => c.value === val)?.label || val;
  const getEmocaoLabel = (val: string) =>
    EMOCOES.find((e) => e.value === val)?.label || val || '-';

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
      active ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Lançamentos</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button className={chipClass(filterTipo === 'todos')} onClick={() => setFilterTipo('todos')}>Todos</button>
        <button className={chipClass(filterTipo === 'receita')} onClick={() => setFilterTipo('receita')}>Receitas</button>
        <button className={chipClass(filterTipo === 'gasto')} onClick={() => setFilterTipo('gasto')}>Gastos</button>
        <span className="w-px bg-border mx-1" />
        <select
          value={filterCategoria}
          onChange={(e) => setFilterCategoria(e.target.value)}
          className="px-3 py-1.5 rounded-full text-xs bg-secondary text-muted-foreground border-none outline-none"
        >
          <option value="">Todas categorias</option>
          {CATEGORIAS_GASTO.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={filterImpulsivo}
          onChange={(e) => setFilterImpulsivo(e.target.value as '' | 'sim' | 'nao')}
          className="px-3 py-1.5 rounded-full text-xs bg-secondary text-muted-foreground border-none outline-none"
        >
          <option value="">Impulsivo?</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      </div>

      {/* Table */}
      <div className="apple-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Data</TableHead>
              <TableHead className="text-xs">Tipo</TableHead>
              <TableHead className="text-xs">Categoria</TableHead>
              <TableHead className="text-xs text-right">Valor</TableHead>
              <TableHead className="text-xs">Impulsivo</TableHead>
              <TableHead className="text-xs">Emoção</TableHead>
              <TableHead className="text-xs">Pagamento</TableHead>
              <TableHead className="text-xs">Descrição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registros.map((r) => (
              <TableRow key={`${r.tipo}-${r.id}`}>
                <TableCell className="text-xs whitespace-nowrap">
                  {new Date(r.data).toLocaleDateString('pt-BR')}
                </TableCell>
                <TableCell>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    r.tipo === 'receita' ? 'bg-success/10 text-success' : 'bg-risk/10 text-risk'
                  }`}>
                    {r.tipo === 'receita' ? 'Receita' : 'Gasto'}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{getCategoriaLabel(r.categoria)}</TableCell>
                <TableCell className={`text-xs text-right font-medium ${r.tipo === 'receita' ? 'text-success' : 'text-foreground'}`}>
                  R$ {r.valor.toLocaleString('pt-BR')}
                </TableCell>
                <TableCell className="text-xs">{r.tipo === 'gasto' ? (r.impulsivo ? '⚡ Sim' : 'Não') : '-'}</TableCell>
                <TableCell className="text-xs">{getEmocaoLabel(r.emocao)}</TableCell>
                <TableCell className="text-xs capitalize">{r.forma_pagamento}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.descricao}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
