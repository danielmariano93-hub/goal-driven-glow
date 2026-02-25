import { motion } from 'framer-motion';

interface CircularScoreProps {
  value: number;
  label: string;
  size?: number;
  variant?: 'success' | 'warning' | 'risk' | 'primary';
}

export function CircularScore({ value, label, size = 120, variant = 'primary' }: CircularScoreProps) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 100) * circumference;

  const colorMap = {
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    risk: 'hsl(var(--risk))',
    primary: 'hsl(var(--primary))',
  };

  const autoVariant = value >= 70 ? 'success' : value >= 40 ? 'warning' : 'risk';
  const color = colorMap[variant === 'primary' ? autoVariant : variant];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - progress }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="text-xl font-bold text-card-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {value}
          </motion.span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground text-center">{label}</span>
    </div>
  );
}
