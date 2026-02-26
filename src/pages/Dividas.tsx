import { useState } from 'react';
import { mockDividas } from '@/data/mockData';
import { Divida } from '@/types/financial';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Dividas() {
  const [dividas, setDividas] = useState<Divida[]>(mockDividas);
  const [showForm, setShowForm] = useState(false);

  const defaultDivida: Divida = {
    id: '', tipo: '', valor_original: 0, valor_atual: 0, taxa_juros: 0,
    parcelas_totais: 0, parcelas_restantes: 0, valor_parcela: 0, prioridade: 'media',
  };
  const [form, setForm] = useState<Divida>(defaultDivida);

  const totalAtual = dividas.reduce((s, d) => s + d.valor_atual, 0);
  const custoTotal = dividas.reduce((s, d) => s + d.valor_parcela * d.parcelas_restantes, 0);

  const handleSave = () => {
    if (!form.tipo) return;
    setDividas([...dividas, { ...form, id: crypto.randomUUID() }]);
    setShowForm(false);
    toast.success('Dívida cadastrada');
  };

  const handleDelete = (id: string) => {
    setDividas(dividas.filter((d) => d.id !== id));
    toast.success('Dívida removida');
  };

  // Simple recommendation: pay highest interest first
  const estrategia = dividas.length > 0
    ? `Priorize "${dividas.reduce((a, b) => a.taxa_juros > b.taxa_juros ? a : b).tipo}" (maior taxa: ${dividas.reduce((a, b) => a.taxa_juros > b.taxa_juros ? a : b).taxa_juros}% a.m.)`
    : 'Sem dívidas ativas.';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Dívidas</h1>
        <button onClick={() => { setForm(defaultDivida); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full text-xs font-medium">
          <Plus className="h-3.5 w-3.5" /> Nova Dívida
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Atual</p>
          <p className="text-xl font-bold text-foreground mt-1">R$ {totalAtual.toLocaleString('pt-BR')}</p>
        </div>
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Custo Total Projetado</p>
          <p className="text-xl font-bold text-foreground mt-1">R$ {custoTotal.toLocaleString('pt-BR')}</p>
        </div>
        <div className="apple-card">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Estratégia</p>
          <p className="text-sm text-foreground mt-1 leading-relaxed">{estrategia}</p>
        </div>
      </div>

      {showForm && (
        <div className="apple-card space-y-3">
          <h2 className="text-sm font-medium">Nova Dívida</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Tipo (ex: Financiamento)" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Valor original" value={form.valor_original || ''} onChange={(e) => setForm({ ...form, valor_original: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Valor atual" value={form.valor_atual || ''} onChange={(e) => setForm({ ...form, valor_atual: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Taxa juros (% a.m.)" value={form.taxa_juros || ''} onChange={(e) => setForm({ ...form, taxa_juros: +e.target.value })} step="0.1"
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Parcelas totais" value={form.parcelas_totais || ''} onChange={(e) => setForm({ ...form, parcelas_totais: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Parcelas restantes" value={form.parcelas_restantes || ''} onChange={(e) => setForm({ ...form, parcelas_restantes: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Valor parcela" value={form.valor_parcela || ''} onChange={(e) => setForm({ ...form, valor_parcela: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Divida['prioridade'] })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none">
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-4 py-2 bg-foreground text-background rounded-lg text-xs font-medium">Salvar</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-secondary rounded-lg text-xs font-medium">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {dividas.map((d) => {
          const progresso = Math.round(((d.parcelas_totais - d.parcelas_restantes) / d.parcelas_totais) * 100);
          return (
            <div key={d.id} className="apple-card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{d.tipo}</h3>
                  <p className="text-xs text-muted-foreground">{d.taxa_juros}% a.m. · {d.parcelas_restantes} parcelas restantes</p>
                </div>
                <button onClick={() => handleDelete(d.id)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">R$ {d.valor_atual.toLocaleString('pt-BR')}</span>
                <span className="font-medium">{progresso}% quitado</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progresso}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">Parcela: R$ {d.valor_parcela.toLocaleString('pt-BR')}/mês</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
