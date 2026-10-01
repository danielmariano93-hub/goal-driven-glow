import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Check, Link2, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/engine/facts";
import type { BehaviorExperiment } from "@/lib/behavioral/client";
import { logBehaviorExperiment } from "@/lib/behavioral/client";
import type { EvidenceItem } from "@/lib/behavioral/experimentCopy";
import { reviewAlreadyCounted, type ExperimentEvent } from "@/lib/behavioral/experimentCopy";
import { useCompleteReview, useLinkCandidates, useLinkTransaction } from "@/lib/behavioral/experimentEvidence";

const dayBR = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

/** O que já contou neste experimento, com a origem de cada contagem. */
export function EvidenceList({ items, onUnlink, busy }: { items: EvidenceItem[]; onUnlink?: (id: string) => void; busy?: boolean }) {
  if (!items.length) {
    return <p className="rounded-2xl bg-secondary/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">Nada contou ainda. Assim que o Nino detectar ou você comprovar, aparece aqui.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 rounded-2xl bg-secondary/40 px-3 py-2">
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${item.counts ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}>
            <Check size={11} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold leading-snug">{item.title}</span>
            {item.detail ? <span className="block text-[11px] leading-snug text-muted-foreground">{item.detail}</span> : null}
            <span className="block text-[10px] text-muted-foreground">{item.sourceLabel} · {dayBR(item.at)}{item.counts ? "" : " · não conta"}</span>
          </span>
          {item.removable && onUnlink ? (
            <button type="button" disabled={busy} onClick={() => onUnlink(item.id)} aria-label="Desfazer este registro" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
              <Undo2 size={13} aria-hidden />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Vincular um lançamento real como prova da ação. */
export function LinkTransactionSheet({
  experiment, open, onOpenChange, label, onChanged,
}: {
  experiment: BehaviorExperiment; open: boolean; onOpenChange: (v: boolean) => void; label: string; onChanged: () => Promise<void> | void;
}) {
  const candidates = useLinkCandidates(open ? experiment.id : null);
  const link = useLinkTransaction(onChanged);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-[28px]">
        <SheetHeader className="text-left">
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>Escolha o lançamento que comprova a ação. Ele passa a contar neste experimento, e você pode desfazer depois.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {candidates.isLoading ? <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : null}
          {candidates.isError ? <p className="text-xs text-muted-foreground">Não deu para carregar seus lançamentos agora.</p> : null}
          {candidates.data && candidates.data.length === 0 ? (
            <p className="rounded-2xl bg-secondary/40 p-4 text-xs leading-relaxed text-muted-foreground">Nenhum lançamento novo desde o início do experimento. Registre a ação (por exemplo, o Pix para a reserva) e volte aqui.</p>
          ) : null}
          {candidates.data?.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={link.isPending}
              onClick={() =>
                link.mutate({ experimentId: experiment.id, transactionId: c.id }, {
                  onSuccess: () => { toast.success("Lançamento vinculado ao experimento."); onOpenChange(false); },
                  onError: () => toast.error("Não deu para vincular esse lançamento agora."),
                })}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 text-left hover:border-primary/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{c.description}</span>
                <span className="block text-[11px] text-muted-foreground">{dayBR(c.occurred_at)} · {c.type === "transfer" ? "Transferência" : "Despesa"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold tabular-nums">{formatBRL(c.amount)}<Link2 size={13} aria-hidden className="text-primary" /></span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const REVIEW_STEPS = [
  { id: "saldo", title: "Saldo e compromissos", body: "Veja quanto sobra hoje e o que vence nos próximos dias.", to: "/app", cta: "Abrir o início" },
  { id: "relatorio", title: "O relatório da semana", body: "Veja se você está melhor ou pior e o que mais subiu.", to: "/app/relatorios", cta: "Abrir Relatórios" },
  { id: "decisao", title: "Uma decisão para simplificar", body: "Escolha uma só: um teto de gasto, uma assinatura para revisar ou um gasto para cortar.", to: "/app/metas", cta: "Abrir Metas" },
] as const;

/** Roteiro guiado da revisão de 5 minutos. */
export function WeeklyReviewSheet({
  experiment, events, open, onOpenChange, onChanged,
}: {
  experiment: BehaviorExperiment; events: ExperimentEvent[]; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => Promise<void> | void;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const complete = useCompleteReview(onChanged);
  const counted = reviewAlreadyCounted(experiment.started_at, events);
  const allDone = REVIEW_STEPS.every((s) => done[s.id]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[28px]">
        <SheetHeader className="text-left">
          <SheetTitle>Revisão de 5 minutos</SheetTitle>
          <SheetDescription>
            {counted ? "Esta semana já contou. Você pode repetir o roteiro quando quiser." : "Passe pelos 3 passos e conclua. O Nino também conta a semana sozinho se você abrir Relatórios e Planejamento ou Metas."}
          </SheetDescription>
        </SheetHeader>
        <ol className="mt-4 space-y-2">
          {REVIEW_STEPS.map((step, index) => (
            <li key={step.id} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!done[step.id]}
                  aria-label={`Marcar o passo ${index + 1} como visto`}
                  onClick={() => setDone((d) => ({ ...d, [step.id]: !d[step.id] }))}
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${done[step.id] ? "border-success bg-success text-white" : "border-border bg-background"}`}
                >
                  {done[step.id] ? <Check size={13} aria-hidden /> : <span className="text-[11px] font-bold text-muted-foreground">{index + 1}</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{step.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.body}</p>
                  <Link to={step.to} onClick={() => onOpenChange(false)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary">{step.cta} <ArrowRight size={12} aria-hidden /></Link>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          className="mt-4 min-h-11 w-full rounded-full font-semibold"
          disabled={!allDone || complete.isPending}
          onClick={() =>
            complete.mutate({ experimentId: experiment.id }, {
              onSuccess: () => { toast.success("Revisão da semana registrada."); setDone({}); onOpenChange(false); },
              onError: () => toast.error("Não deu para registrar a revisão agora."),
            })}
        >
          {complete.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {allDone ? "Concluí minha revisão" : "Marque os 3 passos para concluir"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/** Registrar uma pausa antes da compra (com a compra opcionalmente vinculada depois). */
export function PauseSheet({
  experiment, open, onOpenChange, onChanged,
}: {
  experiment: BehaviorExperiment; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  async function register(note: string) {
    setBusy(true);
    try {
      await logBehaviorExperiment(experiment.id, note);
      toast.success("Pausa registrada.");
      onOpenChange(false);
      await onChanged();
    } catch {
      toast.error("Não deu para registrar a pausa agora.");
    } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[28px]">
        <SheetHeader className="text-left">
          <SheetTitle>Como foi a pausa?</SheetTitle>
          <SheetDescription>Você esperou 10 minutos antes de decidir. As duas respostas contam: o objetivo é criar o hábito de parar.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-2">
          <Button type="button" disabled={busy} className="min-h-11 rounded-full font-semibold" onClick={() => register("A vontade passou")}>A vontade passou</Button>
          <Button type="button" variant="outline" disabled={busy} className="min-h-11 rounded-full font-semibold" onClick={() => register("Comprei mesmo assim")}>Comprei mesmo assim</Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Se comprou, depois você pode vincular a compra ao registro no próprio experimento.</p>
      </SheetContent>
    </Sheet>
  );
}
