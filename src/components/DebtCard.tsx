import { motion } from 'framer-motion';
import { Divida } from '@/types/financial';

interface DebtCardProps {
  divida: Divida;
}

export function DebtCard({ divida }: DebtCardProps) {
  const progresso = Math.round(((divida.parcelas_totais - divida.parcelas_restantes) / divida.parcelas_totais) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="apple-card border-l-4 border-l-warning"
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="text-sm font-semibold text-card-foreground">{divida.tipo}</h4>
          <p className="text-xs text-muted-foreground">
            {divida.parcelas_restantes} de {divida.parcelas_totais} parcelas • {divida.taxa_juros}% a.m.
          </p>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
          divida.prioridade === 'alta' ? 'bg-risk/10 text-risk' : 'bg-warning/10 text-warning'
        }`}>
          {divida.prioridade}
        </span>
      </div>
      <p className="text-lg font-bold text-card-foreground mb-1">
        R$ {divida.valor_atual.toLocaleString('pt-BR')}
      </p>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-warning rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progresso}%` }}
          transition={{ duration: 0.8 }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Parcela: R$ {divida.valor_parcela.toLocaleString('pt-BR')} • {progresso}% pago
      </p>
    </motion.div>
  );
}
