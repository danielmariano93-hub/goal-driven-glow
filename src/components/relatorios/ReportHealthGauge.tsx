import { cn } from "@/lib/utils";

interface Props {
  score: number;
  className?: string;
}

function toneOf(score: number) {
  if (score >= 7.5) return { label: "Saudável", color: "text-emerald-600", ring: "stroke-emerald-500" };
  if (score >= 5) return { label: "Atenção", color: "text-amber-600", ring: "stroke-amber-500" };
  return { label: "Risco", color: "text-rose-600", ring: "stroke-rose-500" };
}

/** Medidor circular da nota de saúde financeira (0–10). */
export default function ReportHealthGauge({ score, className }: Props) {
  const clamped = Math.max(0, Math.min(10, Number(score || 0)));
  const tone = toneOf(clamped);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 10);

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} className="fill-none stroke-muted" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            className={cn("fill-none transition-all", tone.ring)}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn("font-display text-xl font-bold", tone.color)}>
            {clamped.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          </span>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Saúde financeira
        </p>
        <p className={cn("text-lg font-semibold", tone.color)}>{tone.label}</p>
        <p className="text-xs text-muted-foreground">Escala de 0 a 10 no período</p>
      </div>
    </div>
  );
}
