import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, Compass, Eye, History, Minus, Sparkles, UserRound } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import {
  DIMENSION_ACTION,
  MONEY_IMPACT_MIN_DAYS,
  type BehaviorVerdict,
  type HabitDiscovery,
  type DimensionChange,
  type HabitSeriesPoint,
  type MoneyImpact,
} from "@/lib/behavioral/behaviorEvolution";
import type { BehaviorDimensionKey } from "@/lib/behavioral/client";

// Blocos da página Emocional: veredito, o que mudou e por quê, evolução dos
// hábitos e impacto no dinheiro. Status sempre com ícone + texto (não só cor).

const fmt = (v: number) => v.toFixed(1).replace(".", ",");
const dateBR = (iso: string) => iso.split("-").reverse().join("/");

/** Aviso acessível de histórico reconstruído (ícone + texto, nunca só cor). */
export function ReconstructedHistoryNote({ weeks, compact = false }: { weeks?: number; compact?: boolean }) {
  return (
    <div role="note" aria-label="Histórico reconstruído (parcial)" className="mt-3 flex items-start gap-2 rounded-2xl border border-border bg-secondary/40 p-3">
      <History size={14} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 break-words text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Histórico reconstruído (parcial)</strong>
        {weeks ? ` · ${weeks} semana${weeks === 1 ? "" : "s"}` : ""}
        {compact
          ? ". A base de comparação vem dessa reconstrução."
          : ". Para semanas antigas, o Nino só reconstruiu as evidências que existiam na época (check-ins, metas, dívidas e aportes). Leituras novas já são completas."}
      </p>
    </div>
  );
}

const VERDICT_STYLE = {
  better: { wrap: "border-success/30 bg-success/5", chip: "bg-success/15 text-success", label: "Melhorando", Icon: ArrowUp },
  worse: { wrap: "border-brand-coral/30 bg-brand-coral/5", chip: "bg-brand-coral/15 text-brand-coral", label: "Piorando", Icon: ArrowDown },
  same: { wrap: "border-primary/20 bg-primary/5", chip: "bg-primary/10 text-primary", label: "Parecido", Icon: Minus },
  insufficient: { wrap: "border-border bg-card", chip: "bg-secondary text-muted-foreground", label: "Em observação", Icon: Sparkles },
} as const;

export function BehaviorVerdictCard({ verdict, overall, moodTrend14, baselineReconstructed = false }: { verdict: BehaviorVerdict; overall: number | null; moodTrend14: number | null; baselineReconstructed?: boolean }) {
  const style = VERDICT_STYLE[verdict.kind];
  const Icon = style.Icon;
  return (
    <section aria-label="Como estão seus hábitos" className={`rounded-[26px] border p-5 shadow-card ${style.wrap}`}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${style.chip}`}>
        <Icon size={12} aria-hidden /> {style.label}
      </span>
      <h2 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight">{verdict.headline}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{verdict.summary}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-card/80 p-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Nota do Nino</dt>
          <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">{overall == null ? "—" : fmt(overall)}</dd>
          {verdict.overallDelta != null && Math.abs(verdict.overallDelta) >= 0.1 ? (
            <dd className={`text-[10px] font-semibold ${verdict.overallDelta > 0 ? "text-success" : "text-brand-coral"}`}>
              {verdict.overallDelta > 0 ? "+" : "−"}{fmt(Math.abs(verdict.overallDelta))} desde {verdict.baselineDate ? dateBR(verdict.baselineDate) : ""}
            </dd>
          ) : null}
        </div>
        <div className="rounded-2xl bg-card/80 p-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Dimensões</dt>
          <dd className="mt-0.5 text-[12px] font-semibold tabular-nums">
            <span className="text-success">▲ {verdict.improved}</span> · <span className="text-brand-coral">▼ {verdict.worsened}</span> · = {verdict.stable}
          </dd>
        </div>
        <div className="rounded-2xl bg-card/80 p-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Humor 14d</dt>
          <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">{moodTrend14 == null ? "—" : `${moodTrend14 > 0 ? "+" : moodTrend14 < 0 ? "−" : ""}${fmt(Math.abs(moodTrend14))}`}</dd>
        </div>
      </dl>
      {baselineReconstructed ? <ReconstructedHistoryNote compact /> : null}
    </section>
  );
}

function ChangeChip({ c }: { c: DimensionChange }) {
  if (c.notComparable) return <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">método novo</span>;
  if (c.direction === "new") return <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">1ª leitura</span>;
  const up = c.direction === "better";
  const same = c.direction === "same";
  const Icon = same ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${same ? "bg-secondary text-muted-foreground" : up ? "bg-success/15 text-success" : "bg-brand-coral/15 text-brand-coral"}`}>
      <Icon size={11} aria-hidden />
      {same ? "estável" : fmt(Math.abs(c.delta ?? 0))}
      <span className="sr-only">{same ? "" : up ? " a mais" : " a menos"} que na base de comparação</span>
    </span>
  );
}

const CONF = { high: "confiança alta", medium: "confiança média", low: "confiança baixa" } as const;

/** O que melhorou ou piorou e o porquê, ordenado pelo que mais mudou. */
export function WhatChanged({ changes, hasBaseline }: { changes: DimensionChange[]; hasBaseline: boolean }) {
  const [open, setOpen] = useState<BehaviorDimensionKey | null>(null);
  // "#dimensao-<chave>" (vindo da descoberta) abre a dimensão e rola até ela.
  useEffect(() => {
    const openFromHash = () => {
      const match = /^#dimensao-(\w+)$/.exec(window.location.hash);
      if (!match) return;
      setOpen(match[1] as BehaviorDimensionKey);
      window.setTimeout(() => document.getElementById(`dimensao-${match[1]}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  const ordered = [...changes].filter((c) => c.score != null).sort((a, b) => {
    if (hasBaseline) return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
    return (a.score ?? 0) - (b.score ?? 0);
  });
  const empty = changes.filter((c) => c.score == null);
  return (
    <section aria-label="O que mudou e por quê" className="rounded-[26px] border border-border bg-card p-4 shadow-card sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">O que mudou e por quê</p>
      <h2 className="mt-1 font-display text-xl font-bold tracking-tight">{hasBaseline ? "Do que mais variou ao que menos variou" : "Do ponto mais fraco ao mais forte"}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Toque numa dimensão para ver o que o Nino observou, o que a nota mede, o que ainda falta saber e o peso de cada componente. {hasBaseline ? "" : "Sem leitura anterior ainda, a ordem é pela nota."}
      </p>
      <ul className="mt-3 divide-y divide-border">
        {ordered.map((c) => {
          const isOpen = open === c.key;
          const action = DIMENSION_ACTION[c.key];
          const showAction = c.direction === "worse" || (!hasBaseline && (c.score ?? 10) < 5);
          return (
            <li key={c.key} id={`dimensao-${c.key}`} className="scroll-mt-24">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.key)} className="flex w-full items-center gap-3 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{c.label}</span>
                    <span className="shrink-0 font-display text-lg font-bold tabular-nums">{fmt(c.score!)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{c.previous != null ? `antes ${fmt(c.previous)} · ` : ""}{CONF[c.confidence]}</span>
                    <ChangeChip c={c} />
                  </span>
                </span>
                <ChevronDown size={14} aria-hidden className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen ? (
                <div className="mb-3 space-y-2 rounded-2xl bg-secondary/40 p-3">
                  <p className="text-[12px] leading-relaxed">{c.why}</p>
                  {c.evidence ? (
                    <p className="text-[11px] leading-relaxed text-muted-foreground"><strong className="text-foreground">O que o Nino observou.</strong> {c.evidence}</p>
                  ) : null}
                  <p className="text-[11px] leading-relaxed text-muted-foreground"><strong className="text-foreground">O que essa nota mede.</strong> {c.scope}</p>
                  {c.factors.length ? (
                    <ul className="space-y-1.5">
                      {c.factors.map((f) => (
                        <li key={f.key} className="text-[11px]">
                          <span className="flex items-baseline justify-between gap-2">
                            <span>{f.label}{f.weight != null ? <span className="text-muted-foreground"> · peso {Math.round(f.weight * 100)}%</span> : null}</span>
                            <span className="shrink-0 tabular-nums font-semibold">
                              {f.value == null ? "sem dado" : fmt(f.value)}
                              {f.delta != null && Math.abs(f.delta) >= 0.1 ? <span className={f.delta > 0 ? " text-success" : " text-brand-coral"}> {f.delta > 0 ? "▲" : "▼"} {fmt(Math.abs(f.delta))}</span> : null}
                            </span>
                          </span>
                          <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                            <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(0, Math.min(10, f.value ?? 0)) * 10}%` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {c.missing.length ? (
                    <p className="text-[11px] leading-relaxed text-muted-foreground"><strong className="text-foreground">O que ainda falta saber.</strong> {c.missing.join("; ")}.</p>
                  ) : null}
                  {showAction ? (
                    action.to.startsWith("#")
                      ? <a href={action.to} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">{action.label} <ArrowRight size={13} aria-hidden /></a>
                      : <Link to={action.to} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">{action.label} <ArrowRight size={13} aria-hidden /></Link>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {empty.length ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Ainda sem dados para medir: {empty.map((c) => c.label.toLowerCase()).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}

function Sparkline({ points }: { points: HabitSeriesPoint[] }) {
  const W = 120;
  const H = 32;
  const valid = points.filter((p) => p.score != null);
  if (valid.length < 2) {
    return <span className="text-[10px] text-muted-foreground">{valid.length === 1 ? "1 leitura" : "sem leitura"}</span>;
  }
  const step = W / Math.max(1, points.length - 1);
  const y = (v: number) => H - 3 - (v / 10) * (H - 6);
  const path = points.map((p, i) => (p.score == null ? null : `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(p.score).toFixed(1)}`)).filter(Boolean).join(" ");
  const last = valid[valid.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-16" aria-hidden>
      <path d={path} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points.lastIndexOf(last) * step} cy={y(last.score!)} r={3} className="fill-primary" />
    </svg>
  );
}

/** Evolução: nota por semana de cada dimensão, com mínimo, máximo e variação. */
export function HabitTrend({ series, changes, weeks, reconstructedWeeks = 0 }: { series: Record<BehaviorDimensionKey, HabitSeriesPoint[]>; changes: DimensionChange[]; weeks: number; reconstructedWeeks?: number }) {
  return (
    <section aria-label="Evolução dos hábitos" className="rounded-[26px] border border-border bg-card p-4 shadow-card sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Evolução dos hábitos</p>
      <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Semana a semana</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {weeks >= 2
          ? `${weeks} semanas de leitura guardadas. A linha ganha corpo a cada semana.`
          : "O Nino começou a guardar a leitura agora. A partir da próxima semana a linha de cada hábito aparece aqui."}
      </p>
      {reconstructedWeeks > 0 ? <ReconstructedHistoryNote weeks={reconstructedWeeks} /> : null}
      <ul className="mt-3 divide-y divide-border">
        {changes.filter((c) => c.score != null).map((c) => {
          const pts = series[c.key] ?? [];
          const scores = pts.map((p) => p.score).filter((v): v is number => v != null);
          return (
            <li key={c.key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">{c.label}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {scores.length >= 2 ? `mín ${fmt(Math.min(...scores))} · máx ${fmt(Math.max(...scores))}` : `agora ${fmt(c.score!)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2"><Sparkline points={pts} /><ChangeChip c={c} /></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Gasto associado ao estado emocional, por janela de horário de cada check-in. */
export function MoneyImpactCard({ impact }: { impact: MoneyImpact }) {
  return (
    <section aria-label="Impacto no dinheiro" className="rounded-[26px] border border-border bg-card p-4 shadow-card sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Impacto no dinheiro</p>
      <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Emoção e gasto andam juntos?</h2>
      {impact.sufficient ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-brand-coral/20 bg-brand-coral/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Momento sensível</p>
              <p className="mt-0.5 font-display text-xl font-bold tabular-nums">{formatBRL(impact.sensitiveAvg)}</p>
              <p className="text-[10px] text-muted-foreground">gasto médio por check-in</p>
            </div>
            <div className="rounded-2xl border border-success/20 bg-success/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Momento tranquilo</p>
              <p className="mt-0.5 font-display text-xl font-bold tabular-nums">{formatBRL(impact.calmAvg)}</p>
              <p className="text-[10px] text-muted-foreground">gasto médio por check-in</p>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed">
            {impact.extraPerDay > 0
              ? <>Perto dos {impact.sensitiveDays} check-ins sensíveis, o gasto médio foi <strong>{formatBRL(impact.extraPerDay)} maior por momento</strong> ({Math.round(impact.upliftPct)}% acima do que nos momentos tranquilos).</>
              : <>Seus momentos sensíveis não aparecem junto de gasto maior: a média é {formatBRL(Math.abs(impact.extraPerDay))} menor por momento.</>}
          </p>
          <p className="mt-2 rounded-2xl bg-secondary/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Um sinal para investigar, não uma conta do que se perdeu.</strong> É associação, não causa. A diferença pode vir do dia da semana, de compras necessárias, de gastos atípicos ou de você registrar o check-in depois de gastar. Baseado em {impact.pairedDays} check-ins, contando gastos de 3h antes a 12h depois de cada um (cada gasto entra uma vez só).
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-2xl bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
          Há {impact.pairedDays} check-in{impact.pairedDays === 1 ? "" : "s"} com horário de gasto observável. Com {MONEY_IMPACT_MIN_DAYS}, incluindo momentos sensíveis e tranquilos, o Nino mostra aqui quanto você costuma gastar perto de cada estado — associação, não causa.
        </p>
      )}
    </section>
  );
}

const DISCOVERY_STYLE: Record<HabitDiscovery["kind"], { wrap: string; chip: string; label: string }> = {
  perception_gap: { wrap: "border-primary/25 bg-primary/5", chip: "bg-primary/10 text-primary", label: "Uma descoberta sobre você" },
  improvement: { wrap: "border-success/30 bg-success/5", chip: "bg-success/15 text-success", label: "Uma mudança boa" },
  attention: { wrap: "border-brand-coral/30 bg-brand-coral/5", chip: "bg-brand-coral/15 text-brand-coral", label: "Vale atenção" },
  room_to_grow: { wrap: "border-primary/20 bg-card", chip: "bg-primary/10 text-primary", label: "Onde há espaço" },
  getting_started: { wrap: "border-border bg-card", chip: "bg-secondary text-muted-foreground", label: "Em observação" },
};

/** O que o Nino descobriu sobre a pessoa: uma observação, a evidência e um próximo passo. */
export function HabitDiscoveryCard({ discovery }: { discovery: HabitDiscovery }) {
  const style = DISCOVERY_STYLE[discovery.kind];
  const action = discovery.action;
  return (
    <section aria-label="Uma descoberta sobre você" className={`rounded-[26px] border p-5 shadow-card ${style.wrap}`}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${style.chip}`}>
        <Compass size={12} aria-hidden /> {style.label}
      </span>
      <h2 className="mt-2 font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">{discovery.title}</h2>
      {discovery.kind === "perception_gap" && discovery.self != null && discovery.observed != null ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl bg-card/80 p-2.5">
            <dt className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground"><UserRound size={11} aria-hidden /> Como você se vê</dt>
            <dd className="mt-0.5 font-display text-2xl font-bold tabular-nums">{fmt(discovery.self)}</dd>
          </div>
          <div className="rounded-2xl bg-card/80 p-2.5">
            <dt className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground"><Eye size={11} aria-hidden /> Sinais do Nino</dt>
            <dd className="mt-0.5 font-display text-2xl font-bold tabular-nums">{fmt(discovery.observed)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{discovery.body}</p>
      {action ? (
        action.to.startsWith("#")
          ? <a href={action.to} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">{action.label} <ArrowRight size={14} aria-hidden /></a>
          : <Link to={action.to} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">{action.label} <ArrowRight size={14} aria-hidden /></Link>
      ) : null}
    </section>
  );
}

/** Estado da comparação em uma linha (o veredito deixou de abrir a página). */
export function VerdictStrip({ verdict, baselineReconstructed = false }: { verdict: BehaviorVerdict; baselineReconstructed?: boolean }) {
  const style = VERDICT_STYLE[verdict.kind];
  const Icon = style.Icon;
  return (
    <div className="rounded-[20px] border border-border bg-card px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${style.chip}`}><Icon size={11} aria-hidden /> {style.label}</span>
        {verdict.headline}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{verdict.summary}</p>
      {baselineReconstructed ? <ReconstructedHistoryNote compact /> : null}
    </div>
  );
}
