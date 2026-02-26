import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFinancial } from '@/context/FinancialContext';
import type { Investimento } from '@/types/financial';

const TIPOS_INVESTIMENTO = [
  'Tesouro Direto', 'CDB', 'LCI/LCA', 'Ações', 'FIIs',
  'ETF', 'Criptomoedas', 'Previdência', 'Poupança', 'Outro',
];

const LIQUIDEZ_OPTIONS: { value: Investimento['liquidez']; label: string }[] = [
  { value: 'imediata', label: 'Imediata' },
  { value: 'curto_prazo', label: 'Curto prazo' },
  { value: 'longo_prazo', label: 'Longo prazo' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investimento?: Investimento | null;
}

function getDefault(inv?: Investimento | null): Omit<Investimento, 'id'> {
  return {
    tipo: inv?.tipo || 'Tesouro Direto',
    valor_aplicado: inv?.valor_aplicado || 0,
    valor_atual: inv?.valor_atual || 0,
    rendimento_estimado: inv?.rendimento_estimado || 0,
    liquidez: inv?.liquidez || 'curto_prazo',
  };
}

export function InvestimentoForm({ open, onOpenChange, investimento }: Props) {
  const { dispatch } = useFinancial();
  const isEdit = !!investimento;
  const [form, setForm] = useState(getDefault(investimento));

  useEffect(() => {
    if (open) setForm(getDefault(investimento));
  }, [investimento, open]);

  const set = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    if (form.valor_aplicado <= 0) return;
    const payload: Investimento = {
      ...form,
      id: investimento?.id || crypto.randomUUID(),
      valor_atual: form.valor_atual || form.valor_aplicado,
    };
    dispatch({ type: isEdit ? 'UPDATE_INVESTIMENTO' : 'ADD_INVESTIMENTO', payload });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? 'Editar' : 'Novo'} Investimento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <select value={form.tipo} onChange={e => set('tipo', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            {TIPOS_INVESTIMENTO.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Valor aplicado</label>
            <input type="number" placeholder="0" value={form.valor_aplicado || ''} onChange={e => set('valor_aplicado', parseFloat(e.target.value) || 0)}
              className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Valor atual</label>
            <input type="number" placeholder="0" value={form.valor_atual || ''} onChange={e => set('valor_atual', parseFloat(e.target.value) || 0)}
              className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Rendimento estimado (% a.a.)</label>
            <input type="number" step="0.1" placeholder="0" value={form.rendimento_estimado || ''} onChange={e => set('rendimento_estimado', parseFloat(e.target.value) || 0)}
              className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none" />
          </div>

          <select value={form.liquidez} onChange={e => set('liquidez', e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground outline-none appearance-none">
            {LIQUIDEZ_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>

          <Button onClick={handleSubmit} className="w-full h-10 rounded-xl text-xs">
            {isEdit ? 'Salvar' : 'Adicionar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
