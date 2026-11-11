import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/hb/ui";
import { ConsentSheet } from "@/components/hb/ConsentSheet";
import { hbErrorMessage, useCreateHabit, useExpenseCategories, useHabitViews, useHbTemplates, useSuggestPlan, type HbArea } from "@/lib/habits/api";
import {
  draftError, draftToInput, EMPTY, EMPTY_QUIT, fromTemplate, needsConsent, quitDraftError, quitDraftToInput, quitFromTemplate, type Draft, type QuitDraft,
} from "@/lib/habits/draft";

const AREAS: Array<[HbArea, string]> = [["body", "Corpo"], ["mind", "Mente"], ["routine", "Rotina"], ["money", "Dinheiro"], ["other", "Outro"]];
const DAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

export default function Novo() {
  const navigate = useNavigate();
  const templates = useHbTemplates();
  const create = useCreateHabit();
  const { consent } = useHabitViews();
  const [step, setStep] = useState<"choose" | "plan" | "quit">("choose");
  const [d, setD] = useState<Draft>(EMPTY);
  const [q, setQ] = useState<QuitDraft>(EMPTY_QUIT);
  const [consentOpen, setConsentOpen] = useState(false);
  const categories = useExpenseCategories(step === "quit");
  const setQuit = (patch: Partial<QuitDraft>) => setQ((prev) => ({ ...prev, ...patch }));
  const quitErr = quitDraftError(q);
  const suggest = useSuggestPlan();
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
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const err = draftError(d);

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

  if (step === "choose") {
    const doing = (templates.data ?? []).filter((t) => t.kind !== "quit");
    const quitting = (templates.data ?? []).filter((t) => t.kind === "quit");
    return (
      <div className="px-4 pb-6">
        <PageHeader title="O que você quer que vire rotina?" subtitle="Comece com um só. Dois ou três ao mesmo tempo é o que mais derruba." back="/h/hoje" />
        {templates.isLoading ? (
          <div className="grid min-h-[30vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>
        ) : (
          <ul className="flex flex-col gap-2">
            {doing.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => { setD(fromTemplate(t)); setStep("plan"); }} className="w-full rounded-[20px] bg-card p-4 text-left shadow-card transition-colors hover:bg-muted">
                  <p className="font-display text-base font-bold leading-5">{t.title}</p>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{t.minimum_suggestion ? `Dia ruim: ${t.minimum_suggestion}` : t.why_it_works}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="mt-4 h-12 w-full rounded-full text-[15px] font-semibold text-primary" onClick={() => { setD(EMPTY); setStep("plan"); }}>Criar o meu próprio</Button>
        <h2 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ou largar algo</h2>
        <ul className="flex flex-col gap-2">
          {quitting.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => { setQ(quitFromTemplate(t)); setStep("quit"); }} className="w-full rounded-[20px] bg-card p-4 text-left shadow-card transition-colors hover:bg-muted">
                <p className="font-display text-base font-bold leading-5">{t.title}</p>
                <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{t.why_it_works}</p>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="outline" className="mt-3 h-12 w-full rounded-full text-[15px] font-semibold text-primary" onClick={() => { setQ(EMPTY_QUIT); setStep("quit"); }}>Largar outra coisa</Button>
      </div>
    );
  }

  if (step === "quit") {
    return (
      <div className="px-4 pb-8">
        <header className="flex items-center gap-1 pt-3">
          <button type="button" onClick={() => setStep("choose")} className="-ml-2 inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted">Voltar</button>
        </header>
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">Largar com um plano</h1>
        <p className="mt-1 text-sm text-muted-foreground">A contagem começa hoje. Se escorregar, você recomeça sem perder o recorde.</p>
        <div className="mt-4 flex flex-col gap-5">
          <div>
            <Label htmlFor="hb-q-title">O que você quer largar?</Label>
            <Input id="hb-q-title" value={q.title} maxLength={80} onChange={(e) => setQuit({ title: e.target.value })} placeholder="Ex.: Delivery por impulso" className="mt-1 h-12 rounded-2xl" />
          </div>
          <div>
            <Label htmlFor="hb-q-plan">Quando bater a vontade, eu vou…</Label>
            <Input id="hb-q-plan" value={q.craving_plan} maxLength={160} onChange={(e) => setQuit({ craving_plan: e.target.value })} placeholder="beber água e esperar 10 minutos" className="mt-1 h-12 rounded-2xl" />
            <p className="mt-1 text-xs text-muted-foreground">Decidir antes ajuda mais do que contar com força de vontade na hora.</p>
          </div>
          <div className="rounded-[20px] bg-card p-4 shadow-card">
            <p className="text-[15px] font-semibold">Quanto isso custa? (opcional)</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Eu mostro uma estimativa do que ficou com você. Escolha uma categoria para eu usar a sua média real, ou informe um valor por dia.</p>
            <select
              aria-label="Categoria de gasto"
              value={q.category_id}
              onChange={(e) => setQuit({ category_id: e.target.value, category_label: (categories.data ?? []).find((c) => c.id === e.target.value)?.name ?? "" })}
              className="mt-3 h-12 w-full rounded-2xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem categoria</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Input aria-label="Gasto por dia" inputMode="decimal" value={q.daily_cost} onChange={(e) => setQuit({ daily_cost: e.target.value })} placeholder="Gasto por dia, em reais (opcional)" className="mt-2 h-12 rounded-2xl" />
          </div>
          <Button className="h-12 rounded-full text-[15px] font-semibold" disabled={create.isPending} onClick={() => void submitQuit(false)}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Começar a contagem"}
          </Button>
          {quitErr && q.title ? <p className="-mt-3 text-center text-xs text-muted-foreground">{quitErr}</p> : null}
        </div>
        <ConsentSheet open={consentOpen} onOpenChange={setConsentOpen} onGranted={() => { setConsentOpen(false); void submitQuit(true); }} />
      </div>
    );
  }

  const chip = (on: boolean) => cn("min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card");
  return (
    <div className="px-4 pb-8">
      <header className="flex items-center gap-1 pt-3">
        <button type="button" onClick={() => setStep("choose")} className="-ml-2 inline-flex h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted">Voltar</button>
      </header>
      <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">Monte o seu plano</h1>

      <div className="mt-4 flex flex-col gap-5">
        <div>
          <Label htmlFor="hb-n-title">Nome do hábito</Label>
          <Input id="hb-n-title" value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Meditar 5 min" className="mt-1 h-12 rounded-2xl" />
        </div>

        <Button type="button" variant="outline" className="h-11 rounded-full font-semibold text-primary" disabled={suggest.isPending || d.title.trim().length < 2} onClick={() => void askSuggestion()}>
          {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sugerir gatilho e versão mínima (IA)"}
        </Button>
        <div className="rounded-[20px] bg-card p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quando você vai fazer?</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-[17px] font-medium leading-8">
            <span>Depois de</span>
            <Input aria-label="Depois de quê" value={d.cue_text.replace(/^depois d[eo]s?\s+/i, "")} maxLength={110} onChange={(e) => set({ cue_text: e.target.value ? `Depois de ${e.target.value.replace(/^depois d[eo]s?\s+/i, "")}` : "" })} placeholder="tomar o café" className="h-11 min-w-[160px] flex-1 rounded-xl" />
            <span>, eu vou {d.title.trim() ? d.title.trim().toLowerCase() : "…"}.</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Ligar o hábito a algo que você já faz todo dia ajuda mais do que um alarme.</p>
        </div>

        <div>
          <Label htmlFor="hb-n-min">Se o dia estiver ruim, eu faço só…</Label>
          <Input id="hb-n-min" value={d.minimum_text} maxLength={120} onChange={(e) => set({ minimum_text: e.target.value })} placeholder="3 respirações" className="mt-1 h-12 rounded-2xl" />
          <p className="mt-1 text-xs text-muted-foreground">A versão mínima conta como feito e mantém o hábito vivo.</p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Frequência</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Frequência">
            <button type="button" className={chip(d.cadence === "daily")} aria-pressed={d.cadence === "daily"} onClick={() => set({ cadence: "daily" })}>Todo dia</button>
            <button type="button" className={chip(d.cadence === "weekly")} aria-pressed={d.cadence === "weekly"} onClick={() => set({ cadence: "weekly" })}>X por semana</button>
            <button type="button" className={chip(d.cadence === "quantity")} aria-pressed={d.cadence === "quantity"} onClick={() => set({ cadence: "quantity" })}>Quantidade</button>
          </div>
          {d.cadence === "daily" ? (
            <div className="mt-3 grid grid-cols-7 gap-1.5" role="group" aria-label="Dias da semana (vazio = todos)">
              {DAYS.map((l, i) => {
                const on = d.days.includes(i);
                return <button key={i} type="button" aria-pressed={on} aria-label={["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][i]} onClick={() => set({ days: on ? d.days.filter((x) => x !== i) : [...d.days, i].sort() })} className={cn("h-11 rounded-xl border text-sm font-bold", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>{l}</button>;
              })}
            </div>
          ) : null}
          {d.cadence === "weekly" ? (
            <div className="mt-3 flex items-center gap-3">
              <Button type="button" variant="outline" className="h-11 w-11 rounded-full" aria-label="Menos" onClick={() => set({ weekly_target: Math.max(1, d.weekly_target - 1) })}>−</Button>
              <span className="min-w-[110px] text-center font-display text-lg font-bold">{d.weekly_target}x por semana</span>
              <Button type="button" variant="outline" className="h-11 w-11 rounded-full" aria-label="Mais" onClick={() => set({ weekly_target: Math.min(7, d.weekly_target + 1) })}>+</Button>
            </div>
          ) : null}
          {d.cadence === "quantity" ? (
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input type="number" inputMode="decimal" min={0} step="any" aria-label="Meta" value={d.quantity_target} onChange={(e) => set({ quantity_target: e.target.value })} placeholder="Meta" className="h-12 rounded-2xl" />
              <Input aria-label="Unidade" value={d.quantity_unit} maxLength={20} onChange={(e) => set({ quantity_unit: e.target.value })} placeholder="páginas" className="h-12 rounded-2xl" />
              <div className="flex gap-1.5" role="group" aria-label="Período">
                <button type="button" aria-pressed={d.quantity_period === "day"} onClick={() => set({ quantity_period: "day" })} className={chip(d.quantity_period === "day")}>por dia</button>
                <button type="button" aria-pressed={d.quantity_period === "week"} onClick={() => set({ quantity_period: "week" })} className={chip(d.quantity_period === "week")}>por semana</button>
              </div>
            </div>
          ) : null}
        </div>

        {d.cadence !== "weekly" && !(d.cadence === "quantity" && d.quantity_period === "week") ? (
          <div className="flex items-center justify-between rounded-[20px] bg-card p-4 shadow-card">
            <div><p className="text-[15px] font-semibold">Folgas por semana</p><p className="text-xs text-muted-foreground">Um dia de folga não quebra a sequência.</p></div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="h-11 w-11 rounded-full" aria-label="Menos folgas" onClick={() => set({ rest_per_week: Math.max(0, d.rest_per_week - 1) })}>−</Button>
              <span className="w-5 text-center font-display text-lg font-bold">{d.rest_per_week}</span>
              <Button type="button" variant="outline" className="h-11 w-11 rounded-full" aria-label="Mais folgas" onClick={() => set({ rest_per_week: Math.min(3, d.rest_per_week + 1) })}>+</Button>
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium">Começar</p>
          <div className="flex gap-2" role="group" aria-label="Início">
            <button type="button" className={chip(!d.start_today)} aria-pressed={!d.start_today} onClick={() => set({ start_today: false })}>Amanhã</button>
            <button type="button" className={chip(d.start_today)} aria-pressed={d.start_today} onClick={() => set({ start_today: true })}>Hoje</button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Área</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Área">
            {AREAS.map(([a, label]) => <button key={a} type="button" className={chip(d.area === a)} aria-pressed={d.area === a} onClick={() => set({ area: a })}>{label}</button>)}
          </div>
        </div>

        <Button className="h-12 rounded-full text-[15px] font-semibold" disabled={create.isPending} onClick={() => void submit()}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Criar hábito"}
        </Button>
        {err && d.title ? <p className="-mt-3 text-center text-xs text-muted-foreground">{err}</p> : null}
      </div>
    </div>
  );
}
