import { Link } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, PhaseChip, StrengthBar } from "@/components/hb/ui";
import { useHabitViews, type HabitView } from "@/lib/habits/api";

export const MAX_ACTIVE_HABITS = 5;

const cadence = (v: HabitView): string => {
  const h = v.habit;
  if (h.kind === "do_weekly_count") return `${h.weekly_target}x por semana`;
  if (h.kind === "do_quantity") return `${h.quantity_target} ${h.quantity_unit ?? ""} por ${h.quantity_period === "week" ? "semana" : "dia"}`.replace("  ", " ");
  if (h.days_of_week && h.days_of_week.length > 0 && h.days_of_week.length < 7) return `${h.days_of_week.length} dias por semana`;
  return "Todo dia";
};

const pct = (n: number | null) => (n == null ? "-" : `${Math.round(n * 100)}%`);

export default function Habitos() {
  const { views, isLoading } = useHabitViews();
  const full = views.length >= MAX_ACTIVE_HABITS;
  return (
    <div className="px-4">
      <PageHeader
        title="Hábitos"
        subtitle={views.length > 0 ? `${views.length} ${views.length === 1 ? "ativo" : "ativos"} · poucos de cada vez funcionam melhor` : "Comece com um só"}
        right={
          <Button asChild={!full} disabled={full} size="sm" className="mt-1 h-11 rounded-full px-4">
            {full ? <span>Limite de {MAX_ACTIVE_HABITS}</span> : <Link to="/h/novo"><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Novo</Link>}
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>
      ) : views.length === 0 ? (
        <div className="rounded-[20px] bg-card p-6 text-center shadow-card">
          <p className="font-display text-lg font-bold">Nenhum hábito ainda</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-5 text-muted-foreground">Escolha um pequeno, ligado a algo que você já faz todo dia.</p>
          <Button asChild className="mt-4 rounded-full"><Link to="/h/novo">Criar um hábito</Link></Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {views.map((v) => (
            <li key={v.habit.id}>
              <Link to={`/h/habito/${v.habit.id}`} className="block rounded-[20px] bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-[17px] font-bold leading-6">{v.habit.title}</p>
                    <p className="text-xs leading-4 text-muted-foreground">{cadence(v)}{v.habit.cue_text ? ` · ${v.habit.cue_text}` : ""}</p>
                  </div>
                  <PhaseChip phase={v.summary.phase} />
                </div>
                <div className="mt-3"><StrengthBar value={v.summary.strength} /></div>
                <dl className="mt-3 flex gap-6 text-xs text-muted-foreground">
                  <div><dt className="sr-only">Sequência</dt><dd><b className="text-sm text-foreground">{v.summary.streak}</b> {v.summary.model === "weekly" ? "sem." : "dias"} seguidos</dd></div>
                  <div><dt className="sr-only">Adesão em 30 dias</dt><dd><b className="text-sm text-foreground">{pct(v.summary.adherence30)}</b> em 30 dias</dd></div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
