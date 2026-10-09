import { useState } from "react";
import { Flag } from "lucide-react";
import { FEEDBACK_NOTE_MAX, FEEDBACK_REASONS, feedbackValidUntil, type BehaviorFeedback, type FeedbackReason } from "@/lib/behavioral/behaviorEvolution";

const dateBR = (iso: string) => iso.split("-").reverse().join("/");

/**
 * "Isso não representa minha realidade": a pessoa contesta a nota de uma dimensão.
 * A nota não muda; o Nino passa a tratá-la como incerta e a deixa fora das descobertas.
 */
export function ContestScore({
  label,
  feedback,
  busy = false,
  defaultOpen = false,
  onSave,
  onRemove,
}: {
  label: string;
  feedback?: BehaviorFeedback | null;
  busy?: boolean;
  defaultOpen?: boolean;
  onSave: (input: { reason: FeedbackReason; note: string | null }) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState("");

  if (feedback && !open) {
    const reasonLabel = FEEDBACK_REASONS.find((r) => r.key === feedback.reason)?.label ?? "";
    return (
      <div role="status" className="rounded-2xl border border-border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="flex items-start gap-1.5">
          <Flag size={12} aria-hidden className="mt-0.5 shrink-0 text-primary" />
          <span>
            <strong className="text-foreground">Você contestou esta nota.</strong> {reasonLabel}.
            {" "}O Nino a trata como incerta até {dateBR(feedbackValidUntil(feedback.week_start))} e não a usa nas descobertas.
          </span>
        </p>
        <div className="mt-2 flex gap-3">
          <button type="button" disabled={busy} onClick={() => setOpen(true)} className="font-semibold text-primary disabled:opacity-60">Mudar motivo</button>
          <button type="button" disabled={busy} onClick={() => onRemove()} className="font-semibold text-muted-foreground disabled:opacity-60">Desfazer</button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:underline">
        <Flag size={12} aria-hidden /> Isso não representa minha realidade
      </button>
    );
  }

  return (
    <form
      aria-label={`Contestar a nota de ${label}`}
      className="space-y-2 rounded-2xl border border-primary/20 bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!reason) return;
        await onSave({ reason, note: note.trim() ? note : null });
        setOpen(false);
        setNote("");
        setReason(null);
      }}
    >
      <p className="text-[12px] font-semibold">O que faz essa nota não combinar com a sua realidade?</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">A nota não muda. O Nino passa a tratá-la como incerta por 30 dias e deixa de usá-la para tirar conclusões sobre você.</p>
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Motivo</legend>
        {FEEDBACK_REASONS.map((item) => (
          <label key={item.key} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[12px] ${reason === item.key ? "border-primary bg-primary/5 font-semibold" : "border-border"}`}>
            <input type="radio" name={`contest-${label}`} value={item.key} checked={reason === item.key} onChange={() => setReason(item.key)} className="accent-primary" />
            {item.label}
          </label>
        ))}
      </fieldset>
      <label className="block text-[11px] text-muted-foreground">
        Quer contar mais? (opcional)
        <textarea
          value={note}
          maxLength={FEEDBACK_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-[12px] text-foreground"
        />
        <span className="mt-0.5 block text-right tabular-nums">{note.length}/{FEEDBACK_NOTE_MAX}</span>
      </label>
      <div className="flex gap-3">
        <button type="submit" disabled={!reason || busy} className="rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-primary-foreground disabled:opacity-50">Enviar</button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-muted-foreground">Cancelar</button>
      </div>
    </form>
  );
}
