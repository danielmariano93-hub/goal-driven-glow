import { useQuery } from "@tanstack/react-query";
import { Trophy, Tag, Flag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonList, SkeletonTable } from "@/components/admin/AdminSkeleton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Badge } from "@/components/ui/badge";

type Challenge = { slug: string; title: string; goal_value: number; xp_reward: number; active: boolean };
type Category = { id: string; name: string; type: string; slug: string };

export default function Produto() {
  const challenges = useQuery({
    queryKey: ["challenges_catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("challenges_catalog").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Challenge[];
    },
  });
  const categories = useQuery({
    queryKey: ["global_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").is("user_id", null).order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const catCols: Column<Category>[] = [
    { key: "name", header: "Nome", cell: (c) => c.name },
    { key: "type", header: "Tipo", cell: (c) => <span className="text-muted-foreground">{c.type}</span> },
    { key: "slug", header: "Slug", cell: (c) => <span className="font-mono text-xs text-muted-foreground">{c.slug}</span>, hideOnMobile: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produto"
        description="Catálogo de desafios, categorias globais e feature flags."
      />

      <Section title="Desafios" icon={Trophy}>
        {challenges.isLoading ? (
          <SkeletonList rows={3} />
        ) : !challenges.data || challenges.data.length === 0 ? (
          <EmptyState icon={Trophy} title="Nenhum desafio configurado" />
        ) : (
          <div className="surface-card divide-y divide-border">
            {challenges.data.map((c) => (
              <div key={c.slug} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Meta: {c.goal_value} · XP: {c.xp_reward}</p>
                </div>
                {c.active
                  ? <Badge className="bg-success/15 text-success border-success/30">Ativo</Badge>
                  : <Badge variant="secondary">Inativo</Badge>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Categorias globais" icon={Tag} description="Categorias padrão disponíveis para todos os usuários.">
        {categories.isLoading ? (
          <SkeletonTable rows={5} />
        ) : !categories.data || categories.data.length === 0 ? (
          <EmptyState icon={Tag} title="Nenhuma categoria global" />
        ) : (
          <DataTable rows={categories.data} columns={catCols} rowKey={(c) => c.id} ariaLabel="Categorias globais" />
        )}
      </Section>

      <Section title="Feature flags" icon={Flag}>
        <EmptyState title="Módulo de flags ainda não configurado" />
      </Section>
    </div>
  );
}
