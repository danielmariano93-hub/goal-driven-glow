import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { CATEGORIAS_GASTO, EMOCOES, FORMAS_PAGAMENTO } from '@/types/financial';

interface QuickExpenseModalProps {
  onClose: () => void;
  onSubmit: (data: {
    valor: number;
    categoria: string;
    emocao: string;
    descricao: string;
    forma_pagamento: string;
    impulsivo: boolean;
  }) => void;
}

export function QuickExpenseButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
      style={{ boxShadow: 'var(--shadow-float)' }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <Plus className="w-6 h-6" />
    </motion.button>
  );
}

export function QuickExpenseModal({ onClose, onSubmit }: QuickExpenseModalProps) {
  const [step, setStep] = useState(0);
  const [valor, setValor] = useState('');
  const [categoria, setCategoria] = useState('');
  const [emocao, setEmocao] = useState('');
  const [descricao, setDescricao] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('pix');
  const [impulsivo, setImpulsivo] = useState(false);

  const handleSubmit = () => {
    onSubmit({
      valor: parseFloat(valor),
      categoria,
      emocao,
      descricao,
      forma_pagamento: formaPagamento,
      impulsivo,
    });
    onClose();
  };

  const steps = [
    // Step 0: Valor
    <motion.div key="valor" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      <h3 className="text-lg font-semibold text-card-foreground">Quanto gastou?</h3>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-muted-foreground">R$</span>
        <input
          type="number"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="0,00"
          className="w-full text-3xl font-bold pl-16 pr-4 py-4 bg-secondary rounded-xl text-card-foreground outline-none focus:ring-2 focus:ring-primary/20"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">Descrição rápida</label>
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex: Supermercado, Uber..."
          className="w-full px-4 py-3 bg-secondary rounded-xl text-sm text-card-foreground outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <button
        onClick={() => valor && setStep(1)}
        disabled={!valor}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium text-sm disabled:opacity-40 transition-opacity"
      >
        Continuar
      </button>
    </motion.div>,

    // Step 1: Categoria + Pagamento
    <motion.div key="categoria" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      <h3 className="text-lg font-semibold text-card-foreground">Categoria</h3>
      <div className="grid grid-cols-4 gap-2">
        {CATEGORIAS_GASTO.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategoria(cat.value)}
            className={`flex flex-col items-center gap-1 p-3 rounded-xl text-xs transition-all ${
              categoria === cat.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-card-foreground'
            }`}
          >
            <span className="text-xl">{cat.icon}</span>
            <span className="font-medium">{cat.label}</span>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">Forma de pagamento</label>
        <div className="flex gap-2 flex-wrap">
          {FORMAS_PAGAMENTO.map((fp) => (
            <button
              key={fp.value}
              onClick={() => setFormaPagamento(fp.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                formaPagamento === fp.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-card-foreground'
              }`}
            >
              {fp.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
        <button
          onClick={() => setImpulsivo(!impulsivo)}
          className={`w-10 h-6 rounded-full transition-all relative ${impulsivo ? 'bg-warning' : 'bg-border'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-card rounded-full transition-all ${impulsivo ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
        <span className="text-xs text-card-foreground">Compra impulsiva?</span>
      </div>
      <button
        onClick={() => categoria && setStep(2)}
        disabled={!categoria}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-medium text-sm disabled:opacity-40 transition-opacity"
      >
        Continuar
      </button>
    </motion.div>,

    // Step 2: Emoção
    <motion.div key="emocao" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
      <h3 className="text-lg font-semibold text-card-foreground">Como você está se sentindo?</h3>
      <div className="grid grid-cols-4 gap-2">
        {EMOCOES.map((em) => (
          <button
            key={em.value}
            onClick={() => setEmocao(em.value)}
            className={`flex flex-col items-center gap-1 p-3 rounded-xl text-xs transition-all ${
              emocao === em.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-card-foreground'
            }`}
          >
            <span className="text-2xl">{em.icon}</span>
            <span className="font-medium">{em.label}</span>
          </button>
        ))}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!emocao}
        className="w-full py-3 bg-success text-success-foreground rounded-xl font-medium text-sm disabled:opacity-40 transition-opacity"
      >
        Registrar Gasto ✓
      </button>
      {impulsivo && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-center text-warning px-4"
        >
          💡 Você marcou como impulsivo. Será que pode esperar 24h antes de decidir?
        </motion.p>
      )}
    </motion.div>,
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-card w-full max-w-md rounded-3xl p-6 relative"
          style={{ boxShadow: 'var(--shadow-float)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>

          <div className="flex gap-1 mb-6">
            {[0, 1, 2].map((s) => (
              <div key={s} className={`h-1 flex-1 rounded-full transition-all ${s <= step ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {steps[step]}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
