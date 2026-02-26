import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFinancial } from '@/context/FinancialContext';
import type { Divida } from '@/types/financial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  divida?: Divida | null;
}

export function DividaForm({ open, onOpenChange, divida }: Props) {
  const { dispatch } = useFinancial();
  const isEdit = !!divida;

  const [form, setForm] = useState<Omit<Divida, 'id'>>({
    nome: divida?.nome || '',
    valor_original: divida?.valor_original || 0,
    valor_atual: divida?.valor_atual || 0,
    taxa_juros: divida?.taxa_juros || 0,
    parcelas_totais: divida?.parcelas_totais || 0,
    parcelas_restantes: divida?.parcelas_restantes || 0,
    valor_parcela: divida?.valor_parcela || 0,
    prioridade: divida?.prioridade || 'media',
  });

  const set = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    if (!form.nome || form.valor_original <= 0) return;
    const payload: Divida = { ...form, id: divida?.id || crypto.randomUUID() };
    dispatch({ type: isEdit ? 'UPDATE_DIVIDA' : 'ADD_DIVIDA', payload });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? 'Editar' : 'Nova'} Dívida</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <input type="text" placeholder="Nome da dívida" value={form.nome} onChange={e => set('nome', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />

          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Valor original" value={form.valor_original || ''} onChange={e => set('valor_original', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
            <input type="number" placeholder="Saldo atual" value={form.valor_atual || ''} onChange={e => set('valor_atual', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.1" placeholder="Taxa juros % a.m." value={form.taxa_juros || ''} onChange={e => set('taxa_juros', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
            <input type="number" placeholder="Valor parcela" value={form.valor_parcela || ''} onChange={e => set('valor_parcela', parseFloat(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input type="number" placeholder="Parcelas totais" value={form.parcelas_totais || ''} onChange={e => set('parcelas_totais', parseInt(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
            <input type="number" placeholder="Parcelas restantes" value={form.parcelas_restantes || ''} onChange={e => set('parcelas_restantes', parseInt(e.target.value) || 0)}
              className="h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <select value={form.prioridade} onChange={e => set('prioridade', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            <option value="alta">Alta prioridade</option>
            <option value="media">Média prioridade</option>
            <option value="baixa">Baixa prioridade</option>
          </select>

          <Button onClick={handleSubmit} className="w-full h-10 rounded-xl text-xs">
            {isEdit ? 'Salvar' : 'Adicionar Dívida'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
