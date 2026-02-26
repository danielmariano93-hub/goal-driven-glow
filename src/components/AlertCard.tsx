import type { Alerta } from '@/types/financial';
import { AlertTriangle, TrendingDown, Target, CreditCard, Zap } from 'lucide-react';

const ICON_MAP: Record<Alerta['tipo'], typeof AlertTriangle> = {
  renda_comprometida: TrendingDown,
  meta_atrasada: Target,
  juros_alto: CreditCard,
  impulsividade: Zap,
  patrimonio_queda: TrendingDown,
};

export function AlertCard({ alerta }: { alerta: Alerta }) {
  const Icon = ICON_MAP[alerta.tipo] || AlertTriangle;
  const bgColor = alerta.severidade === 'alta' ? 'bg-destructive/8' : 'bg-warning/8';
  const iconColor = alerta.severidade === 'alta' ? 'text-destructive' : 'text-warning';

  return (
    <div className={`${bgColor} rounded-xl p-3 flex gap-3 items-start`}>
      <Icon size={16} className={`${iconColor} mt-0.5 shrink-0`} />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{alerta.titulo}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{alerta.descricao}</p>
      </div>
    </div>
  );
}
