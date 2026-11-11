import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AreaTile, RowCard, SectionLabel, Steps } from "@/components/hb/kit";
import { ConsentSheet } from "@/components/hb/ConsentSheet";
import { hbErrorMessage, useCreateHabit, useExpenseCategories, useHabitViews, useHbTemplates, useSuggestPlan, type HbArea } from "@/lib/habits/api";
import {
  draftError, draftToInput, EMPTY, EMPTY_QUIT, fromTemplate, needsConsent, quitDraftError, quitDraftToInput, quitFromTemplate, type Draft, type QuitDraft,
} from "@/lib/habits/draft";

const AREAS: Array<[HbArea, string]> = [["body", "Corpo"], ["mind", "Mente"], ["routine", "Rotina"], ["money", "Dinheiro"], ["other", "Outro"]];
const DAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const CUE_EXAMPLES = ["Ao acordar", "Depois do café", "Depois do almoço", "Antes de dormir"];
const STEP_TITLES = ["Quando você vai fazer?", "E nos dias difíceis?", "Como vai funcionar?"];

function Back({ onClick, to }: { onClick?: () => void; to?: string }) {
  const cls = "-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted";
  return to ? <Link to={to} aria-label="Voltar" className={cls}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>
    : <button type="button" aria-label="Voltar" onClick={onClick} className={cls}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>;
}

export default function Novo() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const templates = useHbTemplates();
  const create = useCreateHabit();
  const { consent } = useHabitViews();
  const [step, setStep] = useState<"choose" | "plan" | "quit">("choose");
  const [sub, setSub] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [q, setQ] = useState<QuitDraft>(EMPTY_QUIT);
  const [consentOpen, setConsentOpen] = useState(false);
  const categories = useExpenseCategories(step === "quit");
  const suggest = useSuggestPlan();
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const setQuit = (patch: Partial<QuitDraft>) => setQ((prev) => ({ ...prev, ...patch }));
  const err = draftError(d);
  const quitErr = quitDraftError(q);

  // Atalho vindo da tela Hoje: /h/novo?t=meditar-5 já abre o plano do modelo escolhido.
  const wanted = params.get("t");
  useEffect(() => {
    if (!wanted || step !== "choose") return;
    const t = (templates.data ?? []).find((x) => x.slug === wanted);
    if (!t) return;
    if (t.kind === "quit") { setQ(quitFromTemplate(t)); setStep("quit"); } else { setD(fromTemplate(t)); setSub(0); setStep("plan"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, templates.data]);

  const askSuggestion = async () => {
    try {
      const r = await suggest.mutateAsync(d.title.trim());
      const p = r.plan;
      if (!p.cue_text && !p.minimum_text) return toast.message("Não tenho sugestão para este hábito. Pode preencher do seu jeito.");
      set({ cue_text: d.cue_text || p.cue_text || "", minimum_text: d.minimum_text || p.minimum_text || "" });
      toast.success("Sugestão preenchida. Ajuste como preferir.");
    } catch {
      toast.message("Não consegui sugerir agora. Pode preencher do seu jeito.");
    }
  };

  const submit = async () => {
    if (err) return toast.error(err);
    try {
      await create.mutateAsync(draftToInput(d));
      toast.success(d.start_today ? "Hábito criado. Comece hoje." : "Hábito criado. Começa amanhã.");
      navigate("/h/hoje", { replace: true });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const submitQuit = async (granted = false) => {
    if (quitErr) return toast.error(quitErr);
    if (needsConsent(q) && !consent && !granted) return setConsentOpen(true);
    try {
      await create.mutateAsync(quitDraftToInput(q));
      toast.success("Pronto. A contagem começou hoje.");
      navigate("/h/hoje", { replace: true });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };

  const chip = (on: boolean) => cn("min-h-11 rounded-full border px-4 text-sm font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted");

  // ---------------------------------------------------------------- escolher
  if (step === "choose") {
    const doing = (templates.data ?? []).filter((t) => t.kind !== "quit");
    const quitting = (templates.data ?? []).filter((t) => t.kind === "quit");
    return (
      <div className="px-4 pb-8">
        <div className="pt-3"><Back to="/h/hoje" /></div>
        <h1 className="mt-1 font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.025em]">O que você quer que vire rotina?</h1>
        <p className="mt-2 text-[15px] leading-6 text-muted-foreground">Comece com um só. Dois ou três ao mesmo tempo é o que mais derruba.</p>
        {templates.isLoading ? (
          <div className="grid min-h-[30vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>
        ) : (
          <>
            <SectionLabel className="mt-6">Começar a fazer</SectionLabel>
            <ul className="flex flex-col gap-2">
              {doing.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => { setD(fromTemplate(t)); setSub(0); setStep("plan"); }} className="block w-full text-left" aria-label={t.title}>
                    <RowCard lead={<AreaTile area={t.area} title={t.title} />} title={t.title} hint={t.minimum_suggestion ? `Dia ruim: ${t.minimum_suggestion}` : t.why_it_works} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => { setD(EMPTY); setSub(0); setStep("plan"); }} className="mt-3 flex h-12 w-full items-center justify-center rounded-full border border-dashed border-primary/40 text-[15px] font-medium text-primary transition-colors hover:bg-primary/5">Criar o meu próprio</button>

            <SectionLabel>Largar algo</SectionLabel>
            <ul className="flex flex-col gap-2">
              {quitting.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => { setQ(quitFromTemplate(t)); setStep("quit"); }} className="block w-full text-left" aria-label={t.title}>
                    <RowCard lead={<AreaTile area={t.area} title={t.title} />} title={t.title} hint={t.why_it_works} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => { setQ(EMPTY_QUIT); setStep("quit"); }} className="mt-3 flex h-12 w-full items-center justify-center rounded-full border border-dashed border-primary/40 text-[15px] font-medium text-primary transition-colors hover:bg-primary/5">Largar outra coisa</button>
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- largar
  if (step === "quit") {
    return (
      <div className="px-4 pb-8">
        <div className="pt-3"><Back onClick={() => setStep("choose")} /></div>
        <h1 className="mt-1 font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.025em]">Largar com um plano</h1>
        <p className="mt-2 text-[15px] leading-6 text-muted-foreground">A contagem começa hoje. Se escorregar, você recomeça sem perder o recorde.</p>
        <div className="mt-6 flex flex-col gap-6">
          <div>
            <Label htmlFor="hb-q-title" className="text-[15px] font-medium">O que você quer largar?</Label>
            <Input id="hb-q-title" value={q.title} maxLength={80} onChange={(e) => setQuit({ title: e.target.value })} placeholder="Ex.: delivery por impulso" className="mt-2 h-14 rounded-2xl text-base" />
          </div>
          <div>
            <Label htmlFor="hb-q-plan" className="text-[15px] font-medium">Quando bater a vontade, eu vou…</Label>
            <Input id="hb-q-plan" value={q.craving_plan} maxLength={160} onChange={(e) => setQuit({ craving_plan: e.target.value })} placeholder="beber água e esperar 10 minutos" className="mt-2 h-14 rounded-2xl text-base" />
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">Decidir antes ajuda mais do que contar com força de vontade na hora.</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
            <p className="text-[15px] font-medium">Quanto isso custa? <span className="font-normal text-muted-foreground">(opcional)</span></p>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Eu mostro uma estimativa do que ficou com você. Escolha uma categoria para usar a sua média real, ou informe um valor por dia.</p>
            <select
              aria-label="Categoria de gasto"
              value={q.category_id}
              onChange={(e) => setQuit({ category_id: e.target.value, category_label: (categories.data ?? []).find((c) => c.id === e.target.value)?.name ?? "" })}
              className="mt-3 h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem categoria</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Input aria-label="Gasto por dia" inputMode="decimal" value={q.daily_cost} onChange={(e) => setQuit({ daily_cost: e.target.value })} placeholder="Gasto por dia, em reais" className="mt-2 h-12 rounded-xl" />
          </div>
          <Button className="h-14 rounded-full text-base font-medium" disabled={create.isPending} onClick={() => void submitQuit(false)}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Começar a contagem"}
          </Button>
          {quitErr && q.title ? <p className="-mt-3 text-center text-[13px] text-muted-foreground">{quitErr}</p> : null}
        </div>
        <ConsentSheet open={consentOpen} onOpenChange={setConsentOpen} onGranted={() => { setConsentOpen(false); void submitQuit(true); }} />
      </div>
    );
  }

  // ---------------------------------------------------------------- plano em 3 passos
  const last = sub === 2;
  const canNext = sub === 0 ? d.title.trim().length >= 2 : true;
  return (
    <div className="px-4 pb-8">
      <div className="flex items-center gap-3 pt-3">
        <Back onClick={() => (sub === 0 ? setStep("choose") : setSub(sub - 1))} />
        <div className="flex-1"><Steps current={sub} total={3} /></div>
      </div>
      <h1 className="mt-4 font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.025em]">{STEP_TITLES[sub]}</h1>

      <div className="mt-6 flex flex-col gap-6">
        {sub === 0 ? (
          <>
            <div>
              <Label htmlFor="hb-n-title" className="text-[15px] font-medium">Nome do hábito</Label>
              <Input id="hb-n-title" value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Meditar 5 min" className="mt-2 h-14 rounded-2xl text-base" />
              <button type="button" disabled={suggest.isPending || d.title.trim().length < 2} onClick={() => void askSuggestion()} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[14px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-40">
                {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}Sugerir gatilho e versão mínima (IA)
              </button>
            </div>
            <div>
              <Label htmlFor="hb-n-cue" className="text-[15px] font-medium">Em que momento do dia?</Label>
              <Input id="hb-n-cue" aria-label="Momento do dia" value={d.cue_text} maxLength={110} onChange={(e) => set({ cue_text: e.target.value })} placeholder="Depois de tomar café" className="mt-2 h-14 rounded-2xl text-base" />
              <div className="mt-3 flex flex-wrap gap-2">
                {CUE_EXAMPLES.map((c) => <button key={c} type="button" onClick={() => set({ cue_text: c })} className={chip(d.cue_text === c)}>{c}</button>)}
              </div>
              <p className="mt-3 text-[13px] leading-5 text-muted-foreground">Ligar o hábito a algo que você já faz todo dia ajuda mais do que um alarme.</p>
            </div>
          </>
        ) : null}

        {sub === 1 ? (
          <>
            <div>
              <Label htmlFor="hb-n-min" className="text-[15px] font-medium">Se o dia estiver ruim, eu faço só…</Label>
              <Input id="hb-n-min" value={d.minimum_text} maxLength={120} onChange={(e) => set({ minimum_text: e.target.value })} placeholder="3 respirações" className="mt-2 h-14 rounded-2xl text-base" />
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">A versão mínima conta como feito e mantém o hábito vivo.</p>
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium">Frequência</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Frequência">
                <button type="button" className={chip(d.cadence === "daily")} aria-pressed={d.cadence === "daily"} onClick={() => set({ cadence: "daily" })}>Todo dia</button>
                <button type="button" className={chip(d.cadence === "weekly")} aria-pressed={d.cadence === "weekly"} onClick={() => set({ cadence: "weekly" })}>X por semana</button>
                <button type="button" className={chip(d.cadence === "quantity")} aria-pressed={d.cadence === "quantity"} onClick={() => set({ cadence: "quantity" })}>Quantidade</button>
              </div>
              {d.cadence === "daily" ? (
                <div className="mt-4">
                  <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Dias da semana (vazio = todos)">
                    {DAYS.map((l, i) => {
                      const on = d.days.includes(i);
                      return <button key={i} type="button" aria-pressed={on} aria-label={DAY_NAMES[i]} onClick={() => set({ days: on ? d.days.filter((x) => x !== i) : [...d.days, i].sort() })} className={cn("h-12 rounded-xl border text-sm font-medium transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted")}>{l}</button>;
                    })}
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">Sem escolher nenhum, vale todos os dias.</p>
                </div>
              ) : null}
              {d.cadence === "weekly" ? (
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-border/60 bg-card p-3 shadow-card">
                  <Button type="button" variant="outline" className="h-12 w-12 rounded-full text-lg" aria-label="Menos" onClick={() => set({ weekly_target: Math.max(1, d.weekly_target - 1) })}>−</Button>
                  <span className="font-display text-xl font-semibold tabular-nums">{d.weekly_target}x por semana</span>
                  <Button type="button" variant="outline" className="h-12 w-12 rounded-full text-lg" aria-label="Mais" onClick={() => set({ weekly_target: Math.min(7, d.weekly_target + 1) })}>+</Button>
                </div>
              ) : null}
              {d.cadence === "quantity" ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Input type="number" inputMode="decimal" min={0} step="any" aria-label="Meta" value={d.quantity_target} onChange={(e) => set({ quantity_target: e.target.value })} placeholder="Meta" className="h-12 rounded-xl" />
                  <Input aria-label="Unidade" value={d.quantity_unit} maxLength={20} onChange={(e) => set({ quantity_unit: e.target.value })} placeholder="páginas" className="h-12 rounded-xl" />
                  <div className="col-span-2 flex gap-2" role="group" aria-label="Período">
                    <button type="button" aria-pressed={d.quantity_period === "day"} onClick={() => set({ quantity_period: "day" })} className={cn(chip(d.quantity_period === "day"), "flex-1")}>por dia</button>
                    <button type="button" aria-pressed={d.quantity_period === "week"} onClick={() => set({ quantity_period: "week" })} className={cn(chip(d.quantity_period === "week"), "flex-1")}>por semana</button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {sub === 2 ? (
          <>
            {d.cadence !== "weekly" && !(d.cadence === "quantity" && d.quantity_period === "week") ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card">
                <div className="min-w-0"><p className="text-[15px] font-medium">Folgas por semana</p><p className="text-[13px] leading-5 text-muted-foreground">Um dia de folga não quebra a sequência.</p></div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" className="h-11 w-11 rounded-full" aria-label="Menos folgas" onClick={() => set({ rest_per_week: Math.max(0, d.rest_per_week - 1) })}>−</Button>
                  <span className="w-5 text-center font-display text-lg font-semibold tabular-nums">{d.rest_per_week}</span>
                  <Button type="button" variant="outline" className="h-11 w-11 rounded-full" aria-label="Mais folgas" onClick={() => set({ rest_per_week: Math.min(3, d.rest_per_week + 1) })}>+</Button>
                </div>
              </div>
            ) : null}
            <div>
              <p className="mb-2 text-[15px] font-medium">Começar</p>
              <div className="flex gap-2" role="group" aria-label="Início">
                <button type="button" className={cn(chip(!d.start_today), "flex-1")} aria-pressed={!d.start_today} onClick={() => set({ start_today: false })}>Amanhã</button>
                <button type="button" className={cn(chip(d.start_today), "flex-1")} aria-pressed={d.start_today} onClick={() => set({ start_today: true })}>Hoje</button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium">Área</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Área">
                {AREAS.map(([a, label]) => <button key={a} type="button" className={chip(d.area === a)} aria-pressed={d.area === a} onClick={() => set({ area: a })}>{label}</button>)}
              </div>
            </div>
            <div className="rounded-2xl bg-primary/5 p-4 text-[14px] leading-6">
              <p className="font-medium">{d.title.trim() || "Seu hábito"}</p>
              <p className="text-muted-foreground">{[d.cue_text.trim(), d.minimum_text.trim() ? `Dia ruim: ${d.minimum_text.trim()}` : ""].filter(Boolean).join(" · ") || "Você pode ajustar o plano depois."}</p>
            </div>
          </>
        ) : null}

        <Button
          className="h-14 rounded-full text-base font-medium"
          disabled={create.isPending || !canNext}
          onClick={() => (last ? void submit() : setSub(sub + 1))}
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : last ? "Criar hábito" : "Continuar"}
        </Button>
        {last && err && d.title ? <p className="-mt-3 text-center text-[13px] text-muted-foreground">{err}</p> : null}
      </div>
    </div>
  );
}
