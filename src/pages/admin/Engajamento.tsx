import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Zap, LayoutGrid } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";

export default function Engajamento() {
  const q = useQuery({
    queryKey: ["admin_engagement_full"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_engagement_stats");
      if (error) throw error;
      return data as Record<string, number>;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engajamento"
        description="Uso do produto e ativação — métricas agregadas, sem exposição individual."
      />

      {q.isLoading ? (
        <div className="space-y-6"><SkeletonStats count={3} /><SkeletonStats count={3} /></div>
      ) : q.data ? (
        <div className="space-y-6">
          <Section title="Atividade recente" icon={TrendingUp}>
            <StatGrid cols={3}>
              <StatCard label="Ativos hoje" value={q.data.dau ?? 0} tone="primary" />
              <StatCard label="Ativos 7 dias" value={q.data.wau ?? 0} tone="primary" />
              <StatCard label="Ativos 30 dias" value={q.data.mau ?? 0} tone="primary" />
            </StatGrid>
          </Section>
          <Section title="Ativação" icon={Zap} description="Marcos que sinalizam usuário engajado.">
            <StatGrid cols={3}>
              <StatCard label="Primeiro lançamento" value={q.data.activation_first_transaction ?? 0} tone="success" />
              <StatCard label="Primeira meta" value={q.data.activation_first_goal ?? 0} tone="success" />
              <StatCard label="WhatsApp vinculado" value={q.data.activation_whatsapp ?? 0} tone="success" />
            </StatGrid>
          </Section>
          <Section title="Uso de módulos" icon={LayoutGrid}>
            <StatGrid cols={3}>
              <StatCard label="Divisão do Rolê" value={q.data.total_splits ?? 0} />
              <StatCard label="Recorrências" value={q.data.total_recurring_rules ?? 0} />
              <StatCard label="Desafios ativados" value={q.data.total_challenges_joined ?? 0} />
            </StatGrid>
          </Section>
        </div>
      ) : (
        <EmptyState title="Sem dados ainda" description="Quando os usuários começarem a interagir, você verá os números aqui." />
      )}
    </div>
  );
}
