import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/hb/ui";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useCreateGoal, useHabitViews } from "@/lib/habits/api";
import { MEASURE_PRESETS } from "@/pages/habits/Objetivo";

const SUGGESTIONS = ["Hipertrofia e menos gordura abdominal", "Perder peso", "Ganhar massa muscular", "Mais energia e saúde"];

/** Um objetivo é o "para quê": agrupa as medidas (peso, cintura...) e os hábitos que levam até ele. */
export default function NovoObjetivo() {
  const navigate = useNavigate();
  const { views } = useHabitViews();
  const create = useCreateGoal();
  const [title, setTitle] = useState("");
  const [habits, setHabits] = useState<string[]>([]);
  const [measures, setMeasures] = useState<string[]>(["weight", "waist"]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ok = title.trim().length >= 2;
  const save = async () => {
    try {
      const id = await create.mutateAsync({ title: title.trim(), habits, measures: MEASURE_PRESETS.filter((p) => measures.includes(p.kind)) });
      toast.success("Objetivo criado");
      navigate(`/h/objetivo/${id}`, { replace: true });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  return (
    <div className="px-4 pb-10">
      <PageHeader title="Novo objetivo" subtitle="Perder peso ou ganhar massa são metas, não hábitos. O hábito é o que você faz para chegar lá." back="/h/habitos" />
      <div className="flex flex-col gap-5">
        <section aria-label="Qual é o objetivo">
          <label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
            Qual é o objetivo?
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Escreva o seu objetivo" aria-label="Nome do objetivo" className="h-11 rounded-2xl border border-border/70 bg-card px-4 text-[14px] text-foreground" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => setTitle(s)} className="rounded-full bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary">{s}</button>)}
          </div>
        </section>
        <section aria-label="Medidas">
          <p className="text-[12px] text-muted-foreground">O que você vai medir</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {MEASURE_PRESETS.map((p) => {
              const on = measures.includes(p.kind);
              return (
                <button key={p.kind} type="button" aria-pressed={on} onClick={() => setMeasures(toggle(measures, p.kind))} className={cn("rounded-xl border px-3 py-2.5 text-left", on ? "border-primary bg-primary/5" : "border-border/60 bg-card")}>
                  <span className="block text-[14px] font-semibold">{p.label}</span>
                  <span className="text-[12px] text-muted-foreground">{p.cadence === "weekly" ? "toda semana" : "todo mês"}, em {p.unit}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] leading-[18px] text-muted-foreground">Medidas não ocupam vaga entre os seus hábitos e não aparecem no Hoje. O Nino só mostra a tendência.</p>
        </section>
        <section aria-label="Hábitos ligados">
          <p className="text-[12px] text-muted-foreground">Quais hábitos levam até aqui?</p>
          {views.length === 0 ? <p className="mt-2 text-[12px] text-muted-foreground">Você ainda não tem hábitos ativos. Dá para ligar depois.</p> : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {views.map((v) => {
                const on = habits.includes(v.habit.id);
                return (
                  <li key={v.habit.id}>
                    <button type="button" aria-pressed={on} onClick={() => setHabits(toggle(habits, v.habit.id))} className={cn("flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-[14px]", on ? "border-primary bg-primary/5" : "border-border/60 bg-card")}>
                      <span>{v.habit.title}</span>
                      <span className={cn("grid h-5 w-5 place-items-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")} aria-hidden="true">{on ? "✓" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <Button className="h-11 rounded-full text-[14px] font-medium" disabled={!ok || create.isPending} onClick={() => void save()}>Criar objetivo</Button>
      </div>
    </div>
  );
}
