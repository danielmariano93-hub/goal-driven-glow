import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useFinancial } from '@/context/FinancialContext';
import { EMOCOES } from '@/types/financial';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmocaoForm({ open, onOpenChange }: Props) {
  const { dispatch } = useFinancial();
  const [nivel, setNivel] = useState(3);
  const [emocao, setEmocao] = useState('calmo');
  const [observacao, setObservacao] = useState('');

  const handleSubmit = () => {
    dispatch({
      type: 'ADD_EMOCAO',
      payload: {
        id: crypto.randomUUID(),
        data: new Date().toISOString().slice(0, 10),
        nivel,
        emocao_principal: emocao,
        observacao: observacao || undefined,
      },
    });
    setNivel(3);
    setEmocao('calmo');
    setObservacao('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Como você está hoje?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Nível de bem-estar</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setNivel(n)}
                  className={`flex-1 h-9 rounded-xl text-xs font-medium transition-colors ${nivel === n ? 'bg-foreground text-background' : 'bg-secondary text-foreground'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-2">Emoção principal</p>
            <div className="grid grid-cols-4 gap-1.5">
              {EMOCOES.map(e => (
                <button
                  key={e.value}
                  onClick={() => setEmocao(e.value)}
                  className={`h-8 rounded-lg text-[10px] font-medium transition-colors ${emocao === e.value ? 'bg-foreground text-background' : 'bg-secondary text-foreground'}`}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          <input
            type="text"
            placeholder="Observação (opcional)"
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-secondary text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />

          <Button onClick={handleSubmit} className="w-full h-10 rounded-xl text-xs">
            Registrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
