import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useLogHabit, useProjectAdd, useProjectStart, useStepToggle, type HabitView } from "@/lib/habits/api";
import { hhmm, minutesOf, projectStats } from "@/lib/habits/engine";
import { targetText } from "@/lib/habits/present";

const STEP_BY_UNIT = (v: HabitView): { step: number; quick: number[] } => {
  const u = (v.habit.quantity_unit ?? "").toLowerCase();
  if (v.form === "duration") return { step: 5, quick: [5, 10, 15, 30] };
  if (u.includes("litro")) return { step: 0.25, quick: [0.25, 0.5, 1] };
  if (u.includes("copo")) return { step: 1, quick: [1, 2, 3] };
  if (u.includes("passo")) return { step: 500, quick: [500, 1000, 2000] };
  if (v.form === "ceiling") return { step: u.includes("hora") ? 0.5 : 1, quick: [] };
  return { step: 1, quick: [1, 5, 10] };
};
const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Registro do dia para as formas que não são só "feito": quantidade, duração, horário, teto, valor, projeto, passos e recorrente. */
export function QuickLogSheet({ view, date, open, onOpenChange }: { view: HabitView; date: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const log = useLogHabit();
  const projectAdd = useProjectAdd();
  const projectStart = useProjectStart();
  const stepToggle = useStepToggle();
  const { habit, summary } = view;
  const current = summary.today.quantity ?? 0;
  const { step, quick } = STEP_BY_UNIT(view);
  const [qty, setQty] = useState<number>(current);
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const [pages, setPages] = useState("");
  const [pTitle, setPTitle] = useState("");
  const [pTotal, setPTotal] = useState("");
  const close = () => onOpenChange(false);
  const fail = (e: unknown) => toast.error(hbErrorMessage(e));

  const saveQty = async (value: number, status: "quantity" = "quantity") => {
    try {
      await log.mutateAsync({ habit_id: habit.id, date, status, quantity: value });
      toast.success("Anotado");
      close();
    } catch (e) { fail(e); }
  };
  const saveTime = async () => {
    const m = minutesOf(time);
    if (m == null) return toast.error("Informe o horário.");
    const target = habit.quantity_target ?? 0;
    // Quem deita depois da meia-noite informa 00:30: conta como 24:30 da mesma noite.
    await saveQty(target >= 1080 && m < 720 ? m + 1440 : m);
  };
  const saveValue = async () => {
    const n = Number(text.replace(",", "."));
    if (!(n > 0)) return toast.error("Informe um valor válido.");
    await saveQty(n);
  };
  const skipToday = async () => {
    try { await log.mutateAsync({ habit_id: habit.id, date, status: "skipped" }); close(); } catch (e) { fail(e); }
  };

  const proj = view.project;
  const pStats = proj ? projectStats(proj.total, proj.current, [], date) : null;
  const addPages = async (n: number) => {
    if (!(n > 0)) return;
    try {
      const r = await projectAdd.mutateAsync({ habit_id: habit.id, amount: n, date });
      toast.success(r.finished ? "Projeto concluído. Parabéns." : `Registrado: +${num(r.added)}. Faltam ${num(r.total - r.current)}.`);
      setPages("");
      if (r.finished) close();
    } catch (e) { fail(e); }
  };
  const startProject = async () => {
    const total = Number(pTotal.replace(",", "."));
    if (pTitle.trim().length < 1 || !(total > 0)) return toast.error("Informe o nome e o total.");
    try { await projectStart.mutateAsync({ habit_id: habit.id, title: pTitle.trim(), total, unit: habit.quantity_unit }); setPTitle(""); setPTotal(""); } catch (e) { fail(e); }
  };

  const unit = habit.quantity_unit ?? "";
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="px-5 pb-1 text-left">
            <DrawerTitle className="font-display text-[22px] font-semibold leading-[26px] tracking-[-0.02em]">{habit.title}</DrawerTitle>
            <p className="text-[13px] text-muted-foreground">
              {view.form === "project" ? (proj ? proj.title : "Nenhum projeto em andamento") : view.form === "steps" ? "Marque o que você já fez" : view.form === "recurring" ? "Cuidado recorrente" : `Meta: ${targetText(view)}`}
            </p>
          </DrawerHeader>

          <div className="flex flex-col gap-3 px-5 pt-2">
            {["amount", "duration", "ceiling"].includes(view.form) ? (
              <>
                <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card p-2">
                  <button type="button" aria-label="Menos" onClick={() => setQty(Math.max(0, Math.round((qty - step) * 100) / 100))} className="grid h-10 w-10 place-items-center rounded-full bg-muted text-lg active:scale-95">−</button>
                  <div className="text-center"><p className="font-display text-[28px] font-semibold leading-8 tracking-[-0.03em] tabular-nums">{view.form === "duration" ? num(qty) : num(qty)}</p><p className="text-[12px] text-muted-foreground">{view.form === "duration" ? "minutos hoje" : `${unit} hoje`}</p></div>
                  <button type="button" aria-label="Mais" onClick={() => setQty(Math.round((qty + step) * 100) / 100)} className="grid h-10 w-10 place-items-center rounded-full bg-muted text-lg active:scale-95">+</button>
                </div>
                {quick.length > 0 ? <div className="flex gap-1.5">{quick.map((n) => <button key={n} type="button" onClick={() => setQty(Math.round((qty + n) * 100) / 100)} className="h-9 flex-1 rounded-full border border-border bg-card text-[14px] font-medium active:scale-95">+{num(n)}</button>)}</div> : null}
                <Button className="h-12 rounded-full text-[15px] font-medium" disabled={log.isPending} onClick={() => void saveQty(qty)}>{log.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Salvar"}</Button>
                {view.form === "ceiling" ? <Button variant="outline" className="h-11 rounded-full" disabled={log.isPending} onClick={() => void saveQty(0)}>Nada hoje</Button> : null}
              </>
            ) : null}

            {view.form === "time" ? (
              <>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Horário" className="h-14 rounded-2xl border border-border/70 bg-card px-4 text-center font-display text-[28px] font-semibold tabular-nums outline-none focus:border-primary" />
                <p className="text-center text-[12px] text-muted-foreground">Meta: {targetText(view)}{current ? ` · hoje: ${hhmm(current)}` : ""}</p>
                <Button className="h-12 rounded-full text-[15px] font-medium" disabled={log.isPending} onClick={() => void saveTime()}>Salvar</Button>
              </>
            ) : null}

            {view.form === "value" ? (
              <>
                <input value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" placeholder={current ? num(current) : "Valor de hoje"} aria-label="Valor" className="h-14 rounded-2xl border border-border/70 bg-card px-4 text-center font-display text-[28px] font-semibold tabular-nums outline-none focus:border-primary" />
                <p className="text-center text-[12px] text-muted-foreground">{unit}</p>
                <Button className="h-12 rounded-full text-[15px] font-medium" disabled={log.isPending} onClick={() => void saveValue()}>Salvar</Button>
              </>
            ) : null}

            {view.form === "project" ? (
              proj && pStats ? (
                <>
                  <div className="rounded-2xl border border-border/60 bg-card p-3.5">
                    <div className="flex items-baseline justify-between"><p className="font-display text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{num(proj.current)}<span className="text-[14px] font-normal text-muted-foreground"> de {num(proj.total)} {proj.unit ?? ""}</span></p><p className="text-[13px] text-muted-foreground">{pStats.percent}%</p></div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted"><i className="block h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pStats.percent}%` }} /></div>
                  </div>
                  <div className="flex gap-1.5">{(proj.unit === "R$" ? [50, 100, 200, 500] : [5, 10, 20, 30]).map((n) => <button key={n} type="button" onClick={() => void addPages(n)} disabled={projectAdd.isPending} className="h-10 flex-1 rounded-full border border-border bg-card text-[14px] font-medium active:scale-95">+{n}</button>)}</div>
                  <div className="flex gap-2">
                    <input value={pages} onChange={(e) => setPages(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" placeholder={`Outro valor (${proj.unit ?? ""})`} aria-label="Avanço" className="h-11 min-w-0 flex-1 rounded-xl border border-border/70 bg-card px-3.5 text-[15px] outline-none focus:border-primary" />
                    <Button className="h-11 rounded-full px-5" disabled={projectAdd.isPending} onClick={() => void addPages(Number(pages.replace(",", ".")))}>Registrar</Button>
                  </div>
                </>
              ) : (
                <>
                  <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Nome do novo projeto" aria-label="Nome do projeto" maxLength={120} className="h-11 rounded-xl border border-border/70 bg-card px-3.5 text-[15px] outline-none focus:border-primary" />
                  <input value={pTotal} onChange={(e) => setPTotal(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" placeholder={`Total (${unit})`} aria-label="Total" className="h-11 rounded-xl border border-border/70 bg-card px-3.5 text-[15px] outline-none focus:border-primary" />
                  <Button className="h-12 rounded-full text-[15px] font-medium" disabled={projectStart.isPending} onClick={() => void startProject()}>Começar projeto</Button>
                </>
              )
            ) : null}

            {view.form === "steps" ? (
              <ul className="flex flex-col gap-1.5">
                {view.steps.map((s) => {
                  const on = view.steps_today.includes(s.id);
                  return (
                    <li key={s.id}>
                      <button type="button" aria-pressed={on} disabled={stepToggle.isPending} onClick={() => stepToggle.mutate({ habit_id: habit.id, step_id: s.id, date, done: !on }, { onError: fail })} className={cn("flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors", on ? "border-success/40 bg-success/10" : "border-border/60 bg-card")}>
                        <span className={cn("grid h-[22px] w-[22px] place-items-center rounded-full border-2", on ? "border-success bg-success text-success-foreground" : "border-border")} aria-hidden="true">{on ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg> : null}</span>
                        <span className={cn("flex-1 text-[15px] font-medium", on && "text-muted-foreground line-through")}>{s.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {view.form === "recurring" ? (
              <Button className="h-12 rounded-full text-[15px] font-medium" disabled={log.isPending} onClick={async () => { try { await log.mutateAsync({ habit_id: habit.id, date, status: "done" }); toast.success("Anotado. Eu marco o próximo."); close(); } catch (e) { fail(e); } }}>Fiz hoje</Button>
            ) : null}

            {!["steps", "recurring", "project"].includes(view.form) ? <button type="button" onClick={() => void skipToday()} className="h-10 text-[13px] text-muted-foreground">Hoje não deu</button> : null}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

