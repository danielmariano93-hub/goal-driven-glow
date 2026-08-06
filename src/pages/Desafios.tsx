import { Trophy, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { progressToNext } from "@/lib/gamification/rules";

type CatalogRow = {
  slug: string;
  title: string;
  description: string | null;
  kind: string;
  goal_value: number | null;
  duration_days: number | null;
  xp_reward: number | null;
};

type UserChallenge = {
  id: string;
  challenge_slug: string | null;
  status: "joined" | "completed" | "abandoned";
  progress: number;
  current_progress: number;
};

export default function Desafios() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["challenges", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [catalog, mine, gam] = await Promise.all([
        supabase.from("challenges_catalog").select("*").eq("active", true).order("title"),
        supabase.from("user_challenges").select("id, challenge_slug, status, progress, current_progress"),
        supabase.from("user_gamification").select("*").maybeSingle(),
      ]);
      if (catalog.error) throw catalog.error;
      if (mine.error) throw mine.error;
      return {
        catalog: (catalog.data ?? []) as CatalogRow[],
        mine: (mine.data ?? []) as UserChallenge[],
        gam: gam.data as { total_xp: number | null } | null,
      };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["challenges"] });

  const join = async (slug: string) => {
    const { error } = await supabase.rpc("join_challenge", { p_slug: slug });
    if (error) return toast.error("Não deu para aderir agora. Tente novamente.");
    toast.success("Desafio iniciado!");
    await refresh();
  };

  const abandon = async (slug: string) => {
    const { error } = await supabase.rpc("abandon_challenge", { p_slug: slug });
    if (error) return toast.error("Não deu para abandonar agora.");
    toast.success("Desafio encerrado.");
    await refresh();
  };

  const complete = async (slug: string) => {
    const { error } = await supabase.rpc("complete_challenge", { p_slug: slug });
    if (error) return toast.error("Não deu para concluir agora.");
    toast.success("Desafio concluído! XP creditado.");
    await refresh();
  };

  if (isLoading) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  const xp = data?.gam?.total_xp ?? 0;
  const prog = progressToNext(xp);

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-20 pt-2">
      <header>
        <h1 className="font-display text-xl font-bold tracking-tight">Desafios</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Hábitos financeiros gamificados, sem pressão.</p>
      </header>

      <section className="rounded-[18px] border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10"><Zap className="text-primary" /></div>
          <div className="flex-1">
            <p className="text-[11px] text-muted-foreground">Nível {prog.level}</p>
            <p className="font-display text-lg font-bold">{xp} XP</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${prog.percent}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{prog.current}/{prog.next} para o próximo nível</p>
          </div>
        </div>
      </section>

      {(data?.catalog.length ?? 0) === 0 ? (
        <section className="rounded-[18px] border border-dashed border-border bg-card p-8 text-center">
          <Trophy className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-[13px] text-muted-foreground">Nenhum desafio disponível por enquanto.</p>
        </section>
      ) : (
        <div className="space-y-3">
          {data!.catalog.map((c) => {
            const uc = data!.mine.find((m) => m.challenge_slug === c.slug);
            const goal = Number(c.goal_value ?? 0);
            const current = Number(uc?.current_progress ?? 0);
            const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : Number(uc?.progress ?? 0);
            const status = uc?.status ?? "not_started";
            return (
              <article key={c.slug} className="rounded-[18px] border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-coral/15">
                    <Trophy size={18} className="text-brand-coral" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">{c.title}</p>
                    {c.description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{c.description}</p> : null}
                    <p className="mt-1 text-[10px] text-muted-foreground">Recompensa: {c.xp_reward ?? 0} XP · {c.duration_days ?? 0} dias</p>
                    {uc && status !== "abandoned" ? (
                      <>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {goal > 0 ? `${current}/${goal}` : `${Math.round(pct)}%`} · {status === "completed" ? "concluído" : "em andamento"}
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(status === "not_started" || status === "abandoned") && (
                    <button type="button" onClick={() => join(c.slug)} className="min-h-10 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">
                      {status === "abandoned" ? "Recomeçar" : "Aderir"}
                    </button>
                  )}
                  {status === "joined" && (
                    <>
                      <button type="button" onClick={() => complete(c.slug)} className="min-h-10 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">Concluir</button>
                      <button type="button" onClick={() => abandon(c.slug)} className="min-h-10 rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground">Abandonar</button>
                    </>
                  )}
                  {status === "completed" && <span className="text-xs font-semibold text-success">✓ Concluído</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
