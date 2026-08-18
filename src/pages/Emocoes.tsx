import { Flame, Lightbulb, Smile, Sparkles, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { BehavioralInsightsCard } from "@/components/emotions/BehavioralInsightsCard";
import { computeEmotionalSummary } from "@/lib/emotions/summary";
import { EMOTION_CATALOG, emotionLabel } from "@/lib/emotions/catalog";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { EmotionFinancePatterns } from "@/components/emotions/EmotionFinancePatterns";

const MOODS = EMOTION_CATALOG.map((e) => ({ v: e.mood, label: e.label, emoji: e.emoji }));

export default function Emocoes() {
  const { user } = useAuth();

  const { data: history } = useQuery({
    queryKey: ["emotional_checkins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emotional_checkins")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const summary = computeEmotionalSummary(history ?? []);

  const moodLabel = summary.averageMood30Days == null
    ? "Sem base"
    : MOODS.reduce((best, item) => Math.abs(item.v - summary.averageMood30Days!) < Math.abs(best.v - summary.averageMood30Days!) ? item : best).label;

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Seu dinheiro também tem contexto</h1>
        <p className="text-sm text-muted-foreground">Check-ins curtos ajudam a perceber padrões sem culpa e escolher uma próxima ação.</p>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <Flame className="h-4 w-4 text-orange-500" />
          <p className="mt-2 text-lg font-bold">{summary.streakDays}</p>
          <p className="text-[10px] text-muted-foreground">dias de sequência</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <Target className="h-4 w-4 text-primary" />
          <p className="mt-2 text-lg font-bold">{summary.checkinsLast7Days}/{summary.weeklyGoal}</p>
          <p className="text-[10px] text-muted-foreground">meta semanal</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <Sparkles className="h-4 w-4 text-success" />
          <p className="mt-2 truncate text-sm font-bold">{moodLabel}</p>
          <p className="text-[10px] text-muted-foreground">humor em 30 dias</p>
        </div>
        <div className="col-span-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${summary.weeklyProgress * 100}%` }} />
        </div>
      </section>

      <EmotionalCheckinCard />

      <section className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb size={15} className="text-primary" /> Próxima ação sugerida</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {summary.dominantTrigger
            ? `“${summary.dominantTrigger}” foi o gatilho mais registrado nos últimos 30 dias. Na próxima ocorrência, faça uma pausa de 10 minutos antes de decidir e anote se a vontade mudou.`
            : "Registre o gatilho junto do humor. Com alguns dias de histórico, o Nino transforma repetição em uma ação curta e verificável."}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">Isso é um padrão descritivo, não um diagnóstico psicológico nem uma relação de causa.</p>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Histórico recente</h2>
        {!history || history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            <Smile className="mx-auto mb-2 h-6 w-6" />
            Ainda não há check-ins registrados.
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    {emotionLabel(h.emotion_key ?? h.trigger_label, Number(h.mood))}
                  </p>
                  {h.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground">{h.notes}</p>}
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(h.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EmotionFinancePatterns />
      <BehavioralInsightsCard />
    </div>
  );
}
