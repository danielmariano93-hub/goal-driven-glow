import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useProjectUpdate, useUpdateHabit, type HabitView } from "@/lib/habits/api";
import { hhmm, minutesOf } from "@/lib/habits/engine";
import { ANCHORS, composeCue, normalizeCue, PERIODS, splitCue, switchPeriod } from "@/lib/habits/period";

const DAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const toNum = (t: string) => Number(t.replace(",", "."));
const numText = (n: number | null | undefined) => (n == null ? "" : String(Math.round(n * 100) / 100).replace(".", ","));

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div><Label>{label}</Label><div className="mt-1">{children}</div>{hint ? <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{hint}</p> : null}</div>
);

/** Edição de tudo que faz sentido mudar num hábito. O histórico não é alterado. */
export function EditPlanSheet({ view, today, open, onOpenChange }: { view: HabitView; today: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { habit, form } = view;
  const update = useUpdateHabit();
  const projUpdate = useProjectUpdate();
  const lateTime = form === "time" && (habit.quantity_target ?? 0) >= 1080;
  const [title, setTitle] = useState(habit.title);
  const [cue, setCue] = useState(normalizeCue(habit.cue_text));
  const [minimum, setMinimum] = useState(habit.minimum_text ?? "");
  const [weekly, setWeekly] = useState(String(habit.weekly_target ?? 3));
  const [target, setTarget] = useState(form === "time" ? hhmm((habit.quantity_target ?? 0) % 1440) : numText(habit.quantity_target));
  const [unit, setUnit] = useState(habit.quantity_unit ?? "");
  const [interval, setIntervalDays] = useState(String(habit.interval_days ?? 30));
  const [days, setDays] = useState<number[]>(habit.days_of_week ?? []);
  const [rest, setRest] = useState(habit.rest_per_week);
  const [since, setSince] = useState(habit.started_on);
  const [projTitle, setProjTitle] = useState(view.project?.title ?? "");
  const [projTotal, setProjTotal] = useState(numText(view.project?.total));
  const [projCurrent, setProjCurrent] = useState(numText(view.project?.current));
  const parts = splitCue(cue);

  const isWeekly = form === "weekly";
  const isRecurring = form === "recurring";
  const dailyModel = !isWeekly && !isRecurring;
  const hasTarget = ["amount", "duration", "ceiling", "project"].includes(form);
  const hasUnit = ["amount", "ceiling", "value"].includes(form);

  const save = async () => {
    const patch: Parameters<typeof update.mutateAsync>[0]["patch"] = {};
    if (title.trim() !== habit.title) patch.title = title.trim();
    if (cue !== (habit.cue_text ?? "")) { patch.cue_text = cue || null; patch.cue_kind = cue ? (parts.anchor ? "after_event" : "free") : null; }
    if (minimum.trim() !== (habit.minimum_text ?? "")) patch.minimum_text = minimum.trim() || null;
    if (isWeekly) {
      const w = Math.round(toNum(weekly));
      if (!(w >= 1 && w <= 7)) return toast.error("Escolha de 1 a 7 vezes por semana.");
      if (w !== habit.weekly_target) patch.weekly_target = w;
    }
    if (hasTarget || form === "time") {
      let t: number;
      if (form === "time") {
        const m = minutesOf(target);
        if (m == null) return toast.error("Informe o horário.");
        t = lateTime && m < 720 ? m + 1440 : m;
      } else {
        t = toNum(target);
        if (!(t > 0) && !(t === 0 && form === "ceiling")) return toast.error("Informe uma meta maior que zero.");
      }
      if (t !== (habit.quantity_target ?? 0)) patch.quantity_target = t;
    }
    if (hasUnit && unit.trim() !== (habit.quantity_unit ?? "")) patch.quantity_unit = unit.trim().slice(0, 20) || null;
    if (isRecurring) {
      const n = Math.round(toNum(interval));
      if (!(n >= 1 && n <= 3650)) return toast.error("Informe o intervalo em dias.");
      if (n !== habit.interval_days) patch.interval_days = n;
    }
    if (dailyModel) {
      const a = [...days].sort().join(",");
      const b = [...(habit.days_of_week ?? [])].sort().join(",");
      if (a !== b) patch.days_of_week = days.length === 0 || days.length === 7 ? null : days;
      if (rest !== habit.rest_per_week) patch.rest_per_week = rest;
    }
    if (since !== habit.started_on) {
      if (since > today) return toast.error("O início não pode ser no futuro.");
      patch.started_on = since;
    }
    try {
      if (Object.keys(patch).length > 0) await update.mutateAsync({ id: habit.id, patch });
      if (view.project && (projTitle.trim() !== view.project.title || toNum(projTotal) !== view.project.total || toNum(projCurrent) !== view.project.current)) {
        const total = toNum(projTotal);
        const current = toNum(projCurrent);
        if (!(total > 0)) return toast.error("Informe o total do projeto.");
        if (!(current >= 0) || current > total) return toast.error("O avanço precisa estar entre 0 e o total.");
        await projUpdate.mutateAsync({ id: view.project.id, title: projTitle.trim() || undefined, total, current });
      }
      toast.success("Plano atualizado");
      onOpenChange(false);
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };

  const chip = (on: boolean) => cn("min-h-11 rounded-xl border px-1 text-[12px] font-medium leading-4 transition-colors", on ? "border-primary bg-primary/5 text-primary" : "border-border/60 bg-card");
  const busy = update.isPending || projUpdate.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left"><DrawerTitle className="font-display text-lg">Editar o plano</DrawerTitle></DrawerHeader>
          <div className="flex flex-col gap-4 px-4">
            <Field label="Nome"><Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-2xl" /></Field>

            {isWeekly ? (
              <Field label="Quantas vezes por semana">
                <div className="flex items-center gap-2">
                  <button type="button" aria-label="Menos" onClick={() => setWeekly(String(Math.max(1, Math.round(toNum(weekly)) - 1)))} className="grid h-11 w-12 place-items-center rounded-full bg-muted text-lg active:scale-95">−</button>
                  <p className="flex-1 text-center font-display text-[24px] font-semibold tabular-nums">{weekly}</p>
                  <button type="button" aria-label="Mais" onClick={() => setWeekly(String(Math.min(7, Math.round(toNum(weekly)) + 1)))} className="grid h-11 w-12 place-items-center rounded-full bg-muted text-lg active:scale-95">+</button>
                </div>
              </Field>
            ) : null}

            {hasTarget ? (
              <Field label={form === "duration" ? "Meta em minutos" : form === "ceiling" ? "Limite por dia" : form === "project" ? "Meta por dia" : "Meta por dia"}>
                <Input value={target} inputMode="decimal" onChange={(e) => setTarget(e.target.value.replace(/[^0-9.,]/g, ""))} className="h-11 rounded-2xl" />
              </Field>
            ) : null}
            {form === "time" ? (
              <Field label="Horário alvo" hint={lateTime ? "Depois da meia-noite vale como a mesma noite (00:30 = 24:30)." : undefined}>
                <Input type="time" value={target} onChange={(e) => setTarget(e.target.value)} className="h-11 rounded-2xl" />
              </Field>
            ) : null}
            {hasUnit ? (
              <Field label="Unidade"><Input value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} placeholder="litros, copos, kg..." className="h-11 rounded-2xl" /></Field>
            ) : null}
            {isRecurring ? (
              <Field label="Repetir a cada quantos dias"><Input value={interval} inputMode="numeric" onChange={(e) => setIntervalDays(e.target.value.replace(/[^0-9]/g, ""))} className="h-11 rounded-2xl" /></Field>
            ) : null}
            {view.project ? (
              <>
                <Field label="Nome do projeto"><Input value={projTitle} maxLength={120} onChange={(e) => setProjTitle(e.target.value)} className="h-11 rounded-2xl" /></Field>
                <Field label={`Total (${view.project.unit ?? ""})`}><Input value={projTotal} inputMode="decimal" onChange={(e) => setProjTotal(e.target.value.replace(/[^0-9.,]/g, ""))} className="h-11 rounded-2xl" /></Field>
                <Field label={`Onde você está agora (${view.project.unit ?? ""})`} hint="Corrige o avanço se você anotou errado."><Input value={projCurrent} inputMode="decimal" onChange={(e) => setProjCurrent(e.target.value.replace(/[^0-9.,]/g, ""))} className="h-11 rounded-2xl" /></Field>
              </>
            ) : null}

            <Field label="Em que parte do dia">
              <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Momento do dia">
                {PERIODS.map((p) => <button key={p.id} type="button" aria-pressed={parts.period === p.id} onClick={() => setCue(switchPeriod(cue, p.id))} className={chip(parts.period === p.id)}>{p.id}</button>)}
              </div>
              {parts.period && ANCHORS[parts.period].length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Ligar a algo que você já faz">
                  {ANCHORS[parts.period].map((a) => <button key={a} type="button" aria-pressed={parts.anchor.toLowerCase() === a} onClick={() => setCue(composeCue(parts.period, parts.anchor.toLowerCase() === a ? "" : a))} className={cn("min-h-9 rounded-full border px-3 text-[12px] font-medium transition-colors", parts.anchor.toLowerCase() === a ? "border-primary bg-primary/5 text-primary" : "border-border/60 bg-card")}>{a[0].toUpperCase() + a.slice(1)}</button>)}
                </div>
              ) : null}
              <Input value={parts.anchor} disabled={!parts.period} maxLength={80} onChange={(e) => setCue(composeCue(parts.period, e.target.value))} placeholder="Ou escreva o seu gatilho (opcional)" aria-label="Ligar a algo que você já faz (opcional)" className="mt-2 h-11 rounded-2xl" />
            </Field>

            {dailyModel ? (
              <Field label="Em quais dias" hint={days.length === 0 || days.length === 7 ? "Todos os dias" : undefined}>
                <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Dias da semana">
                  {DAY_LETTERS.map((l, i) => <button key={i} type="button" aria-label={DAY_NAMES[i]} aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={chip(days.includes(i))}>{l}</button>)}
                </div>
              </Field>
            ) : null}
            {dailyModel ? (
              <Field label="Folgas por semana" hint="Dias de descanso que não quebram a sequência.">
                <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Folgas por semana">
                  {[0, 1, 2, 3].map((n) => <button key={n} type="button" aria-pressed={rest === n} onClick={() => setRest(n)} className={chip(rest === n)}>{n}</button>)}
                </div>
              </Field>
            ) : null}

            <Field label="Versão mínima (dia ruim)"><Input value={minimum} maxLength={120} onChange={(e) => setMinimum(e.target.value)} placeholder="3 respirações" className="h-11 rounded-2xl" /></Field>
            <Field label="Fazendo desde" hint="Pode ser uma data anterior, se você já fazia antes de criar aqui.">
              <input type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} aria-label="Fazendo desde" className="h-11 w-full rounded-2xl border border-border/70 bg-card px-4" />
            </Field>

            <Button className="h-11 rounded-full text-[14px] font-semibold" disabled={busy || title.trim().length < 2} onClick={() => void save()}>Salvar</Button>
            <p className="text-center text-xs text-muted-foreground">Mudar o plano não altera o seu histórico.</p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
