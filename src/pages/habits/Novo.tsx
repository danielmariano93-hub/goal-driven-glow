import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clock, Loader2, Moon, Pencil, Plus, Sun, Sunrise, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HabitIcon } from "@/components/hb/icons";
import { ConsentSheet } from "@/components/hb/ConsentSheet";
import { CATALOG, findCatalog, QUIT_CATALOG, type CatalogItem, type IconKey } from "@/lib/habits/catalog";
import { hbErrorMessage, useCreateHabit, useExpenseCategories, useHabitViews, useSuggestPlan } from "@/lib/habits/api";
import {
  draftError, draftToInput, EMPTY, EMPTY_QUIT, fromCatalog, measureText, needsConsent, quitDraftError, quitDraftToInput, quitFromItem, withOption, type Draft, type QuitDraft,
} from "@/lib/habits/draft";

import { hhmm, minutesOf } from "@/lib/habits/engine";
import { ANCHORS, composeCue, normalizeCue, PERIODS, splitCue, switchPeriod, type PeriodId } from "@/lib/habits/period";

const PERIOD_ICON: Record<PeriodId, typeof Sun> = { "Manhã": Sunrise, "Tarde": Sun, "Noite": Moon, "Durante o dia": Clock };
const DAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];
const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const CUSTOM: CatalogItem = {
  id: "custom", label: "", area: "other", icon: "sun",
  options: [
    { form: "check", label: "Feito ou não", unit: "", target: 0, step: 1 },
    { form: "weekly", label: "Vezes na semana", unit: "vezes por semana", target: 3, step: 1, min: 1, max: 7 },
    { form: "amount", label: "Quantidade", unit: "vezes por dia", target: 1, step: 1, min: 1 },
    { form: "duration", label: "Minutos", unit: "minutos por dia", target: 20, step: 5, min: 1 },
  ],
};

type Screen = "choose" | "cue" | "min" | "measure" | "plan" | "cost" | "done";

const chip = (on: boolean) => cn("h-9 rounded-full border px-3.5 text-[14px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted");
const field = "h-11 w-full rounded-xl border border-border/70 bg-card px-3.5 text-[15px] outline-none transition-colors focus:border-primary";

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-muted p-[3px]">
      {options.map(([k, l]) => (
        <button key={String(k)} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cn("h-[34px] flex-1 rounded-[9px] px-1 text-[13px] font-medium transition-colors", value === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{l}</button>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, step, min, max, big, unit }: { value: number; onChange: (n: number) => void; step: number; min?: number; max?: number; big?: string; unit: string }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const clamp = (n: number) => Math.min(max ?? 99999, Math.max(min ?? 0, Math.round(n * 100) / 100));
  const shown = big ?? String(value).replace(".", ",");
  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
    setTyping(false);
  };
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card p-2 shadow-card">
      <button type="button" aria-label="Menos" onClick={() => onChange(clamp(value - step))} className="grid h-10 w-10 place-items-center rounded-full bg-muted text-lg transition-transform active:scale-95">−</button>
      <div className="min-w-0 flex-1 text-center">
        {typing ? (
          <input autoFocus value={text} inputMode="decimal" aria-label="Digitar o valor" onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, ""))} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} className="mx-auto h-9 w-28 rounded-lg border border-primary bg-card text-center font-display font-semibold tabular-nums outline-none" />
        ) : (
          <button type="button" aria-label={`${shown} ${unit}. Toque para digitar outro valor`} onClick={() => { setText(String(value).replace(".", ",")); setTyping(true); }} className="mx-auto block rounded-lg px-2 active:bg-muted">
            <span className="block font-display text-[26px] font-semibold leading-7 tracking-[-0.03em] tabular-nums">{shown}</span>
          </button>
        )}
        <p className="text-[12px] text-muted-foreground">{typing ? "Digite e toque fora" : `${unit} · toque no número para digitar`}</p>
      </div>
      <button type="button" aria-label="Mais" onClick={() => onChange(clamp(value + step))} className="grid h-10 w-10 place-items-center rounded-full bg-muted text-lg transition-transform active:scale-95">+</button>
    </div>
  );
}

/** Horário alvo (ex.: deitar até 22:30). O alvo fica em horas decimais no rascunho. */
function TimeTarget({ value, onChange, unit }: { value: number; onChange: (n: number) => void; unit: string }) {
  const total = Math.round(value * 60);
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-card">
      <input
        type="time"
        value={hhmm(total % 1440)}
        aria-label="Horário alvo"
        onChange={(e) => {
          const m = minutesOf(e.target.value);
          if (m == null) return;
          // Depois da meia-noite vale como a mesma noite (00:30 = 24:30), quando o alvo é noturno.
          onChange((value >= 18 && m < 720 ? m + 1440 : m) / 60);
        }}
        className="h-12 w-full rounded-xl border border-border/70 bg-card px-4 text-center font-display text-[26px] font-semibold tabular-nums"
      />
      <p className="mt-2 text-center text-[12px] text-muted-foreground">{unit.startsWith("acordar") ? "Acordar até esse horário conta como feito" : "Deitar até esse horário conta como feito"}</p>
    </div>
  );
}

export default function Novo() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateHabit();
  const { consent, activeCount } = useHabitViews();
  const categories = useExpenseCategories(false);
  const suggest = useSuggestPlan();
  const wanted = params.get("t");
  const initial = useMemo(() => (wanted ? findCatalog(wanted) ?? null : null), [wanted]);
  const [mode, setMode] = useState<"do" | "quit">("do");
  const [screen, setScreen] = useState<Screen>(initial ? "cue" : "choose");
  const [item, setItem] = useState<CatalogItem | null>(initial);
  const [d, setD] = useState<Draft>(initial ? fromCatalog(initial) : EMPTY);
  const [q, setQ] = useState<QuitDraft>(EMPTY_QUIT);
  const [consentOpen, setConsentOpen] = useState(false);
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));
  const setQuit = (patch: Partial<QuitDraft>) => setQ((p) => ({ ...p, ...patch }));
  void categories;

  const isQuit = mode === "quit";
  const seq: Screen[] = isQuit ? ["choose", "plan", "cost", "done"] : ["choose", "cue", "min", "measure", "done"];
  const idx = Math.max(0, seq.indexOf(screen));
  const err = isQuit ? quitDraftError(q) : draftError(d);
  const options = (item ?? CUSTOM).options;
  const opt = options[d.option_index] ?? options[0];

  const pickItem = (it: CatalogItem) => { setItem(it); setD(fromCatalog(it)); setScreen("cue"); };
  const pickQuit = (id: string) => {
    const it = QUIT_CATALOG.find((x) => x.id === id);
    if (!it) return;
    setQ(quitFromItem(it));
    setScreen("plan");
  };
  const startOwn = (name: string) => {
    if (isQuit) { setQuit({ title: name }); setScreen("plan"); return; }
    setItem(null);
    setD({ ...EMPTY, title: name, option_index: 0 });
    setScreen("cue");
  };
  const back = () => (idx === 0 ? navigate("/h/hoje") : setScreen(seq[idx - 1]));
  const cue = splitCue(d.cue_text);
  const canNext = screen === "cue" ? cue.period !== null : screen === "plan" ? q.craving_plan.trim().length > 0 : true;

  const submit = async (granted = false) => {
    if (err) return toast.error(err);
    if (isQuit && needsConsent(q) && !consent && !granted) return setConsentOpen(true);
    try {
      await create.mutateAsync(isQuit ? quitDraftToInput(q) : draftToInput(d));
      toast.success(isQuit ? "Pronto. A contagem começou hoje." : d.start_today ? "Hábito criado. Comece hoje." : "Hábito criado. Começa amanhã.");
      navigate("/h/hoje", { replace: true });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const next = () => {
    if (screen === "done") return void submit();
    if (!canNext) return;
    setScreen(seq[Math.min(seq.length - 1, idx + 1)]);
  };
  const askAi = async () => {
    try {
      const r = await suggest.mutateAsync(d.title.trim());
      const p = r.plan;
      if (!p.cue_text && !p.minimum_text) return toast.message("Não tenho sugestão para este hábito. Pode preencher do seu jeito.");
      set({ cue_text: d.cue_text || normalizeCue(p.cue_text), minimum_text: d.minimum_text || p.minimum_text || "" });
      toast.success("Sugestão preenchida. Ajuste como preferir.");
    } catch {
      toast.message("Não consegui sugerir agora. Pode preencher do seu jeito.");
    }
  };

  // ------------------------------------------------------------ cartão do hábito (monta enquanto a pessoa responde)
  const name = isQuit ? q.title : d.title;
  const icon: IconKey = isQuit ? (QUIT_CATALOG.find((x) => x.label === q.title)?.icon ?? "smoke") : d.icon;
  const line = isQuit ? (q.craving_plan ? `Na vontade: ${q.craving_plan.toLowerCase()}` : "Defina o seu plano para a vontade") : d.cue_text ? `${d.cue_text} · ${measureText(d)}` : "Defina o momento do dia";
  const meta = isQuit ? "a contagem começa hoje" : d.minimum_text ? `Dia ruim: ${d.minimum_text.toLowerCase()}` : "";
  const dots = Array.from({ length: 7 }, (_, i) => (isQuit ? !!q.craving_plan : !!d.cue_text && (d.form === "weekly" ? i < d.target : d.days.length === 0 || d.days.includes(i))));
  const titles: Record<Screen, [string, string]> = {
    choose: [isQuit ? "O que você quer largar?" : "O que você quer criar?", isQuit ? "Um plano pronto para a hora da vontade faz a diferença." : "Comece com um só. Dois ou três ao mesmo tempo é o que mais derruba."],
    cue: ["Em que parte do dia?", "Escolha o período em que isso cabe. O nome acima também é editável."],
    min: ["E nos dias difíceis?", "Defina o mínimo que ainda conta como feito."],
    measure: ["Como acompanhar?", "Cada hábito se mede de um jeito. Pode ajustar depois, sem perder o histórico."],
    plan: ["Quando bater a vontade?", "O que você vai fazer em vez de ceder."],
    cost: ["Quanto isso custa?", "Opcional. Serve para estimar o que ficou com você."],
    done: ["Tudo certo?", "Toque em qualquer linha para ajustar."],
  };
  const [title, helper] = titles[screen];

  const setName = (v: string) => (isQuit ? setQuit({ title: v }) : set({ title: v }));
  const projectFields = d.form === "project" && item?.project;
  const forecast = (() => {
    const total = Number(d.project_total) || 0;
    const cur = Number(d.project_current) || 0;
    if (!total || d.target < 1) return "Informe o total e eu calculo a previsão de término. Você também pode preencher depois.";
    return `No ritmo de ${d.target} ${d.unit.replace(" por vez", "").replace(" por dia", "")} por ${d.unit.includes("vez") ? "vez" : "dia"}, faltam cerca de ${Math.ceil(Math.max(0, total - cur) / d.target)} ${d.unit.includes("vez") ? "vezes" : "dias"}.`;
  })();
  const summary: Array<[string, string, Screen]> = isQuit
    ? [["Largar", q.title, "choose"], ["Na vontade", q.craving_plan, "plan"], ["Custo", q.daily_cost ? `R$ ${q.daily_cost} por dia` : q.category_id ? "Pela minha categoria" : "Não informado", "cost"]]
    : [["Hábito", d.title, "choose"], ["Quando", d.cue_text, "cue"], ["Dia ruim", d.minimum_text || "Sem versão mínima", "min"], ["Acompanhar", measureText(d), "measure"]];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Topo: degradê com o cartão que se monta */}
      <header className="bg-gradient-hero px-5 pb-9 pt-2 text-primary-foreground" style={{ paddingTop: "max(env(safe-area-inset-top), 8px)" }}>
        <div className="flex h-10 items-center justify-between">
          <button type="button" onClick={back} aria-label="Voltar" className="-ml-2 grid h-10 w-10 place-items-center rounded-full transition-colors hover:bg-white/10"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
          <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={seq.length - 1} aria-valuenow={Math.max(1, idx)} aria-label="Progresso">
            {seq.slice(1).map((s, i) => <i key={s} className={cn("block h-1.5 rounded-full transition-all duration-300", i + 1 === idx ? "w-[22px] bg-white" : i + 1 < idx ? "w-1.5 bg-white" : "w-1.5 bg-white/30")} />)}
          </div>
          <span className="w-10 text-right text-[13px] text-white/70">{idx === 0 ? "" : `${idx}/${seq.length - 1}`}</span>
        </div>
        <div className="mt-1.5 flex flex-col gap-2 rounded-2xl bg-white/12 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-white/15"><HabitIcon name={icon} size={17} /></span>
            <div className="min-w-0 flex-1">
              <label className="flex cursor-text items-center gap-1.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isQuit ? "O que você quer largar" : "Seu hábito"}
                  aria-label="Nome do hábito (toque para editar)"
                  maxLength={80}
                  className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 font-display text-[15px] font-semibold leading-[19px] tracking-[-0.01em] text-white outline-none placeholder:text-white/55"
                />
                <Pencil className="h-3 w-3 shrink-0 text-white/65" aria-hidden="true" />
              </label>
              <p className={cn("truncate text-[12px] leading-4", (isQuit ? q.craving_plan : d.cue_text) ? "text-white/85" : "text-white/50")}>{line}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5" aria-hidden="true">{dots.map((on, i) => <i key={i} className={cn("block h-2 w-2 rounded-full border transition-all", on ? "border-white bg-white" : "border-white/40")} />)}</div>
            <span className="truncate pl-3 text-[11px] text-white/70">{meta}</span>
          </div>
        </div>
      </header>

      {/* Folha clara: uma pergunta por vez */}
      <section className="-mt-4 flex min-h-0 flex-1 flex-col rounded-t-3xl bg-background">
        <div key={screen} className="flex min-h-0 flex-1 flex-col px-5 pt-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h1 className="font-display text-[22px] font-semibold leading-[26px] tracking-[-0.02em]">{title}</h1>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{helper}</p>

          <div className="mt-3.5 flex-1 overflow-y-auto pb-3">
            {screen === "choose" ? (
              <div className="flex flex-col gap-3">
                <Segmented value={mode} label="Tipo de hábito" options={[["do", "Começar a fazer"], ["quit", "Largar algo"]]} onChange={(m) => { setMode(m); setItem(null); setD(EMPTY); setQ(EMPTY_QUIT); }} />
                <form onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get("own") as string ?? "").trim(); if (v.length >= 2) startOwn(v); }} className="flex h-11 items-center gap-2 rounded-xl border border-border/70 bg-card pl-3.5 pr-1.5">
                  <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <input name="own" placeholder={isQuit ? "Escreva o que quer largar" : "Escreva o seu próprio hábito"} aria-label="Nome do hábito" maxLength={80} className="min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none" />
                  <button type="submit" aria-label="Continuar" className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                </form>
                <p className="text-[12px] text-muted-foreground">Ou comece por uma sugestão</p>
                <div className="grid grid-cols-2 gap-2">
                  {isQuit
                    ? QUIT_CATALOG.map((it) => (
                        <button key={it.id} type="button" aria-label={it.label} onClick={() => pickQuit(it.id)} className="flex min-h-[68px] flex-col gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><HabitIcon name={it.icon} size={15} /></span>
                          <span className="font-display text-[13px] font-semibold leading-[17px] tracking-[-0.01em]">{it.label}</span>
                        </button>
                      ))
                    : CATALOG.map((it) => (
                        <button key={it.id} type="button" aria-label={it.label} onClick={() => pickItem(it)} className="flex min-h-[68px] flex-col gap-2 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><HabitIcon name={it.icon} size={15} /></span>
                          <span className="font-display text-[13px] font-semibold leading-[17px] tracking-[-0.01em]">{it.label}</span>
                        </button>
                      ))}
                </div>
              </div>
            ) : null}

            {screen === "cue" ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Momento do dia">
                  {PERIODS.map((p) => {
                    const on = cue.period === p.id;
                    const Icon = PERIOD_ICON[p.id];
                    return (
                      <button key={p.id} type="button" aria-pressed={on} onClick={() => set({ cue_text: switchPeriod(d.cue_text, p.id) })} className={cn("flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors active:scale-[0.98]", on ? "border-primary bg-primary/5" : "border-border/60 bg-card")}>
                        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")} aria-hidden="true"><Icon className="h-[18px] w-[18px]" strokeWidth={1.9} /></span>
                        <span className="min-w-0"><span className="block text-[15px] font-semibold leading-5">{p.id}</span><span className="block truncate text-[12px] leading-4 text-muted-foreground">{p.hint}</span></span>
                      </button>
                    );
                  })}
                </div>
                {cue.period && ANCHORS[cue.period].length > 0 ? (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ligar a algo que você já faz">
                    {ANCHORS[cue.period].map((a) => <button key={a} type="button" aria-pressed={cue.anchor.toLowerCase() === a} onClick={() => set({ cue_text: composeCue(cue.period, cue.anchor.toLowerCase() === a ? "" : a) })} className={chip(cue.anchor.toLowerCase() === a)}>{a[0].toUpperCase() + a.slice(1)}</button>)}
                  </div>
                ) : null}
                <input value={cue.anchor} disabled={!cue.period} onChange={(e) => set({ cue_text: composeCue(cue.period, e.target.value) })} placeholder="Ou escreva o seu gatilho (opcional)" aria-label="Ligar a algo que você já faz (opcional)" maxLength={80} className={cn(field, "disabled:opacity-50")} />
                <button type="button" disabled={suggest.isPending || d.title.trim().length < 2} onClick={() => void askAi()} className="inline-flex min-h-10 items-center gap-2 self-start px-1 text-[13px] font-medium text-primary disabled:opacity-40">
                  {suggest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}Sugerir gatilho e versão mínima (IA)
                </button>
              </div>
            ) : null}

            {screen === "min" ? (
              <div className="flex flex-col gap-2">
                {Array.from(new Set([d.minimum_text, "Só começar, 2 minutos", "Metade do combinado"].filter(Boolean))).slice(0, 3).map((m, i) => (
                  <button key={m} type="button" aria-pressed={d.minimum_text === m} onClick={() => set({ minimum_text: m })} className={cn("flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors", d.minimum_text === m ? "border-primary bg-primary/5" : "border-border/60 bg-card")}>
                    <span className="flex-1 text-[14px] font-medium leading-[19px]">{m}</span>
                    {i === 0 && d.minimum_text ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">sugerido</span> : null}
                    <span className={cn("grid h-[18px] w-[18px] place-items-center rounded-full border", d.minimum_text === m ? "border-primary bg-primary" : "border-border")} aria-hidden="true">{d.minimum_text === m ? <i className="block h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                  </button>
                ))}
                <input value={d.minimum_text} onChange={(e) => set({ minimum_text: e.target.value })} placeholder="Ou escreva a sua versão mínima" aria-label="Versão mínima" maxLength={120} className={field} />
                <p className="mt-1 text-[12px] text-muted-foreground">A versão mínima conta como feito e mantém o hábito vivo.</p>
              </div>
            ) : null}

            {screen === "measure" ? (
              <div className="flex flex-col gap-3.5">
                {options.length > 1 ? <Segmented value={d.option_index} label="Como acompanhar" options={options.map((o, i) => [i, o.label] as [number, string])} onChange={(i) => setD((p) => withOption(p, item ?? CUSTOM, i))} /> : null}
                {d.form === "time" ? <TimeTarget value={d.target} onChange={(n) => set({ target: n })} unit={d.unit} /> : ["weekly", "amount", "duration", "ceiling", "value", "recurring"].includes(d.form) ? (
                  <Stepper value={d.target} onChange={(n) => set({ target: n })} step={opt.step} min={opt.min ?? (opt.step < 1 ? opt.step : 0)} max={opt.max} unit={d.form === "value" ? `${d.unit} · sua meta (opcional)` : d.unit.replace("__", String(d.target)) || ""} big={d.form === "weekly" ? `${d.target}x` : undefined} />
                ) : null}
                {["check", "amount", "duration", "time", "ceiling", "value", "steps"].includes(d.form) ? (
                  <div>
                    <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Dias da semana (vazio = todos)">
                      {DAY_LETTERS.map((l, i) => {
                        const on = d.days.includes(i);
                        return <button key={i} type="button" aria-pressed={on} aria-label={DAY_NAMES[i]} onClick={() => set({ days: on ? d.days.filter((x) => x !== i) : [...d.days, i].sort() })} className={cn("h-[38px] rounded-[11px] border text-[13px] font-medium transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>{l}</button>;
                      })}
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">Sem escolher nenhum, vale todos os dias.</p>
                  </div>
                ) : null}
                {d.form === "steps" ? (
                  <div className="flex flex-col gap-2">
                    {d.steps.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={s} onChange={(e) => set({ steps: d.steps.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Passo ${i + 1}`} maxLength={80} className={field} />
                        <button type="button" aria-label={`Remover passo ${i + 1}`} onClick={() => set({ steps: d.steps.filter((_, j) => j !== i) })} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
                      </div>
                    ))}
                    {d.steps.length < 12 ? <button type="button" onClick={() => set({ steps: [...d.steps, ""] })} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 text-[14px] font-medium text-primary"><Plus className="h-4 w-4" aria-hidden="true" />Adicionar passo</button> : null}
                    <p className="text-[12px] text-muted-foreground">Todos os passos = dia feito. Pelo menos metade = versão mínima.</p>
                  </div>
                ) : null}
                {projectFields ? (
                  <div className="flex flex-col gap-2">
                    <input value={d.project_title} onChange={(e) => set({ project_title: e.target.value })} placeholder={item?.project?.example ?? "Nome"} aria-label={item?.project?.titleLabel} maxLength={120} className={field} />
                    <label className="flex h-11 items-center gap-2 rounded-xl border border-border/70 bg-card px-3.5">
                      <input value={d.project_total} onChange={(e) => set({ project_total: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" placeholder={item?.project?.totalLabel} aria-label={item?.project?.totalLabel} className="min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none" />
                      <span className="text-[13px] text-muted-foreground">{item?.project?.unit}</span>
                    </label>
                    <label className="flex h-11 items-center gap-2 rounded-xl border border-border/70 bg-card px-3.5">
                      <input value={d.project_current} onChange={(e) => set({ project_current: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" placeholder="Onde você está agora (opcional)" aria-label="Avanço atual" className="min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none" />
                      <span className="text-[13px] text-muted-foreground">{item?.project?.unit}</span>
                    </label>
                    <Stepper value={d.target} onChange={(n) => set({ target: n })} step={opt.step} min={opt.min ?? 1} unit={d.unit} />
                    <p className="rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-[17px] text-muted-foreground">{forecast}</p>
                  </div>
                ) : null}
                {d.form === "check" && options.length === 1 ? <p className="text-[13px] text-muted-foreground">Você marca como feito todo dia que cumprir.</p> : null}
              </div>
            ) : null}

            {screen === "plan" ? (
              <div className="flex flex-col gap-2">
                {Array.from(new Set([q.craving_plan, "Beber água e esperar 10 minutos", "Sair para uma caminhada curta"].filter(Boolean))).slice(0, 3).map((p) => (
                  <button key={p} type="button" aria-pressed={q.craving_plan === p} onClick={() => setQuit({ craving_plan: p })} className={cn("flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors", q.craving_plan === p ? "border-primary bg-primary/5" : "border-border/60 bg-card")}>
                    <span className="flex-1 text-[14px] font-medium leading-[19px]">{p}</span>
                    <span className={cn("grid h-[18px] w-[18px] place-items-center rounded-full border", q.craving_plan === p ? "border-primary bg-primary" : "border-border")} aria-hidden="true">{q.craving_plan === p ? <i className="block h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
                  </button>
                ))}
                <input value={q.craving_plan} onChange={(e) => setQuit({ craving_plan: e.target.value })} placeholder="Ou escreva o seu plano" aria-label="Plano para a vontade" maxLength={160} className={field} />
                <p className="mt-1 text-[12px] text-muted-foreground">Decidir antes ajuda mais do que contar com força de vontade na hora.</p>
              </div>
            ) : null}

            {screen === "cost" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {[["", "Pular"], ["15", "R$ 15 por dia"], ["30", "R$ 30 por dia"], ["50", "R$ 50 por dia"]].map(([k, l]) => <button key={k} type="button" aria-pressed={q.daily_cost === k} onClick={() => setQuit({ daily_cost: k })} className={chip(q.daily_cost === k)}>{l}</button>)}
                </div>
                <input value={q.daily_cost} onChange={(e) => setQuit({ daily_cost: e.target.value })} inputMode="decimal" placeholder="Ou informe o gasto por dia, em reais" aria-label="Gasto por dia" className={field} />
                <p className="rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-[17px] text-muted-foreground">Com isso eu mostro uma <b className="font-medium text-foreground">estimativa</b> do dinheiro que ficou com você. Você pode pular e informar depois.</p>
              </div>
            ) : null}

            {screen === "done" ? (
              <div className="flex flex-col gap-3.5">
                <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
                  {summary.map(([k, v, sc]) => (
                    <button key={k} type="button" onClick={() => setScreen(sc)} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-muted/50">
                      <span className="w-20 shrink-0 text-[12px] text-muted-foreground">{k}</span>
                      <span className="flex-1 text-[14px] font-medium leading-[19px]">{v || "Defina"}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                    </button>
                  ))}
                </div>
                {!isQuit ? <Segmented value={d.start_today ? "today" : "tomorrow"} label="Quando começa" options={[["today", "Começar hoje"], ["tomorrow", "Começar amanhã"]]} onChange={(v) => set({ start_today: v === "today" })} /> : null}
                {activeCount >= 5 ? <p className="text-[12px] text-destructive">Você já tem 5 hábitos ativos. Arquive um antes de criar outro.</p> : null}
              </div>
            ) : null}
          </div>

          {screen !== "choose" ? (
            <div className="-mx-5 border-t border-border/60 bg-background px-5 pb-5 pt-2.5" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
              <button
                type="button"
                disabled={create.isPending || !canNext || (screen === "done" && !!err)}
                onClick={next}
                className="flex h-[46px] w-full items-center justify-center rounded-full bg-primary text-[15px] font-medium text-primary-foreground transition-all active:scale-[0.98] disabled:bg-muted-foreground/30"
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : screen === "done" ? (isQuit ? "Começar a contagem" : "Criar hábito") : "Continuar"}
              </button>
              {screen === "min" ? <button type="button" onClick={() => { set({ minimum_text: "" }); setScreen("measure"); }} className="mt-0.5 h-9 w-full text-[13px] text-muted-foreground">Pular por agora</button> : null}
              {screen === "cost" ? <button type="button" onClick={() => { setQuit({ daily_cost: "" }); setScreen("done"); }} className="mt-0.5 h-9 w-full text-[13px] text-muted-foreground">Pular por agora</button> : null}
              {screen === "done" && err ? <p className="mt-1 text-center text-[12px] text-muted-foreground">{err}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
      <ConsentSheet open={consentOpen} onOpenChange={setConsentOpen} onGranted={() => { setConsentOpen(false); void submit(true); }} />
    </div>
  );
}
