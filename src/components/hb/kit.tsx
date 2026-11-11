import { Activity, Brain, ChevronRight, CircleDot, Moon, Sun, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HbArea } from "@/lib/habits/api";

/** Primitivos visuais do lado Hábitos: um jeito só de fazer cartão, rótulo e ícone de área. */

const AREA_ICON: Record<HbArea, typeof Activity> = { body: Activity, mind: Brain, routine: Sun, money: Wallet, other: CircleDot };
const SLEEP_SLUGS = /dormir|sono/i;

/** Ícone de área em um quadrado suave. É a única cor das listas: o destaque fica no que importa. */
export function AreaTile({ area, title, size = 44 }: { area: HbArea; title?: string; size?: number }) {
  const Icon = title && SLEEP_SLUGS.test(title) ? Moon : AREA_ICON[area] ?? CircleDot;
  return (
    <span className="grid shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" style={{ width: size, height: size }} aria-hidden="true">
      <Icon width={size * 0.45} height={size * 0.45} strokeWidth={1.75} />
    </span>
  );
}

/** Rótulo de seção: frase normal, discreto. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mb-2 mt-7 px-1 text-[13px] font-medium text-muted-foreground", className)}>{children}</h2>;
}

/** Linha de lista tocável: ícone, título, apoio e seta. */
export function RowCard({ lead, title, hint, trailing, className }: { lead?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-3.5 shadow-card transition-colors hover:bg-muted/50", className)}>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[16px] font-semibold leading-5 tracking-[-0.01em]">{title}</span>
        {hint ? <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">{hint}</span> : null}
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
