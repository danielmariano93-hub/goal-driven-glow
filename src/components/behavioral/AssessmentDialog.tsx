import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BEHAVIOR_DIMENSIONS, type BehavioralAssessment, type BehaviorDimensionKey } from "@/lib/behavioral/client";
import { behaviorQuestionForDimension, type AssessmentCycle } from "@/lib/behavioral/mapCycle";

function defaultScores(assessment: BehavioralAssessment | null): Record<BehaviorDimensionKey, number> {
  return Object.fromEntries(BEHAVIOR_DIMENSIONS.map((dimension) => [dimension.key, Number(assessment?.scores?.[dimension.key] ?? 5)])) as Record<BehaviorDimensionKey, number>;
}

/** Autoavaliação das oito dimensões (uma pergunta por vez). Compartilhada pela roda atual e pela v2. */
export function AssessmentDialog({
  open, onClose, latest, cycle, onSave, saving = false,
}: {
  open: boolean;
  onClose: () => void;
  latest: BehavioralAssessment | null;
  cycle: Pick<AssessmentCycle, "questionSetIndex">;
  onSave: (scores: Record<BehaviorDimensionKey, number>) => Promise<void>;
  saving?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<Record<BehaviorDimensionKey, number>>(() => defaultScores(latest));

  useEffect(() => {
    if (open) {
      setScores(defaultScores(latest));
      setStep(0);
    }
    // reinicia só quando abre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const dim = BEHAVIOR_DIMENSIONS[step];

  const finish = async () => {
    await onSave(scores);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/30 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-lg rounded-t-[28px] border border-border bg-background p-5 shadow-2xl sm:rounded-[28px]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{step + 1} de {BEHAVIOR_DIMENSIONS.length}</p>
            <p className="font-display text-lg font-bold">{dim.label}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-secondary" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <p className="mt-5 min-h-[54px] text-sm leading-relaxed text-muted-foreground">
          {behaviorQuestionForDimension(dim.key, cycle.questionSetIndex)}
        </p>

        <div className="mt-6 rounded-[22px] border border-border bg-card p-5">
          <div className="flex items-end justify-between">
            <span className="text-xs text-muted-foreground">Nada</span>
            <span className="font-display text-4xl font-bold text-primary">{scores[dim.key]}</span>
            <span className="text-xs text-muted-foreground">Muito</span>
          </div>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={scores[dim.key]}
            onChange={(event) => setScores((current) => ({ ...current, [dim.key]: Number(event.target.value) }))}
            className="mt-5 h-2 w-full cursor-pointer accent-primary"
            aria-label={`Nota para ${dim.label}`}
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
  );
}
