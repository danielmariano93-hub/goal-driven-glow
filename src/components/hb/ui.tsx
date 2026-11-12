import { useEffect, useMemo, useState } from "react";
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
          "min-h-9 rounded-full px-3.5 text-[12px] font-medium transition-colors",
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
        <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right}
    </header>
  );
}

const PHASE_STYLE: Record<Phase, string> = {
  starting: "bg-muted text-muted-foreground",
  rooting: "bg-primary/10 text-primary",
  firm: "bg-primary/15 text-primary",
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
  full: "#E4DAFF",
  partial: "rgba(228,218,255,.5)",
  none: "rgba(255,255,255,.26)",
  rest: "rgba(196,176,255,.75)",
  empty: "rgba(255,255,255,.14)",
};

const WEEKDAY_ABBR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY_STATE_TEXT: Record<DayState, string> = { full: "dia completo", partial: "dia parcial", none: "sem registro", rest: "folga", empty: "nada previsto" };

function dayLabel(d: DayAggregate): string {
  if (d.is_today) return "Hoje";
  const wd = WEEKDAY_ABBR[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${Number(d.date.slice(8, 10))} ${MONTH_ABBR[Number(d.date.slice(5, 7)) - 1]}`;
}

/**
 * Mostrador dos últimos dias (um traço por dia) com o progresso de hoje por dentro.
 * Movimento discreto: o anel enche ao abrir e a cada marcação; os traços entram em sequência; tocar num traço mostra aquele dia
 * por alguns segundos. Quem pede "reduzir movimento" no aparelho vê tudo direto, sem animação.
 */
export function Dial({ days, done, total, withWeekly = false }: { days: DayAggregate[]; done: number; total: number; /** Com hábito semanal na conta, o rótulo diz "em dia" em vez de "feitos". */ withWeekly?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const pct = total > 0 ? done / total : 0;
  // O anel parte de zero ao montar e anda até o valor (a transição CSS faz o resto).
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  useEffect(() => {
    if (!selected) return;
    const id = window.setTimeout(() => setSelected(null), 4000);
    return () => window.clearTimeout(id);
  }, [selected]);
  const ticks = useMemo(() => {
    const n = days.length || 1;
    return days.map((d, i) => {
      const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
      const r1 = d.is_today ? 108 : 112;
      const r2 = d.is_today ? 134 : 128;
      return {
        key: d.date, day: d, i,
        x1: (Math.cos(a) * r1).toFixed(1), y1: (Math.sin(a) * r1).toFixed(1),
        x2: (Math.cos(a) * r2).toFixed(1), y2: (Math.sin(a) * r2).toFixed(1),
        color: d.is_today ? "#FFFFFF" : TICK_COLOR[d.state], width: d.is_today ? 4 : 3,
      };
    });
  }, [days]);
  const C = 578.05;
  const picked = selected ? days.find((d) => d.date === selected) ?? null : null;
  return (
    <div className="relative mx-auto h-[206px] w-[274px] max-w-full">
      <svg viewBox="0 0 390 292" className="h-full w-full" role="img" aria-label={total > 0 ? `${done} de ${total} hábitos de hoje feitos, e os últimos ${days.length} dias` : `Nenhum hábito previsto hoje; últimos ${days.length} dias`}>
        <g transform="translate(195 146)">
          {ticks.map((t) => (
            <line
              key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeLinecap="round"
              stroke={selected === t.key ? "#FFFFFF" : t.color} strokeWidth={selected === t.key ? 6 : t.width}
              className="transition-[stroke-width,stroke] duration-200 motion-safe:animate-in motion-safe:fade-in"
              style={{ animationDelay: `${t.i * 25}ms`, animationDuration: "450ms", animationFillMode: "backwards" }}
            />
          ))}
          <circle r="92" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="10" />
          <circle r="92" fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown)} transform="rotate(-90)" className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none" />
        </g>
      </svg>
      {/* Camada de toque: áreas largas sobre cada traço (o traço fino sozinho é difícil de acertar com o dedo). */}
      <svg viewBox="0 0 390 292" className="absolute inset-0 h-full w-full" role="group" aria-label="Dias recentes">
        <g transform="translate(195 146)">
          {ticks.map((t) => (
            <line
              key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="transparent" strokeWidth={30} strokeLinecap="round"
              style={{ pointerEvents: "stroke", cursor: "pointer", outline: "none" }}
              role="button" tabIndex={0} aria-pressed={selected === t.key}
              aria-label={`${dayLabel(t.day)}: ${DAY_STATE_TEXT[t.day.state]}`}
              onClick={() => setSelected((cur) => (cur === t.key ? null : t.key))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected((cur) => (cur === t.key ? null : t.key)); } }}
            />
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-primary-foreground">
        {picked ? (
          <div key={picked.date} className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none" aria-live="polite">
            <p className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em]">{dayLabel(picked)}</p>
            <p className="mt-1.5 text-sm font-medium text-white/80">{DAY_STATE_TEXT[picked.state]}</p>
          </div>
        ) : total > 0 ? (
          <div key={`${done}/${total}`} className="flex flex-col items-center animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            <p className="font-display text-[48px] font-semibold leading-none tracking-[-0.05em] tabular-nums">{done}<span className="text-[20px] tracking-tight text-white/70">/{total}</span></p>
            <p className="mt-1.5 text-sm font-medium text-white/80">{withWeekly ? (done === total ? "tudo em dia" : "em dia hoje") : done === total ? "tudo feito hoje" : "feitos hoje"}</p>
          </div>
        ) : (
          <p className="max-w-[140px] text-center text-sm font-medium leading-5 text-white/80">Nada previsto para hoje</p>
        )}
      </div>
    </div>
  );
}

const DOT: Record<Outcome, string> = {
  done: "bg-primary",
  minimum: "bg-primary/45",
  rest: "bg-primary/20",
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

/** Anel da força do hábito (estimativa) sobre o degradê do Nino. Sem dados: anel vazio e traço. */
export function StrengthRing({ value }: { value: number | null }) {
  const R = 64;
  const C = 2 * Math.PI * R;
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className="relative mx-auto h-[168px] w-[168px]" role="img" aria-label={value == null ? "Força ainda sem dados" : `Força do hábito ${pct}%`}>
      <svg viewBox="0 0 168 168" className="h-full w-full -rotate-90">
        <circle cx="84" cy="84" r={R} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="12" />
        <circle cx="84" cy="84" r={R} fill="none" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (value ?? 0))} className="transition-[stroke-dashoffset] duration-700 ease-out" />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-primary-foreground">
        <p className="font-display text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{value == null ? "-" : pct}{value == null ? null : <span className="text-[20px] text-white/70">%</span>}</p>
        <p className="mt-1 text-[12px] text-white/75">força estimada</p>
      </div>
    </div>
  );
}
