import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssessmentDialog } from "@/components/behavioral/AssessmentDialog";
import { DimensionPanel, type FeedbackAnswer } from "@/components/habits/DimensionPanel";
import { BEHAVIOR_DIMENSIONS, type BehaviorDimensionKey, type ObservedBehaviorProfile } from "@/lib/engine/behaviorDimensions";
import type { BehaviorFeedback } from "@/lib/engine/behaviorEvolution";
import type { AssessmentCycle, ExtendedBehavioralAssessment } from "@/lib/behavioral/mapCycle";

const fmt = (n: number) => n.toFixed(1).replace(".", ",");
const CX = 180, CY = 150, R = 88;

function point(index: number, value: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / BEHAVIOR_DIMENSIONS.length;
  const r = (R * value) / 10;
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle), angle };
}

/**
 * Roda v2: duas séries por padrão (Você e Nino observa). Dimensão sem leitura confiável
 * NÃO vira 0: aparece como anel vazado na borda e o contorno do Nino só liga pontos
 * vizinhos que realmente têm nota. A terceira série (histórico) só entra sob demanda.
 */
export function HabitsWheel({
  selected, onSelect, weighsFor, onWeighs, onClearWeighs, latest, observed, cycle, onSaveMap, saving, baseline, notComparable, feedback, feedbackBusy, onAnswer, onRemoveFeedback,
}: {
  /** Respostas "o que mais pesa" por dimensão. */
  weighsFor: (key: BehaviorDimensionKey) => string[] | null;
  onWeighs: (key: BehaviorDimensionKey, keys: string[]) => void | Promise<void>;
  onClearWeighs: (key: BehaviorDimensionKey) => void | Promise<void>;
  selected: BehaviorDimensionKey | null;
  onSelect: (key: BehaviorDimensionKey | null) => void;
  latest: ExtendedBehavioralAssessment | null;
  observed: ObservedBehaviorProfile;
  cycle: AssessmentCycle;
  onSaveMap: (scores: Record<BehaviorDimensionKey, number>) => Promise<void>;
  saving: boolean;
  baseline: { date: string; scores: Partial<Record<BehaviorDimensionKey, number | null>> } | null;
  notComparable: ReadonlySet<BehaviorDimensionKey>;
  feedback: Partial<Record<BehaviorDimensionKey, BehaviorFeedback>>;
  feedbackBusy: boolean;
  onAnswer: (key: BehaviorDimensionKey, answer: FeedbackAnswer) => void | Promise<void>;
  onRemoveFeedback: (key: BehaviorDimensionKey) => void | Promise<void>;
}) {
  const [showEvolution, setShowEvolution] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const rows = useMemo(() => BEHAVIOR_DIMENSIONS.map((d, i) => {
    const dim = observed.dimensions[d.key];
    const self = latest?.scores?.[d.key] != null ? Number(latest.scores[d.key]) : null;
    return { ...d, i, dim, self, nino: dim?.state === "partial" || dim?.state === "none" ? null : dim?.score ?? null };
  }), [observed, latest]);

  const selfPath = latest ? rows.map((r, i) => { const p = point(i, r.self ?? 0); return `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ") + " Z" : "";
  const ninoSegments = rows.flatMap((r, i) => {
    const next = rows[(i + 1) % rows.length];
    if (r.nino == null || next.nino == null || rows.filter((x) => x.nino != null).length < 3) return [];
    const a = point(i, r.nino), b = point((i + 1) % rows.length, next.nino);
    return [`M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`];
  });
  const beforePath = showEvolution && baseline
    ? rows.map((r, i) => baseline.scores[r.key] == null ? null : point(i, baseline.scores[r.key] as number)).map((p, i) => (p ? `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}` : "")).join(" ")
    : "";
  const withScore = rows.filter((r) => r.nino != null).length;

  return (
    <section aria-label="Roda financeira comportamental" className="rounded-[26px] border border-border bg-card p-4 shadow-card sm:p-5">
      <h2 className="font-display text-xl font-bold tracking-tight">Você e o que o Nino observa</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {latest ? "Toque numa dimensão para ver o porquê" : "Responda o mapa para comparar os dois olhares"} · {withScore} de 8 com leitura confiável
      </p>

      <svg viewBox="0 0 360 300" role="img" aria-label="Roda com as oito dimensões" className="mx-auto mt-2 block w-full max-w-[380px]">
        {[2, 4, 6, 8, 10].map((lv) => (
          <polygon key={lv} points={rows.map((_, i) => { const p = point(i, lv); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ")} fill="none" stroke="hsl(var(--border))" strokeWidth={lv === 10 ? 1.2 : 0.7} />
        ))}
        {rows.map((r, i) => { const p = point(i, 10); return <line key={r.key} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="hsl(var(--border))" strokeWidth={0.7} />; })}
        {latest ? <path d={selfPath} fill="hsl(var(--primary))" fillOpacity={0.14} stroke="hsl(var(--primary))" strokeWidth={2.4} strokeLinejoin="round" /> : null}
        {beforePath ? <path d={beforePath} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.4} strokeDasharray="2 3" /> : null}
        {ninoSegments.map((d) => <path key={d} d={d} fill="none" stroke="hsl(var(--success))" strokeWidth={2.2} strokeDasharray="5 4" />)}
        {rows.map((r) => {
          if (r.nino != null) { const p = point(r.i, r.nino); return <circle key={r.key} cx={p.x} cy={p.y} r={4} fill="hsl(var(--success))" stroke="hsl(var(--card))" strokeWidth={1.5} />; }
          const p = point(r.i, 10);
          return <circle key={r.key} cx={p.x} cy={p.y} r={3.5} fill="hsl(var(--card))" stroke="hsl(var(--muted-foreground))" strokeWidth={1.2} strokeDasharray="2 2" data-testid={`no-reading-${r.key}`} />;
        })}
        {rows.map((r) => {
          const p = point(r.i, 10);
          const lx = CX + (R + 22) * Math.cos(p.angle), ly = CY + (R + 22) * Math.sin(p.angle);
          const anchor = Math.abs(Math.cos(p.angle)) < 0.2 ? "middle" : Math.cos(p.angle) > 0 ? "start" : "end";
          return (
            <text key={r.key} x={lx} y={ly + 4} textAnchor={anchor} fontSize={10} fontWeight={selected === r.key ? 800 : 600}
              fill={selected === r.key ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"} className="cursor-pointer"
              onClick={() => onSelect(selected === r.key ? null : r.key)}>{r.short}</text>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden /> Você</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden /> Nino observa</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground" aria-hidden /> sem leitura confiável</span>
      </div>
      <ul className="divide-y divide-border border-t border-border" aria-label="Dimensões">
        {rows.map((r) => {
          const open = selected === r.key;
          const state = r.dim?.state ?? "none";
          return (
            <li key={r.key}>
              <button type="button" onClick={() => onSelect(open ? null : r.key)} aria-expanded={open}
                className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{r.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.nino != null ? `Nino ${fmt(r.nino)}` : state === "partial" ? "Base parcial" : "Ainda não sei"}
                    {r.self != null ? ` · Você ${fmt(r.self)}` : ""}
                  </span>
                </span>
                <ChevronRight size={16} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
              </button>
              {open && r.dim ? (
                <div className="pb-3">
                  <DimensionPanel
                    dimensionKey={r.key}
                    dimension={r.dim}
                    self={r.self}
                    notComparable={notComparable.has(r.key)}
                    feedback={feedback[r.key]}
                    busy={feedbackBusy}
                    onAnswer={(a) => onAnswer(r.key, a)}
                    onRemove={() => onRemoveFeedback(r.key)}
                    weighs={weighsFor(r.key)}
                    onWeighs={(keys) => onWeighs(r.key, keys)}
                    onClearWeighs={() => onClearWeighs(r.key)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={() => setMapOpen(true)} variant={latest && !cycle.due ? "outline" : "default"} className="min-h-11 flex-1 rounded-full font-semibold">
          {latest ? (cycle.due ? "Rever como me vejo" : "Revisar meu mapa") : "Responder meu mapa"}
        </Button>
        {baseline ? (
          <Button type="button" variant="ghost" className="min-h-11 rounded-full text-xs" onClick={() => setShowEvolution((v) => !v)} aria-pressed={showEvolution}>
            {showEvolution ? "Ocultar evolução" : "Ver evolução"}
          </Button>
        ) : null}
      </div>

      <AssessmentDialog open={mapOpen} onClose={() => setMapOpen(false)} latest={latest} cycle={cycle} onSave={onSaveMap} saving={saving} />
    </section>
  );
}
