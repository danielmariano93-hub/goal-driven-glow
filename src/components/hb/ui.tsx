import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHASE_LABEL, type DayRow, type Outcome, type Phase } from "@/lib/habits/engine";
import type { DayAggregate, DayState } from "@/lib/habits/aggregate";
import type { HbMode } from "@/lib/habits/api";
import { OUTCOME_CELL } from "@/components/hb/outcomeStyles";

/** Seletor Dinheiro | Hábitos. `hero` = sobre o degradê do Nino; `light` = sobre fundo claro. */
export function ModePill({ current, onChange, tone = "light" }: { current: HbMode; onChange: (m: HbMode) => void; tone?: "hero" | "light" }) {
  const hero = tone === "hero";
  const item = (mode: HbMode, label: string) => {
    const on = current === mode;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(mode)}
        className={cn(
          "min-h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors",
          hero
            ? on ? "bg-white text-[#2A1380]" : "text-white/80 hover:text-white"
            : on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Modo do Nino" className={cn("inline-flex items-center rounded-full p-0.5", hero ? "bg-white/15" : "bg-muted")}>
      {item("money", "Dinheiro")}
      {item("habits", "Hábitos")}
    </div>
  );
}

/** Cabeçalho das telas claras de Hábitos. */
export function PageHeader({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: string; right?: React.ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 pb-3 pt-4">
      <div className="min-w-0">
        {back ? (
          <Link to={back} aria-label="Voltar" className="-ml-2 mb-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        ) : null}
        <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right}
    </header>
  );
}

const PHASE_STYLE: Record<Phase, string> = {
  starting: "bg-muted text-muted-foreground",
  rooting: "bg-warning/20 text-foreground",
  firm: "bg-success/15 text-success",
  maintenance: "bg-primary/10 text-primary",
};

export function PhaseChip({ phase }: { phase: Phase }) {
  return <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium", PHASE_STYLE[phase])}>{PHASE_LABEL[phase]}</span>;
}

/** Barra de força (estimativa) com as duas marcas de faixa. */
export function StrengthBar({ value }: { value: number | null }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div>
      <div className="relative h-2 rounded-full bg-muted" role="img" aria-label={value == null ? "Força ainda sem dados" : `Força do hábito ${pct}%`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        <span className="absolute -top-0.5 left-[33%] h-3 w-0.5 bg-card" aria-hidden="true" />
        <span className="absolute -top-0.5 left-[66%] h-3 w-0.5 bg-card" aria-hidden="true" />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>Começando</span><span>Criando raiz</span><span>Firme</span>
      </div>
    </div>
  );
}

const TICK_COLOR: Record<DayState, string> = {
  full: "#7CF0C4",
  partial: "rgba(124,240,196,.5)",
  none: "rgba(255,255,255,.28)",
  rest: "#FFB020",
  empty: "rgba(255,255,255,.14)",
};

/** Mostrador dos últimos dias (um traço por dia) com o progresso de hoje por dentro. */
export function Dial({ days, done, total }: { days: DayAggregate[]; done: number; total: number }) {
  const ticks = useMemo(() => {
    const n = days.length || 1;
    return days.map((d, i) => {
      const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
      const r1 = d.is_today ? 108 : 112;
      const r2 = d.is_today ? 134 : 128;
      return {
        key: d.date,
        x1: (Math.cos(a) * r1).toFixed(1), y1: (Math.sin(a) * r1).toFixed(1),
        x2: (Math.cos(a) * r2).toFixed(1), y2: (Math.sin(a) * r2).toFixed(1),
        color: d.is_today ? "#FFFFFF" : TICK_COLOR[d.state], width: d.is_today ? 4 : 3,
      };
    });
  }, [days]);
  const C = 578.05;
  const pct = total > 0 ? done / total : 0;
  return (
    <div className="relative mx-auto h-[250px] w-[333px] max-w-full">
      <svg viewBox="0 0 390 292" className="h-full w-full" role="img" aria-label={total > 0 ? `${done} de ${total} hábitos de hoje feitos, e os últimos ${days.length} dias` : `Nenhum hábito previsto hoje; últimos ${days.length} dias`}>
        <g transform="translate(195 146)">
          {ticks.map((t) => <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.color} strokeWidth={t.width} strokeLinecap="round" />)}
          <circle r="92" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="10" />
          <circle r="92" fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90)" className="transition-[stroke-dashoffset] duration-500" />
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-primary-foreground">
        {total > 0 ? (
          <>
            <p className="font-display text-[68px] font-semibold leading-[0.95] tracking-[-0.05em] tabular-nums">{done}<span className="text-[30px] tracking-tight text-white/70">/{total}</span></p>
            <p className="mt-1.5 text-sm font-medium text-white/80">feitos hoje</p>
          </>
        ) : (
          <p className="max-w-[140px] text-center text-sm font-medium leading-5 text-white/80">Nada previsto para hoje</p>
        )}
      </div>
    </div>
  );
}

const DOT: Record<Outcome, string> = {
  done: "bg-success",
  minimum: "bg-success/55",
  rest: "bg-warning",
  missed: "bg-muted-foreground/25",
  unlogged: "border border-muted-foreground/40",
  not_expected: "bg-transparent border border-dashed border-muted-foreground/25",
};

/** Sete pontinhos com os últimos sete dias de um hábito. */
export function Dots({ rows }: { rows: DayRow[] }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {rows.map((r) => <i key={r.date} className={cn("block h-1.5 w-1.5 rounded-full", DOT[r.outcome])} />)}
    </span>
  );
}
