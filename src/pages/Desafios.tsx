import { useEffect, useState } from "react";
import { Trophy, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { progressToNext } from "@/lib/gamification/rules";

export default function Desafios() {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [gam, setGam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: c }, { data: m }, { data: g }] = await Promise.all([
      supabase.from("challenges_catalog" as any).select("*").eq("active", true),
      supabase.from("user_challenges" as any).select("*"),
      supabase.from("user_gamification" as any).select("*").maybeSingle(),
    ]);
    setCatalog(c ?? []); setMine(m ?? []); setGam(g); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const join = async (slug: string) => {
    const { error } = await supabase.rpc("join_challenge" as any, { p_slug: slug });
    if (error) return toast.error(error.message);
    toast.success("Desafio iniciado!");
    await load();
  };

  const abandon = async (id: string) => {
    if (!confirm("Abandonar este desafio?")) return;
    const { error } = await supabase.from("user_challenges" as any).update({ status: "abandoned" }).eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  if (loading) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  const xp = gam?.total_xp ?? 0;
  const prog = progressToNext(xp);

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Desafios</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Hábitos financeiros gamificados sem pressão</p>
      </div>

      <div className="surface-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 grid place-items-center">
            <Zap className="text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Nível {prog.level}</p>
            <p className="text-lg font-bold">{xp} XP</p>
            <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${prog.percent}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{prog.current}/{prog.next} para o próximo nível</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {catalog.map((c: any) => {
          const uc = mine.find((m: any) => m.challenge_slug === c.slug);
          const progress = uc?.current_progress ?? 0;
          const pct = Math.min(100, (progress / c.goal_value) * 100);
          const status = uc?.status ?? "not_started";
          return (
            <div key={c.slug} className="surface-card p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-coral/15 grid place-items-center">
                  <Trophy size={18} className="text-brand-coral" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{c.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Recompensa: {c.xp_reward} XP · {c.duration_days} dias</p>
                  {uc && (
                    <>
                      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{progress}/{c.goal_value} · {status}</p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {status === "not_started" && (
                  <button onClick={() => join(c.slug)} className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs">Aderir</button>
                )}
                {status === "active" && (
                  <button onClick={() => abandon(uc.id)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Abandonar</button>
                )}
                {status === "completed" && (
                  <span className="text-xs text-success font-medium">✓ Concluído</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
