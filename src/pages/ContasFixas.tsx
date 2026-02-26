import { useState } from 'react';
import { mockContasFixas } from '@/data/mockData';
import { ContaFixa } from '@/types/financial';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ContasFixas() {
  const [contas, setContas] = useState<ContaFixa[]>(mockContasFixas);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContaFixa>({ id: '', nome: '', valor: 0, vencimento: 1, recorrencia_mensal: true });

  const total = contas.reduce((s, c) => s + c.valor, 0);

  const handleSave = () => {
    if (!form.nome) return;
    setContas([...contas, { ...form, id: crypto.randomUUID() }]);
    setShowForm(false);
    toast.success('Conta adicionada');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Contas Fixas</h1>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full text-xs font-medium">
          <Plus className="h-3.5 w-3.5" /> Nova Conta
        </button>
      </div>

      <div className="apple-card">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Mensal</p>
        <p className="text-2xl font-bold text-foreground mt-1">R$ {total.toLocaleString('pt-BR')}</p>
      </div>

      {showForm && (
        <div className="apple-card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Valor" value={form.valor || ''} onChange={(e) => setForm({ ...form, valor: +e.target.value })} className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
            <input type="number" placeholder="Dia vencimento" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: +e.target.value })} min={1} max={31} className="px-3 py-2 bg-secondary rounded-lg text-sm outline-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-4 py-2 bg-foreground text-background rounded-lg text-xs font-medium">Salvar</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-secondary rounded-lg text-xs font-medium">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {contas.map((c) => (
          <div key={c.id} className="apple-card flex items-center justify-between py-3 px-4">
            <div>
              <p className="text-sm font-medium text-foreground">{c.nome}</p>
              <p className="text-xs text-muted-foreground">Vence dia {c.vencimento}</p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-foreground">R$ {c.valor.toLocaleString('pt-BR')}</p>
              <button onClick={() => { setContas(contas.filter((x) => x.id !== c.id)); toast.success('Removida'); }} className="p-1.5 hover:bg-secondary rounded-lg">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
