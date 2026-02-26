interface Props {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export function ScoreRing({ value, max = 100, size = 80, strokeWidth = 6, label }: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct);

  const color = value >= 70 ? 'hsl(var(--success))' : value >= 40 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-sm font-bold text-foreground">{value}</span>
      </div>
      {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
    </div>
  );
}
