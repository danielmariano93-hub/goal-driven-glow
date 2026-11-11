import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/hb/ui";
import { hbErrorMessage, useCreateHabit, useHbTemplates, type HbArea } from "@/lib/habits/api";
import { draftError, draftToInput, EMPTY, fromTemplate, type Draft } from "@/lib/habits/draft";

const AREAS: Array<[HbArea, string]> = [["body", "Corpo"], ["mind", "Mente"], ["routine", "Rotina"], ["money", "Dinheiro"], ["other", "Outro"]];
const DAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

export default function Novo() {
  const navigate = useNavigate();
  const templates = useHbTemplates();
  const create = useCreateHabit();
  const [step, setStep] = useState<"choose" | "plan">("choose");
  const [d, setD] = useState<Draft>(EMPTY);
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

  if (step === "choose") {
    return (
      <div className="px-4 pb-6">
        <PageHeader title="O que você quer que vire rotina?" subtitle="Comece com um só. Dois ou três ao mesmo tempo é o que mais derruba." back="/h/hoje" />
        {templates.isLoading ? (
          <div className="grid min-h-[30vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>
        ) : (
          <ul className="flex flex-col gap-2">
            {(templates.data ?? []).map((t) => (
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
