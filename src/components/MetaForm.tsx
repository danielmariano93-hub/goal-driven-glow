import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFinancial } from '@/context/FinancialContext';
import { TIPOS_META } from '@/types/financial';
import type { Meta } from '@/types/financial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta?: Meta | null;
}

export function MetaForm({ open, onOpenChange, meta }: Props) {
  const { dispatch } = useFinancial();
  const isEdit = !!meta;

  const [form, setForm] = useState<Omit<Meta, 'id'>>({
    nome: meta?.nome || '',
    tipo: meta?.tipo || 'compra',
    valor_objetivo: meta?.valor_objetivo || 0,
    valor_atual: meta?.valor_atual || 0,
    prazo: meta?.prazo || '',
    prioridade: meta?.prioridade || 'media',
    status: meta?.status || 'ativa',
    motivacao_emocional: meta?.motivacao_emocional || '',
    aporte_mensal_planejado: meta?.aporte_mensal_planejado || 0,
  });

  const set = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    if (!form.nome || form.valor_objetivo <= 0) return;
    const payload: Meta = { ...form, id: meta?.id || crypto.randomUUID() };
    dispatch({ type: isEdit ? 'UPDATE_META' : 'ADD_META', payload });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? 'Editar' : 'Nova'} Meta</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <input type="text" placeholder="Nome da meta" value={form.nome} onChange={e => set('nome', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />

          <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            {TIPOS_META.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Valor objetivo" value={form.valor_objetivo || ''} onChange={e => set('valor_objetivo', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
            <input type="number" placeholder="Valor atual" value={form.valor_atual || ''} onChange={e => set('valor_atual', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Aporte mensal" value={form.aporte_mensal_planejado || ''} onChange={e => set('aporte_mensal_planejado', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
            <input type="date" value={form.prazo} onChange={e => set('prazo', e.target.value)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none" />
          </div>

          <select value={form.prioridade} onChange={e => set('prioridade', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="alta">Alta prioridade</option>
            <option value="media">Média prioridade</option>
            <option value="baixa">Baixa prioridade</option>
          </select>

          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="ativa">Ativa</option>
            <option value="pausada">Pausada</option>
            <option value="concluida">Concluída</option>
          </select>

          <input type="text" placeholder="Motivação emocional" value={form.motivacao_emocional} onChange={e => set('motivacao_emocional', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />

          <Button onClick={handleSubmit} className="w-full h-10 rounded-xl text-xs">
            {isEdit ? 'Salvar' : 'Criar Meta'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
