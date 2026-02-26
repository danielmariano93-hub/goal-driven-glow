import { useState } from 'react';
import { useFinancial } from '@/context/FinancialContext';
import { User, Plus, Trash2, ChevronRight, X } from 'lucide-react';
import { CATEGORIAS_GASTO } from '@/types/financial';
import { Button } from '@/components/ui/button';

export default function Perfil() {
  const { state, dispatch } = useFinancial();
  const { config } = state;

  const [renda, setRenda] = useState(config.renda_mensal.toString());
  const [horizonte, setHorizonte] = useState(config.horizonte_tempo.toString());
  const [objetivo, setObjetivo] = useState(config.objetivo_macro);
  const [perfil, setPerfil] = useState(config.perfil_risco);

  const salvar = () => {
    dispatch({
      type: 'UPDATE_CONFIG',
      payload: {
        renda_mensal: parseFloat(renda) || 0,
        horizonte_tempo: parseInt(horizonte) || 10,
        objetivo_macro: objetivo,
        perfil_risco: perfil as any,
      },
    });
  };

  const exportarDados = () => {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_financeiro_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importarDados = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          dispatch({ type: 'IMPORT_DATA', payload: data });
        } catch {}
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const totalInvestimentos = state.investimentos.reduce((s, i) => s + i.valor_atual, 0);
  const totalDividas = state.dividas.reduce((s, d) => s + d.valor_atual, 0);
  const totalContasFixas = state.contasFixas.reduce((s, c) => s + c.valor, 0);

  return (
    <div className="space-y-5 pt-2">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
          <User size={20} className="text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Perfil</h1>
          <p className="text-xs text-muted-foreground">Configurações financeiras</p>
        </div>
      </div>

      {/* Config */}
      <div className="ios-card p-4 space-y-3">
        <h3 className="text-xs text-muted-foreground font-medium">Configurações base</h3>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Renda mensal</label>
          <input type="number" value={renda} onChange={e => setRenda(e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none" />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Objetivo macro</label>
          <input type="text" value={objetivo} onChange={e => setObjetivo(e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Perfil de risco</label>
            <select value={perfil} onChange={e => setPerfil(e.target.value as any)}
              className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
              <option value="conservador">Conservador</option>
              <option value="moderado">Moderado</option>
              <option value="arrojado">Arrojado</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Horizonte (anos)</label>
            <input type="number" value={horizonte} onChange={e => setHorizonte(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none" />
          </div>
        </div>

        <Button onClick={salvar} className="w-full h-9 rounded-xl text-xs">Salvar configurações</Button>
      </div>

      {/* Categorias customizadas */}
      <CategoriaManager />

      {/* Investimentos */}
      <div className="ios-card overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Investimentos</h3>
          <span className="text-xs font-semibold text-foreground">R$ {totalInvestimentos.toLocaleString('pt-BR')}</span>
        </div>
        <div className="divide-y divide-border">
          {state.investimentos.map(i => (
            <div key={i.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-xs font-medium text-foreground">{i.tipo}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{i.rendimento_estimado}% a.a. · {i.liquidez.replace('_', ' ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">R$ {i.valor_atual.toLocaleString('pt-BR')}</span>
                <button onClick={() => dispatch({ type: 'DELETE_INVESTIMENTO', payload: i.id })} className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center">
                  <Trash2 size={10} className="text-destructive" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contas Fixas */}
      <div className="ios-card overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contas Fixas</h3>
          <span className="text-xs font-semibold text-foreground">R$ {totalContasFixas.toLocaleString('pt-BR')}/mês</span>
        </div>
        <div className="divide-y divide-border">
          {state.contasFixas.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-xs font-medium text-foreground">{c.nome}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Dia {c.vencimento}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">R$ {c.valor.toLocaleString('pt-BR')}</span>
                <button onClick={() => dispatch({ type: 'DELETE_CONTA_FIXA', payload: c.id })} className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center">
                  <Trash2 size={10} className="text-destructive" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dívidas */}
      <div className="ios-card overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Dívidas</h3>
          <span className="text-xs font-semibold text-foreground">R$ {totalDividas.toLocaleString('pt-BR')}</span>
        </div>
        <div className="divide-y divide-border">
          {state.dividas.map(d => (
            <div key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-xs font-medium text-foreground">{d.nome}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{d.parcelas_restantes} parcelas · {d.taxa_juros}% a.m.</p>
              </div>
              <span className="text-xs font-semibold text-foreground">R$ {d.valor_atual.toLocaleString('pt-BR')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Export/Import */}
      <div className="ios-card divide-y divide-border overflow-hidden">
        <button onClick={exportarDados} className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-secondary/50 transition-colors">
          <span className="text-xs font-medium text-foreground">Exportar dados</span>
          <ChevronRight size={14} className="text-muted-foreground" />
        </button>
        <button onClick={importarDados} className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-secondary/50 transition-colors">
          <span className="text-xs font-medium text-foreground">Importar dados</span>
          <ChevronRight size={14} className="text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

function CategoriaManager() {
  const { state, dispatch } = useFinancial();
  const [nova, setNova] = useState('');
  const categoriasCustom = state.categoriasCustom || [];

  const adicionar = () => {
    const nome = nova.trim();
    if (!nome || categoriasCustom.includes(nome)) return;
    dispatch({ type: 'ADD_CATEGORIA', payload: nome });
    setNova('');
  };

  return (
    <div className="ios-card p-4 space-y-3">
      <h3 className="text-xs text-muted-foreground font-medium">Categorias de lançamento</h3>
      
      <div className="space-y-1">
        <p className="text-[10px] text-muted-foreground">Categorias padrão</p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIAS_GASTO.map(c => (
            <span key={c.value} className="text-[10px] px-2 py-1 rounded-lg bg-secondary text-muted-foreground">{c.label}</span>
          ))}
        </div>
      </div>

      {categoriasCustom.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground">Suas categorias</p>
          <div className="flex flex-wrap gap-1.5">
            {categoriasCustom.map(c => (
              <span key={c} className="text-[10px] px-2 py-1 rounded-lg bg-primary/10 text-primary font-medium flex items-center gap-1">
                {c}
                <button onClick={() => dispatch({ type: 'DELETE_CATEGORIA', payload: c })} className="hover:text-destructive">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input type="text" placeholder="Nome da nova categoria" value={nova} onChange={e => setNova(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && adicionar()}
          className="flex-1 h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
        <button onClick={adicionar} className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-medium">
          Adicionar
        </button>
      </div>
    </div>
  );
}
