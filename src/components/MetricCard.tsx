import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  variant?: 'default' | 'success' | 'warning' | 'risk';
}

const variantStyles = {
  default: '',
  success: 'border-l-4 border-l-success',
  warning: 'border-l-4 border-l-warning',
  risk: 'border-l-4 border-l-risk',
};

export function MetricCard({ title, value, subtitle, icon, trend, trendValue, variant = 'default' }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`apple-card ${variantStyles[variant]}`}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-card-foreground tracking-tight">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {trend && trendValue && (
          <span className={`text-xs font-medium ${trend === 'up' ? 'text-success' : trend === 'down' ? 'text-risk' : 'text-muted-foreground'}`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
          </span>
        )}
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
    </motion.div>
  );
}
