import { useState } from 'react';
import { EMOCOES, EmocaoDiaria } from '@/types/financial';
import { toast } from 'sonner';

const mockEmocoes: EmocaoDiaria[] = [
  { id: '1', data: '2026-02-25', nivel: 4, emocao_principal: 'calmo', observacao: 'Dia produtivo' },
  { id: '2', data: '2026-02-24', nivel: 2, emocao_principal: 'ansioso', observacao: 'Conta inesperada' },
  { id: '3', data: '2026-02-23', nivel: 5, emocao_principal: 'feliz', observacao: 'Recebi bônus' },
  { id: '4', data: '2026-02-22', nivel: 3, emocao_principal: 'estressado', observacao: 'Muito trabalho' },
  { id: '5', data: '2026-02-21', nivel: 4, emocao_principal: 'calmo' },
];

export default function Emocoes() {
  const [emocoes, setEmocoes] = useState<EmocaoDiaria[]>(mockEmocoes);
  const [selectedEmocao, setSelectedEmocao] = useState('');
  const [nivel, setNivel] = useState(3);
  const [obs, setObs] = useState('');

  const handleRegistrar = () => {
    if (!selectedEmocao) return;
    const nova: EmocaoDiaria = {
      id: crypto.randomUUID(),
      data: new Date().toISOString().slice(0, 10),
      nivel,
      emocao_principal: selectedEmocao,
      observacao: obs || undefined,
    };
    setEmocoes([nova, ...emocoes]);
    setSelectedEmocao('');
    setNivel(3);
    setObs('');
    toast.success('Emoção registrada');
  };

  const getEmocaoInfo = (val: string) => EMOCOES.find((e) => e.value === val);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Emoções</h1>

      {/* Register */}
      <div className="apple-card space-y-4">
        <h2 className="text-sm font-medium text-foreground">Como você está se sentindo hoje?</h2>
        <div className="grid grid-cols-4 gap-2">
          {EMOCOES.map((em) => (
            <button
              key={em.value}
              onClick={() => setSelectedEmocao(em.value)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl text-xs transition-colors ${
                selectedEmocao === em.value ? 'bg-foreground text-background' : 'bg-secondary text-foreground hover:bg-accent'
              }`}
            >
              <span className="text-xl">{em.icon}</span>
              <span className="font-medium">{em.label}</span>
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Nível (1-5)</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setNivel(n)}
                className={`w-10 h-10 rounded-full text-sm font-medium transition-colors ${
                  nivel === n ? 'bg-foreground text-background' : 'bg-secondary text-foreground'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Observação (opcional)"
          className="w-full px-3 py-2 bg-secondary rounded-lg text-sm outline-none"
        />
        <button
          onClick={handleRegistrar}
          disabled={!selectedEmocao}
          className="px-4 py-2 bg-foreground text-background rounded-lg text-xs font-medium disabled:opacity-40"
        >
          Registrar
        </button>
      </div>

      {/* Timeline */}
      <div className="space-y-1">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Histórico</h2>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-4">
            {emocoes.map((em) => {
              const info = getEmocaoInfo(em.emocao_principal);
              return (
                <div key={em.id} className="relative pl-10">
                  <div className="absolute left-2.5 top-1 w-3 h-3 rounded-full bg-card border-2 border-border" />
                  <div className="apple-card py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{info?.icon}</span>
                        <span className="text-sm font-medium text-foreground">{info?.label}</span>
                        <span className="text-xs text-muted-foreground">Nível {em.nivel}/5</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(em.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                    {em.observacao && <p className="text-xs text-muted-foreground mt-1">{em.observacao}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
