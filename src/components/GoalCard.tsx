import { motion } from 'framer-motion';
import { Meta } from '@/types/financial';

interface GoalCardProps {
  meta: Meta;
}

export function GoalCard({ meta }: GoalCardProps) {
  const progresso = Math.round((meta.valor_atual / meta.valor_objetivo) * 100);
  const restante = meta.valor_objetivo - meta.valor_atual;

  const prioridadeColors = {
    alta: 'bg-risk/10 text-risk',
    media: 'bg-warning/10 text-warning',
    baixa: 'bg-primary/10 text-primary',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="apple-card"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm text-card-foreground">{meta.nome}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{meta.motivacao_emocional}</p>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${prioridadeColors[meta.prioridade]}`}>
          {meta.prioridade}
        </span>
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">
            R$ {meta.valor_atual.toLocaleString('pt-BR')}
          </span>
          <span className="font-medium text-card-foreground">{progresso}%</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-success rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progresso}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Falta: R$ {restante.toLocaleString('pt-BR')}</span>
        <span>Prazo: {new Date(meta.prazo).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>
      </div>
    </motion.div>
  );
}
