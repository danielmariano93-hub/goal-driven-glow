import { useState } from "react";
import { Check, HelpCircle, ArrowLeftRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BehaviorDimensionKey, ObservedDimension } from "@/lib/engine/behaviorDimensions";
import { BEHAVIOR_DIMENSIONS } from "@/lib/engine/behaviorDimensions";
import { DIMENSION_INTENT } from "@/lib/engine/behaviorObservedV3";
import { DIMENSION_WEIGHS } from "../../../supabase/functions/_shared/proactive/habitContext";
import { FEEDBACK_NOTE_MAX, FEEDBACK_REASONS, feedbackValidUntil, type BehaviorFeedback, type FeedbackReason } from "@/lib/engine/behaviorEvolution";

const fmt = (n: number) => n.toFixed(1).replace(".", ",");
const KIND_LABEL = { direct: "registro direto", derived: "calculado pelo Nino", declared: "informado por você" } as const;
const CONF_LABEL = { low: "confiança baixa", medium: "confiança média", high: "confiança alta" } as const;

export type FeedbackAnswer = { verdict: "yes" | "partially" | "no"; reason: FeedbackReason; note: string | null };

function ddmm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Painel de uma dimensão: o que o Nino observou, o que ainda não sabe e como a pessoa se percebe. */
export function DimensionPanel({
  dimensionKey, dimension, self, notComparable, feedback, busy, onAnswer, onRemove, weighs, onWeighs, onClearWeighs,
}: {
  /** Chaves que a pessoa marcou como "o que mais pesa" nesta dimensão (null = ainda não respondeu). */
  weighs?: string[] | null;
  onWeighs?: (keys: string[]) => void | Promise<void>;
  onClearWeighs?: () => void | Promise<void>;
  dimensionKey: BehaviorDimensionKey;
  dimension: ObservedDimension;
  /** Nota que a pessoa se deu no mapa (null = ainda não respondeu). */
  self: number | null;
  notComparable?: boolean;
  feedback?: BehaviorFeedback;
  busy?: boolean;
  onAnswer: (answer: FeedbackAnswer) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const label = BEHAVIOR_DIMENSIONS.find((d) => d.key === dimensionKey)?.label ?? dimensionKey;
  const record = dimension.record;
  const state = dimension.state ?? (dimension.score != null ? "sufficient" : "none");
  const [asking, setAsking] = useState<"partially" | "no" | null>(null);
  const [reason, setReason] = useState<FeedbackReason>("missing_data");
  const [note, setNote] = useState("");

  const headline = state === "sufficient" && dimension.score != null
    ? `Nota ${fmt(dimension.score)} · ${CONF_LABEL[dimension.confidence]}`
    : state === "partial" ? "Base parcial · sem nota" : "Ainda não sei · sem nota";

  const gap = self != null && dimension.score != null ? dimension.score - self : null;
  const options = DIMENSION_WEIGHS[dimensionKey] ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (k: string) => setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= 3 ? cur : [...cur, k]));
  const sources = record?.origin.map((o) => o.label.toLowerCase()).join(", ");
  const selfText = self == null
    ? "Você ainda não respondeu esta pergunta no mapa. Quando responder, as duas leituras aparecem lado a lado."
    : dimension.score == null
      ? `Você se deu ${fmt(self)}. O Nino ainda não tem base para dar a dele, então não há comparação — e isso não diz que a sua percepção esteja errada.`
      : Math.abs(gap!) < 1
        ? `Você se deu ${fmt(self)} e o Nino observa ${fmt(dimension.score)}: as duas leituras estão próximas.`
        : `Você se deu ${fmt(self)} e o Nino observa ${fmt(dimension.score)}. ${gap! > 0 ? "Você se vê abaixo do que os indicadores mostram" : "Você se vê acima do que os indicadores mostram"}. Isso não significa que a sua percepção esteja errada: o Nino só enxerga o que está nos registros${sources ? ` (${sources})` : ""}.`;

  const answer = async (verdict: "yes" | "partially" | "no") => {
    if (verdict === "yes") {
      await onAnswer({ verdict, reason: "other", note: null });
      return;
    }
    setAsking(verdict);
  };

  const submit = async () => {
    if (!asking) return;
    await onAnswer({ verdict: asking, reason, note: note.trim() ? note.trim().slice(0, FEEDBACK_NOTE_MAX) : null });
    setAsking(null);
    setNote("");
  };

  return (
    <section id={`dimensao-${dimensionKey}`} aria-label={`Como o Nino chegou à leitura de ${label}`} className="rounded-[22px] border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-bold tracking-tight">{label}</h3>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${state === "sufficient" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>{headline}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{DIMENSION_INTENT[dimensionKey]}</p>

      <p className="mt-3 text-sm leading-relaxed">{dimension.evidence}</p>

      <div className="mt-3 space-y-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-success"><Check size={13} aria-hidden /> O que observei</p>
          {record?.observed.length ? (
            <ul className="mt-1 space-y-1 text-[13px] leading-relaxed">
              {record.observed.map((line) => <li key={line}>• {line}</li>)}
            </ul>
          ) : <p className="mt-1 text-[13px] text-muted-foreground">Nada ainda que sustente uma leitura.</p>}
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><HelpCircle size={13} aria-hidden /> O que ainda não sei</p>
          <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
            {record?.unavailable_reason ? <li>• {record.unavailable_reason}</li> : null}
            {record?.unknown.map((line) => <li key={line}>• {line}</li>)}
          </ul>
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary"><ArrowLeftRight size={13} aria-hidden /> Como você se percebe</p>
          <p className="mt-1 text-[13px] leading-relaxed">{selfText}</p>
          {onWeighs ? (
            weighs?.length ? (
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground" data-testid="weighs-saved">
                O que mais pesa para você: {weighs.map((k) => options.find((o) => o.key === k)?.label ?? k).join(", ")}.{" "}
                <button type="button" onClick={() => onClearWeighs?.()} className="min-h-10 font-semibold text-primary">Alterar</button>
              </p>
            ) : (
              <div className="mt-2" data-testid="weighs-question">
                <p className="text-[13px] font-semibold">O que mais pesa para você aqui? <span className="font-normal text-muted-foreground">(opcional, até 3)</span></p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {options.map((o) => (
                    <button key={o.key} type="button" aria-pressed={picked.includes(o.key)} onClick={() => toggle(o.key)}
                      className={`min-h-10 rounded-full border px-3 text-xs font-semibold ${picked.includes(o.key) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{o.label}</button>
                  ))}
                </div>
                {picked.length ? <Button type="button" size="sm" className="mt-2 min-h-10 rounded-full" onClick={() => { onWeighs(picked); setPicked([]); }}>Salvar</Button> : null}
              </div>
            )
          ) : null}
        </div>

        {notComparable && dimension.score != null ? (
          <p className="rounded-xl bg-secondary/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">Ainda não tenho comparação confiável para esta dimensão: a forma de leitura mudou. Esta é a nossa primeira referência — não é melhora nem piora.</p>
        ) : null}

        {record ? (
          <details className="rounded-xl bg-secondary/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-foreground"><Info size={12} aria-hidden /> De onde vem e o que não prova</summary>
            <p className="mt-2"><strong className="text-foreground">Não prova:</strong> {record.limit}</p>
            <p className="mt-1"><strong className="text-foreground">Fontes:</strong> {record.origin.map((o) => `${o.label} (${KIND_LABEL[o.kind]})`).join("; ")}.</p>
            <p className="mt-1"><strong className="text-foreground">Janela:</strong> {record.window} · <strong className="text-foreground">Cobertura:</strong> {record.coverage}</p>
          </details>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        {feedback ? (
          <div className="text-[12px] leading-relaxed text-muted-foreground">
            <p>
              Você disse que {feedback.verdict === "partially" ? "isso representa só em parte" : "isso não representa"} a sua realidade. A nota continua a mesma, mas o Nino trata esta leitura como incerta até {ddmm(feedbackValidUntil(feedback.week_start))}.
              {feedback.note ? <> Seu contexto: “{feedback.note}”.</> : null}
            </p>
            <button type="button" disabled={busy} onClick={() => onRemove()} className="mt-1 font-semibold text-primary">Desfazer</button>
          </div>
        ) : asking ? (
          <div>
            <p className="text-sm font-semibold">{asking === "no" ? "O que falta nessa leitura?" : "O que ela não captura?"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {FEEDBACK_REASONS.map((r) => (
                <button key={r.key} type="button" onClick={() => setReason(r.key)} aria-pressed={reason === r.key}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${reason === r.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r.label}</button>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={FEEDBACK_NOTE_MAX} rows={2} placeholder="Quer contar o contexto? (opcional)"
              className="mt-2 w-full rounded-xl border border-border bg-background p-2 text-sm" />
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" className="min-h-10 rounded-full" disabled={busy} onClick={submit}>Registrar</Button>
              <Button type="button" size="sm" variant="ghost" className="min-h-10 rounded-full" onClick={() => setAsking(null)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold">Isso representa minha realidade?</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={busy} onClick={() => answer("yes")}>Sim</Button>
              <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={busy} onClick={() => answer("partially")}>Em parte</Button>
              <Button type="button" variant="outline" className="min-h-11 rounded-full" disabled={busy} onClick={() => answer("no")}>Não</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
