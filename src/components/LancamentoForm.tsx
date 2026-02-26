import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFinancial } from '@/context/FinancialContext';
import { CATEGORIAS_GASTO, EMOCOES, FORMAS_PAGAMENTO } from '@/types/financial';
import type { Lancamento } from '@/types/financial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lancamento?: Lancamento | null;
}

function getDefaultForm(lancamento?: Lancamento | null): Omit<Lancamento, 'id'> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return {
    data: lancamento?.data || todayStr,
    tipo: lancamento?.tipo || 'despesa',
    categoria: lancamento?.categoria || 'alimentacao',
    subcategoria: lancamento?.subcategoria || '',
    descricao: lancamento?.descricao || '',
    valor: lancamento?.valor || 0,
    fixo: lancamento?.fixo || false,
    recorrente: lancamento?.recorrente || false,
    impulsivo: lancamento?.impulsivo || false,
    emocao: lancamento?.emocao || '',
    forma_pagamento: lancamento?.forma_pagamento || 'pix',
  };
}

export function LancamentoForm({ open, onOpenChange, lancamento }: Props) {
  const { dispatch } = useFinancial();
  const isEdit = !!lancamento;

  const [form, setForm] = useState<Omit<Lancamento, 'id'>>(getDefaultForm(lancamento));

  // Re-initialize form when lancamento changes (edit vs new)
  useEffect(() => {
    if (open) {
      setForm(getDefaultForm(lancamento));
    }
  }, [lancamento, open]);

  const handleSubmit = () => {
    if (!form.descricao || form.valor <= 0) return;
    const payload: Lancamento = {
      ...form,
      id: lancamento?.id || crypto.randomUUID(),
    };
    dispatch({ type: isEdit ? 'UPDATE_LANCAMENTO' : 'ADD_LANCAMENTO', payload });
    onOpenChange(false);
  };

  const set = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? 'Editar' : 'Novo'} Lançamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="flex gap-2">
            {(['receita', 'despesa'] as const).map(t => (
              <button
                key={t}
                onClick={() => set('tipo', t)}
                className={`flex-1 h-9 rounded-xl text-xs font-medium transition-colors ${form.tipo === t ? 'bg-foreground text-background' : 'bg-secondary text-foreground'}`}
              >
                {t === 'receita' ? 'Receita' : 'Despesa'}
              </button>
            ))}
          </div>

          <input type="date" value={form.data} onChange={e => set('data', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none" />

          <input type="text" placeholder="Descrição" value={form.descricao} onChange={e => set('descricao', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />

          <input type="number" placeholder="Valor" value={form.valor || ''} onChange={e => set('valor', parseFloat(e.target.value) || 0)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />

          <select value={form.categoria} onChange={e => set('categoria', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="salario">Salário</option>
            <option value="freelance">Freelance</option>
            {CATEGORIAS_GASTO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          <select value={form.forma_pagamento} onChange={e => set('forma_pagamento', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            {FORMAS_PAGAMENTO.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>

          <select value={form.emocao} onChange={e => set('emocao', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="">Sem emoção</option>
            {EMOCOES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>

          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={form.fixo} onChange={e => set('fixo', e.target.checked)} className="rounded" /> Fixo
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={form.recorrente} onChange={e => set('recorrente', e.target.checked)} className="rounded" /> Recorrente
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={form.impulsivo} onChange={e => set('impulsivo', e.target.checked)} className="rounded" /> Impulsivo
            </label>
          </div>

          <Button onClick={handleSubmit} className="w-full h-10 rounded-xl text-xs">
            {isEdit ? 'Salvar' : 'Adicionar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
