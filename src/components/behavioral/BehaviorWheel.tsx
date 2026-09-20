import { useMemo, useState } from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { Check, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BEHAVIOR_DIMENSIONS,
  type BehavioralAssessment,
  type BehaviorDimensionKey,
} from "@/lib/behavioral/client";

function defaultScores(assessment: BehavioralAssessment | null): Record<BehaviorDimensionKey, number> {
  return Object.fromEntries(BEHAVIOR_DIMENSIONS.map((dimension) => [dimension.key, Number(assessment?.scores?.[dimension.key] ?? 5)])) as Record<BehaviorDimensionKey, number>;
}

export function BehaviorWheel({
  latest,
  previous,
  onSave,
  saving = false,
}: {
  latest: BehavioralAssessment | null;
  previous: BehavioralAssessment | null;
  onSave: (scores: Record<BehaviorDimensionKey, number>) => Promise<void>;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<Record<BehaviorDimensionKey, number>>(() => defaultScores(latest));

  const chart = useMemo(() => BEHAVIOR_DIMENSIONS.map((dimension) => ({
    subject: dimension.short,
    score: Number(latest?.scores?.[dimension.key] ?? 0),
    fullMark: 10,
  })), [latest]);

  const strongest = latest
    ? [...BEHAVIOR_DIMENSIONS].sort((a, b) => Number(latest.scores?.[b.key] ?? 0) - Number(latest.scores?.[a.key] ?? 0))[0]
    : null;
  const focus = latest
    ? [...BEHAVIOR_DIMENSIONS].sort((a, b) => Number(latest.scores?.[a.key] ?? 0) - Number(latest.scores?.[b.key] ?? 0))[0]
    : null;
  const delta = latest && previous ? Number(latest.overall_score) - Number(previous.overall_score) : null;

  const begin = () => {
    setScores(defaultScores(latest));
    setStep(0);
    setOpen(true);
  };

  const finish = async () => {
    await onSave(scores);
    setOpen(false);
  };

  return (
    <>
      <section className="overflow-hidden rounded-[26px] border border-border bg-card shadow-card">
        <div className="p-5 pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Seu mapa</p>
              <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Roda financeira comportamental</h2>
              <p className="mt-1 max-w-[520px] text-xs leading-relaxed text-muted-foreground">
                Sua percepção em 8 dimensões. O Nino usa esse mapa para sugerir experiências — não como diagnóstico ou nota de valor pessoal.
              </p>
            </div>
            {latest ? (
              <div className="min-w-[70px] rounded-2xl bg-primary/10 px-3 py-2 text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Hoje</p>
                <p className="font-display text-2xl font-bold text-primary">{Number(latest.overall_score).toFixed(1)}</p>
                {delta != null && Math.abs(delta) >= 0.1 ? (
                  <p className={`text-[10px] font-semibold ${delta > 0 ? "text-success" : "text-brand-coral"}`}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(1)} vs. anterior
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {latest ? (
          <>
            <div className="h-[292px] px-1 sm:h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={chart} outerRadius="72%">
                  <PolarGrid stroke="hsl(var(--border))" gridType="polygon" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
                    tickLine={false}
                  />
                  <Radar
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.16}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">
              {strongest ? (
                <div className="rounded-2xl bg-success/10 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-success">Ponto forte percebido</p>
                  <p className="mt-1 text-sm font-semibold">{strongest.label}</p>
                  <p className="text-xs text-muted-foreground">{Number(latest.scores[strongest.key]).toFixed(1)} de 10</p>
                </div>
              ) : null}
              {focus ? (
                <div className="rounded-2xl bg-primary/10 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Onde testar uma mudança</p>
                  <p className="mt-1 text-sm font-semibold">{focus.label}</p>
                  <p className="text-xs text-muted-foreground">{Number(latest.scores[focus.key]).toFixed(1)} de 10</p>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="px-5 pb-5 pt-4">
            <div className="rounded-[22px] border border-dashed border-primary/30 bg-primary/5 p-5 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-primary" />
              <p className="mt-2 text-sm font-semibold">Monte seu primeiro mapa em cerca de 1 minuto</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Você responde oito perguntas de 0 a 10. Depois, o Nino cruza sua percepção com fatos financeiros sem misturar uma coisa com a outra.
              </p>
            </div>
          </div>
        )}

        <div className="px-4 pb-4">
          <Button type="button" onClick={begin} className="min-h-11 w-full rounded-full font-semibold" variant={latest ? "outline" : "default"}>
            {latest ? "Atualizar meu mapa" : "Mapear meu momento"}
          </Button>
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/30 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-[28px] border border-border bg-background p-5 shadow-2xl sm:rounded-[28px]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{step + 1} de {BEHAVIOR_DIMENSIONS.length}</p>
                <p className="font-display text-lg font-bold">{BEHAVIOR_DIMENSIONS[step].label}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-secondary" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            <p className="mt-5 min-h-[54px] text-sm leading-relaxed text-muted-foreground">{BEHAVIOR_DIMENSIONS[step].question}</p>

            <div className="mt-6 rounded-[22px] border border-border bg-card p-5">
              <div className="flex items-end justify-between">
                <span className="text-xs text-muted-foreground">Nada</span>
                <span className="font-display text-4xl font-bold text-primary">{scores[BEHAVIOR_DIMENSIONS[step].key]}</span>
                <span className="text-xs text-muted-foreground">Muito</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={scores[BEHAVIOR_DIMENSIONS[step].key]}
                onChange={(event) => setScores((current) => ({ ...current, [BEHAVIOR_DIMENSIONS[step].key]: Number(event.target.value) }))}
                className="mt-5 h-2 w-full cursor-pointer accent-primary"
                aria-label={`Nota para ${BEHAVIOR_DIMENSIONS[step].label}`}
              />
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>0</span><span>5</span><span>10</span></div>
            </div>

            <div className="mt-5 flex gap-2">
              <Button type="button" variant="outline" className="min-h-11 flex-1 rounded-full" disabled={step === 0 || saving} onClick={() => setStep((value) => Math.max(0, value - 1))}>
                <ChevronLeft size={16} /> Voltar
              </Button>
              {step < BEHAVIOR_DIMENSIONS.length - 1 ? (
                <Button type="button" className="min-h-11 flex-1 rounded-full" onClick={() => setStep((value) => Math.min(BEHAVIOR_DIMENSIONS.length - 1, value + 1))}>
                  Próxima <ChevronRight size={16} />
                </Button>
              ) : (
                <Button type="button" className="min-h-11 flex-1 rounded-full" disabled={saving} onClick={finish}>
                  <Check size={16} /> {saving ? "Salvando…" : "Salvar mapa"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
