import { useState } from 'react';
import { mockMetas } from '@/data/mockData';
import { Meta } from '@/types/financial';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Metas() {
  const [metas, setMetas] = useState<Meta[]>(mockMetas);
  const [editing, setEditing] = useState<Meta | null>(null);
  const [showForm, setShowForm] = useState(false);

  const defaultMeta: Meta = {
    id: '', nome: '', tipo: 'curto', valor_objetivo: 0, valor_atual: 0,
    prazo: '', prioridade: 'media', motivacao_emocional: '', aporte_mensal_planejado: 0,
  };

  const [form, setForm] = useState<Meta>(defaultMeta);

  const openNew = () => { setForm({ ...defaultMeta, id: crypto.randomUUID() }); setEditing(null); setShowForm(true); };
  const openEdit = (m: Meta) => { setForm(m); setEditing(m); setShowForm(true); };
  const handleDelete = (id: string) => {
    setMetas(metas.filter((m) => m.id !== id));
    toast.success('Meta excluída');
  };
  const handleSave = () => {
    if (!form.nome || !form.valor_objetivo) return;
    if (editing) {
      setMetas(metas.map((m) => (m.id === form.id ? form : m)));
      toast.success('Meta atualizada');
    } else {
      setMetas([...metas, form]);
      toast.success('Meta criada');
    }
    setShowForm(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Metas</h1>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full text-xs font-medium hover:opacity-90 transition-opacity">
          <Plus className="h-3.5 w-3.5" /> Nova Meta
        </button>
      </div>

      {showForm && (
        <div className="apple-card space-y-4">
          <h2 className="text-sm font-medium text-foreground">{editing ? 'Editar Meta' : 'Nova Meta'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Nome da meta" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Meta['tipo'] })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none">
              <option value="curto">Curto prazo</option>
              <option value="medio">Médio prazo</option>
              <option value="longo">Longo prazo</option>
            </select>
            <input type="number" placeholder="Valor objetivo" value={form.valor_objetivo || ''} onChange={(e) => setForm({ ...form, valor_objetivo: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Valor atual" value={form.valor_atual || ''} onChange={(e) => setForm({ ...form, valor_atual: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Meta['prioridade'] })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none">
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
            <input placeholder="Motivação emocional" value={form.motivacao_emocional} onChange={(e) => setForm({ ...form, motivacao_emocional: e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none col-span-full" />
            <input type="number" placeholder="Aporte mensal planejado" value={form.aporte_mensal_planejado || ''} onChange={(e) => setForm({ ...form, aporte_mensal_planejado: +e.target.value })}
              className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-4 py-2 bg-foreground text-background rounded-lg text-xs font-medium">Salvar</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-secondary text-foreground rounded-lg text-xs font-medium">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {metas.map((meta) => {
          const progresso = Math.round((meta.valor_atual / meta.valor_objetivo) * 100);
          const restante = meta.valor_objetivo - meta.valor_atual;
          const mesesRestantes = meta.aporte_mensal_planejado > 0 ? Math.ceil(restante / meta.aporte_mensal_planejado) : null;

          return (
            <div key={meta.id} className="apple-card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{meta.nome}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.motivacao_emocional}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    meta.prioridade === 'alta' ? 'bg-risk/10 text-risk' : meta.prioridade === 'media' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'
                  }`}>{meta.prioridade}</span>
                  <button onClick={() => openEdit(meta)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <button onClick={() => handleDelete(meta.id)} className="p-1.5 hover:bg-secondary rounded-lg transition-colors">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>
              <div className="mb-2">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">R$ {meta.valor_atual.toLocaleString('pt-BR')}</span>
                  <span className="font-medium">{progresso}%</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-success rounded-full transition-all" style={{ width: `${progresso}%` }} />
                </div>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Falta: R$ {restante.toLocaleString('pt-BR')}</span>
                {mesesRestantes && <span>~{mesesRestantes} meses restantes</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
