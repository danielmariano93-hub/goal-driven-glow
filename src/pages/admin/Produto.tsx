import { useQuery } from "@tanstack/react-query";
import { Loader2, Trophy, Tag, Flag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function Produto() {
  const challenges = useQuery({
    queryKey: ["challenges_catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("challenges_catalog").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const categories = useQuery({
    queryKey: ["global_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").is("user_id", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Produto</h1>
        <p className="text-sm text-muted-foreground mt-1">Catálogo de desafios, categorias globais e feature flags.</p>
      </header>

      <Section title="Desafios" icon={Trophy}>
        {challenges.isLoading ? <Spinner /> :
          !challenges.data || challenges.data.length === 0 ? <Empty msg="Nenhum desafio configurado." /> : (
          <div className="surface-card divide-y divide-border">
            {challenges.data.map((c: any) => (
              <div key={c.slug} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{c.title}</p>
                  <span className={`text-[10px] rounded-full px-2 py-0.5 ${c.active ? "bg-success/10 text-success" : "bg-muted"}`}>
                    {c.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Meta: {c.goal_value} · XP: {c.xp_reward}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Categorias globais" icon={Tag}>
        {categories.isLoading ? <Spinner /> :
          !categories.data || categories.data.length === 0 ? <Empty msg="Nenhuma categoria global." /> : (
          <div className="surface-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr><th className="px-4 py-3 text-left">Nome</th><th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-left">Slug</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {categories.data.map((c: any) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.type}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.slug}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Feature flags" icon={Flag}>
        <div className="surface-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Módulo de flags ainda não configurado.</p>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon size={14} className="text-primary" /> {title}</h2>
      {children}
    </section>
  );
}
function Spinner() { return <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Empty({ msg }: { msg: string }) { return <div className="surface-card p-8 text-center"><p className="text-sm text-muted-foreground">{msg}</p></div>; }
