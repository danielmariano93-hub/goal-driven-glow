import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { PageHeader } from "@/components/hb/ui";
import { BodyMeasureCard, MeasureSheet, TrainingVsBodyCard, WeightCard } from "@/components/hb/GoalCards";
import { hbErrorMessage, useAddMeasure, useArchiveGoal, useArchiveMeasure, useGoals, useHabitViews, useUpdateGoal, useUpdateMeasure, type GoalData, type GoalMeasure } from "@/lib/habits/api";
import { Segmented } from "@/components/hb/Segmented";
import { isSidedKind, measureName, otherSide, sideWord, type MeasureSide } from "@/lib/habits/engine/goals";
import { diffDays } from "@/lib/habits/engine/dates";

const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;

export const MEASURE_PRESETS: Array<{ kind: GoalMeasure["kind"]; label: string; unit: string; cadence: GoalMeasure["cadence"] }> = [
  { kind: "weight", label: "Peso", unit: "kg", cadence: "weekly" },
  { kind: "waist", label: "Cintura", unit: "cm", cadence: "weekly" },
  { kind: "arm", label: "Braço", unit: "cm", cadence: "weekly" },
  { kind: "thigh", label: "Coxa", unit: "cm", cadence: "weekly" },
];

function EditSheet({ goal, open, onOpenChange, onArchived }: { goal: GoalData; open: boolean; onOpenChange: (o: boolean) => void; onArchived: () => void }) {
  const update = useUpdateGoal();
  const addMeasure = useAddMeasure();
  const archiveMeasure = useArchiveMeasure();
  const updateMeasure = useUpdateMeasure();
  const archiveGoal = useArchiveGoal();
  const [title, setTitle] = useState(goal.title);
  const [confirm, setConfirm] = useState(false);
  // Para adicionar: o que ainda não existe; e, em braço e coxa, o outro lado de quem já tem lado escolhido.
  const addable = MEASURE_PRESETS.flatMap((p) => {
    const same = goal.measures.filter((m) => m.kind === p.kind);
    if (same.length === 0) return [{ ...p, side: null as MeasureSide | null, text: p.label }];
    if (isSidedKind(p.kind) && same.length === 1 && same[0].side) {
      const side = otherSide(same[0].side);
      return [{ ...p, side, text: measureName({ kind: p.kind, label: p.label, side }) }];
    }
    return [];
  });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(hbErrorMessage(e)); }
  };
  return (
    <Drawer open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirm(false); }} repositionInputs={false}>
      <DrawerContent>
        <div className="mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-[18px] font-semibold tracking-[-0.02em]">Editar objetivo</DrawerTitle>
            <DrawerDescription>Nome e medidas acompanhadas. Remover uma medida não apaga o que você já registrou.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-3 px-4">
            <label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
              Nome
              <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Nome do objetivo" className="h-11 rounded-2xl border border-border/70 bg-card px-4 text-[14px] text-foreground" />
            </label>
            <Button className="h-11 rounded-full text-[14px] font-medium" disabled={title.trim().length < 2 || title.trim() === goal.title || update.isPending} onClick={() => void run(() => update.mutateAsync({ id: goal.id, title: title.trim() }), "Nome atualizado")}>Salvar nome</Button>
            <div>
              <p className="text-[12px] text-muted-foreground">Medidas</p>
              <ul className="mt-1.5 flex flex-col gap-2">
                {goal.measures.map((m) => (
                  <li key={m.id} className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2 text-[14px]">
                      <span className="font-medium">{measureName(m)} <span className="text-[12px] font-normal text-muted-foreground">· {m.unit}</span></span>
                      <button type="button" aria-label={`Remover ${measureName(m)}`} className="-mr-1.5 grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => void run(() => archiveMeasure.mutateAsync(m.id), "Medida removida")}><X className="h-4 w-4" aria-hidden="true" /></button>
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
                      <Segmented<GoalMeasure["cadence"]> label={`Frequência de ${measureName(m)}`} value={m.cadence} options={[["weekly", "Toda semana"], ["monthly", "Todo mês"]]} disabled={updateMeasure.isPending} onChange={(c) => { if (c !== m.cadence) void run(() => updateMeasure.mutateAsync({ id: m.id, cadence: c }), c === "weekly" ? "Agora é toda semana" : "Agora é todo mês"); }} />
                      {isSidedKind(m.kind) ? (
                        <Segmented<MeasureSide> label={`Lado de ${m.label}`} value={m.side ?? null} options={[["left", `Lado ${sideWord(m.kind, "left")}`], ["right", `Lado ${sideWord(m.kind, "right")}`]]} disabled={updateMeasure.isPending} onChange={(sd) => { if (sd !== m.side) void run(() => updateMeasure.mutateAsync({ id: m.id, side: sd }), "Lado atualizado"); }} />
                      ) : null}
                    </div>
                    {isSidedKind(m.kind) && !m.side ? <p className="mt-1.5 text-[12px] leading-[18px] text-muted-foreground">Escolha o lado que você mede: a comparação só vale para um lado.</p> : null}
                  </li>
                ))}
              </ul>
              {addable.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {addable.map((p) => (
                    <button key={`${p.kind}-${p.side ?? "x"}`} type="button" aria-label={`Adicionar ${p.text}`} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary" onClick={() => void run(() => addMeasure.mutateAsync({ goal: goal.id, kind: p.kind, label: p.label, unit: p.unit, cadence: p.cadence, side: p.side }), `${p.text} adicionada`)}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{p.text}</button>
                  ))}
                </div>
              ) : null}
            </div>
            {confirm ? (
              <Button variant="outline" className="h-11 rounded-full text-[14px] font-medium text-destructive" disabled={archiveGoal.isPending} onClick={() => void run(async () => { await archiveGoal.mutateAsync(goal.id); onOpenChange(false); onArchived(); }, "Objetivo arquivado")}>Confirmar: arquivar este objetivo</Button>
            ) : (
              <Button variant="ghost" className="h-11 rounded-full text-[14px] text-muted-foreground" onClick={() => setConfirm(true)}>Arquivar este objetivo</Button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export default function Objetivo() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goals = useGoals();
  const { views, logs, today: viewsToday } = useHabitViews();
  const [recording, setRecording] = useState<GoalMeasure | null>(null);
  const [editing, setEditing] = useState(false);
  const today = goals.data?.today ?? viewsToday;
  const goal = goals.data?.goals.find((g) => g.id === id);

  if (goals.isLoading || !today) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;
  if (goals.isError) {
    return (
      <div className="px-4">
        <PageHeader title="Objetivo" back="/h/habitos" />
        <p className="text-sm text-muted-foreground">Não consegui carregar o objetivo agora.</p>
        <Button variant="outline" className="mt-3 rounded-full" onClick={() => void goals.refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  if (!goal) {
    return (
      <div className="px-4">
        <PageHeader title="Objetivo não encontrado" back="/h/habitos" />
        <p className="text-sm text-muted-foreground">Ele pode ter sido arquivado.</p>
      </div>
    );
  }
  const weeks = Math.max(1, Math.ceil((diffDays(goal.started_on, today) + 1) / 7));
  const weight = goal.measures.find((m) => m.kind === "weight");
  const others = goal.measures.filter((m) => m.kind !== "weight");
  const training = views.find((v) => goal.habit_ids.includes(v.habit.id) && v.summary.model === "weekly");
  const measureNames = goal.measures.map((m) => `${measureName(m).toLowerCase()} (${m.cadence === "weekly" ? "semanal" : "mensal"})`).join(" e ");

  return (
    <div className="px-4 pb-8">
      <PageHeader title="Objetivo" back="/h/habitos" right={<Button variant="ghost" size="sm" className="mt-1 h-11 rounded-full px-4 text-primary" onClick={() => setEditing(true)}>Editar</Button>} />
      <div className="flex flex-col gap-3">
        <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Seu objetivo">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[12px] font-medium text-muted-foreground">Seu objetivo</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">desde {dm(goal.started_on)} · {weeks} {weeks === 1 ? "semana" : "semanas"}</span>
          </div>
          <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">{goal.title}</p>
          <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">{measureNames ? `Acompanhando: ${measureNames}.` : "Ainda sem medidas. Toque em Editar para escolher."}</p>
        </section>
        {others.filter((m) => m.kind === "waist").map((m) => <BodyMeasureCard key={m.id} goal={goal} measure={m} today={today} onRecord={() => setRecording(m)} />)}
        {weight ? <WeightCard goal={goal} measure={weight} today={today} onRecord={() => setRecording(weight)} /> : null}
        {others.filter((m) => m.kind !== "waist").map((m) => <BodyMeasureCard key={m.id} goal={goal} measure={m} today={today} onRecord={() => setRecording(m)} />)}
        {training ? <TrainingVsBodyCard goal={goal} view={training} logs={logs} today={today} /> : null}
        <p className="rounded-2xl bg-primary/5 px-4 py-3 text-[12px] leading-[18px] text-muted-foreground">O corpo muda devagar: os primeiros sinais costumam levar algumas semanas. Treinar em dia já é o que conta agora. Você pode remover as medidas quando quiser.</p>
      </div>
      <MeasureSheet key={recording?.id ?? "none"} measure={recording} today={today} open={recording != null} onOpenChange={(o) => { if (!o) setRecording(null); }} />
      {editing ? <EditSheet key={goal.id} goal={goal} open={editing} onOpenChange={setEditing} onArchived={() => navigate("/h/habitos", { replace: true })} /> : null}
    </div>
  );
}
