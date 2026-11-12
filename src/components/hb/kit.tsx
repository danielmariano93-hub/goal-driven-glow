import { Activity, Brain, ChevronRight, CircleDot, Moon, Sun, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HbArea } from "@/lib/habits/api";
import { HabitIcon } from "@/components/hb/icons";
import { habitIconKey } from "@/lib/habits/catalog";

/** Primitivos visuais do lado Hábitos: um jeito só de fazer cartão, rótulo e ícone de área. */

const AREA_ICON: Record<HbArea, typeof Activity> = { body: Activity, mind: Brain, routine: Sun, money: Wallet, other: CircleDot };
const SLEEP_SLUGS = /dormir|sono/i;

/** Ícone de área em um quadrado suave. É a única cor das listas: o destaque fica no que importa. */
export function AreaTile({ area, title, size = 44, onDark = false }: { area: HbArea; title?: string; size?: number; onDark?: boolean }) {
  const Icon = title && SLEEP_SLUGS.test(title) ? Moon : AREA_ICON[area] ?? CircleDot;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl", onDark ? "bg-white/15 text-white" : "bg-primary/10 text-primary")} style={{ width: size, height: size }} aria-hidden="true">
      <Icon width={size * 0.45} height={size * 0.45} strokeWidth={1.75} />
    </span>
  );
}

/** Ícone do hábito (pelo nome e pela forma de medir) em um quadrado suave. */
export function HabitTile({ title, form, area, size = 44, onDark = false }: { title: string; form: string; area: HbArea; size?: number; onDark?: boolean }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl", onDark ? "bg-white/15 text-white" : "bg-primary/10 text-primary")} style={{ width: size, height: size }} aria-hidden="true">
      <HabitIcon name={habitIconKey(title, form, area)} size={Math.round(size * 0.45)} />
    </span>
  );
}

/** Rótulo de seção: frase normal, discreto. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mb-2 mt-7 px-1 text-[12px] font-medium text-muted-foreground", className)}>{children}</h2>;
}

/** Linha de lista tocável: ícone, título, apoio e seta. */
export function RowCard({ lead, title, hint, trailing, className }: { lead?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-3.5 shadow-card transition-colors hover:bg-muted/50", className)}>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14px] font-semibold leading-5 tracking-[-0.01em]">{title}</span>
        {hint ? <span className="mt-0.5 block text-[12px] leading-[18px] text-muted-foreground">{hint}</span> : null}
      </span>
      {trailing ?? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
    </span>
  );
}

/** Barra de passos de um fluxo curto. */
export function Steps({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} aria-label={`Passo ${current + 1} de ${total}`}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= current ? "bg-primary" : "bg-muted")} />)}
    </div>
  );
}

/** Trilha até o próximo marco: de onde a pessoa veio, onde está e quanto falta. */
export function MilestoneTrack({ days, milestones }: { days: number; milestones: readonly number[] }) {
  const prev = [...milestones].reverse().find((m) => m <= days) ?? 0;
  const next = milestones.find((m) => m > days) ?? null;
  const pct = next == null ? 100 : Math.round(((days - prev) / (next - prev)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px] tabular-nums">
        <span className="text-muted-foreground">{prev} {prev === 1 ? "dia" : "dias"}</span>
        <span className="font-medium">{next == null ? "Todos os marcos" : `${next} dias`}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Caminho até o próximo marco">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">{next == null ? "Você passou de 1 ano. Isso é seu." : `Faltam ${next - days} ${next - days === 1 ? "dia" : "dias"} para o próximo marco.`}</p>
    </div>
  );
}

/** Ilustração da tela vazia: sete dias subindo como degraus, o último já feito. Só o motivo dos sete pontinhos do Nino Hábitos. */
export function WeekSteps({ className }: { className?: string }) {
  const dots = [0, 1, 2, 3, 4, 5, 6];
  return (
    <svg viewBox="0 0 280 92" className={cn("h-auto w-full max-w-[280px]", className)} role="img" aria-label="Sete dias, um passo de cada vez">
      <line x1="14" y1="78" x2="266" y2="78" stroke="rgba(255,255,255,.18)" strokeWidth="2" strokeLinecap="round" />
      {dots.map((i) => {
        const x = 20 + i * 40;
        const y = 70 - i * 9;
        const last = i === 6;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={last ? 12 : 9} fill={last ? "#FFFFFF" : "none"} stroke={last ? "none" : "rgba(255,255,255,.55)"} strokeWidth="2" opacity={last ? 1 : 0.35 + i * 0.1} />
            {last ? <path d={`M${x - 5} ${y} l3.5 3.5 l6.5 -7`} fill="none" stroke="#3C1B78" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </g>
        );
      })}
    </svg>
  );
}
