import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/hb/ui";
import { RelapseSheet } from "@/components/hb/RelapseSheet";
import { hbErrorMessage, useArchiveHabit, useCraving, useCravingAnswer, useHabitViews, useQuitMoney } from "@/lib/habits/api";
import { QUIT_MILESTONES } from "@/lib/habits/engine";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

export default function Largar() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { quitViews, today, isLoading } = useHabitViews();
  const view = quitViews.find((v) => v.habit.id === id);
  const money = useQuitMoney(!!view);
  const craving = useCraving();
  const answer = useCravingAnswer();
  const archive = useArchiveHabit();
  const [relapseOpen, setRelapseOpen] = useState(false);
  const [cravingId, setCravingId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (isLoading || !today) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;
  if (!view) {
    return <div className="px-4"><PageHeader title="Hábito não encontrado" back="/h/habitos" /><p className="text-sm text-muted-foreground">Ele pode ter sido arquivado.</p></div>;
  }
  const { habit, stats } = view;
  const est = money.data?.[habit.id];

  const onCraving = async () => {
    try {
      setCravingId(await craving.mutateAsync({ habit_id: habit.id }));
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const closeCraving = async (handled: boolean) => {
    const cid = cravingId;
    setCravingId(null);
    if (!cid) return;
    try {
      await answer.mutateAsync({ craving_id: cid, handled });
      if (handled) toast.success("Isso conta. A vontade passou e você seguiu.");
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const doArchive = async () => {
    try {
      await archive.mutateAsync(habit.id);
      toast.success("Hábito arquivado");
      navigate("/h/habitos", { replace: true });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };

  return (
    <div className="px-4 pb-6">
      <PageHeader title={habit.title} subtitle="Largando" back="/h/habitos" />

      <section className="rounded-3xl bg-gradient-hero p-6 text-primary-foreground shadow-hero" aria-label="Dias sem">
        <p className="text-[14px] font-medium text-white/75">Dias sem</p>
        <p className="mt-1 font-display text-[88px] font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums">{stats.days_clean}</p>
        <p className="mt-2 text-[13px] text-white/80">
          {stats.next_milestone != null ? `Próximo marco: ${dias(stats.next_milestone)}` : "Você passou de 1 ano. Isso é seu."}
        </p>
      </section>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-card p-3 text-center shadow-card">
        {[{ k: "recorde", v: dias(stats.best) }, { k: "total sem", v: dias(stats.total_days_clean) }, { k: "recomeços", v: String(stats.relapses) }].map((i) => (
          <div key={i.k}><dd className="font-display text-lg font-semibold tabular-nums">{i.v}</dd><dt className="text-[11px] text-muted-foreground">{i.k}</dt></div>
        ))}
      </dl>

      <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Marcos">
        <h2 className="text-[13px] font-medium text-muted-foreground">Marcos</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {QUIT_MILESTONES.map((m) => <li key={m} className={cn("rounded-full border px-3 py-1 text-xs font-medium tabular-nums", stats.days_clean >= m ? "border-success bg-success/15 text-foreground" : "border-border text-muted-foreground")}>{m}</li>)}
        </ul>
      </section>

      <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Dinheiro">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-muted-foreground">Dinheiro que ficou com você</h2>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">estimativa</span>
        </div>
        {est?.estimate != null ? (
          <>
            <p className="mt-2 font-display text-[30px] font-semibold leading-none tabular-nums">{brl(est.estimate)}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {est.source === "nino_data"
                ? `Calculado pela sua média de ${brl(est.baseline_daily_cost ?? 0)} por dia antes de começar, menos o que você gastou na categoria desde então.`
                : `Calculado com o valor que você informou: ${brl(est.baseline_daily_cost ?? 0)} por dia.`}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm leading-5 text-muted-foreground">Sem base para estimar ainda. Quando houver gastos suficientes da categoria, ou um valor informado por você, eu mostro aqui.</p>
        )}
      </section>

      {habit.craving_plan ? (
        <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Plano para a vontade">
          <h2 className="text-[13px] font-medium text-muted-foreground">Quando bater a vontade</h2>
          <p className="mt-2 text-[15px] leading-6">{habit.craving_plan}</p>
        </section>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <Button className="h-12 rounded-full text-[15px] font-semibold" disabled={craving.isPending} onClick={() => void onCraving()}>Bateu a vontade</Button>
        <Button variant="outline" className="h-12 rounded-full text-[15px] font-semibold" onClick={() => setRelapseOpen(true)}>Eu escorreguei</Button>
      </div>
      {stats.cravings_30 > 0 ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {stats.cravings_30} {stats.cravings_30 === 1 ? "vontade" : "vontades"} em 30 dias{stats.craving_handled_rate != null ? `, ${Math.round(stats.craving_handled_rate * 100)}% você atravessou` : ""}.
        </p>
      ) : null}
      {habit.sensitivity !== "normal" ? <p className="mt-3 text-center text-xs text-muted-foreground">Se estiver difícil, o CVV atende 24 horas pelo 188.</p> : null}

      <Button variant="ghost" className="mt-4 h-11 w-full rounded-full text-muted-foreground" onClick={() => setConfirmArchive(true)}>Arquivar este hábito</Button>

      <RelapseSheet habitId={habit.id} title={habit.title} open={relapseOpen} onOpenChange={setRelapseOpen} />

      <Drawer open={cravingId != null} onOpenChange={(o) => !o && setCravingId(null)}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <DrawerHeader className="text-left">
              <DrawerTitle className="font-display text-xl">A vontade passa</DrawerTitle>
              <p className="text-sm text-muted-foreground">{habit.craving_plan ?? "Espere 10 minutos antes de decidir. A maioria das vontades diminui nesse tempo."}</p>
            </DrawerHeader>
            <div className="flex flex-col gap-2 px-4">
              <Button className="h-12 rounded-full text-[15px] font-semibold" onClick={() => void closeCraving(true)}>Passou, segui firme</Button>
              <Button variant="outline" className="h-12 rounded-full text-[15px] font-semibold" onClick={() => { void closeCraving(false); setRelapseOpen(true); }}>Eu cedi</Button>
              <Button variant="ghost" className="h-11 rounded-full text-muted-foreground" onClick={() => setCravingId(null)}>Responder depois</Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar “{habit.title}”?</AlertDialogTitle>
            <AlertDialogDescription>A contagem para e o histórico fica guardado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void doArchive()}>Arquivar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
