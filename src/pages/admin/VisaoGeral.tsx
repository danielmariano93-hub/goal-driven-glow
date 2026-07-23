import { useQuery } from "@tanstack/react-query";
import { Users, Activity, Bot, Wallet, TrendingUp, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/admin/StatusChip";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { mapWhatsAppStatus, mapAgentStatus } from "@/lib/admin/statusMapper";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";

type Stats = {
  total_users: number;
  new_users_7d: number;
  new_users_30d: number;
  onboarded_users: number;
  total_transactions: number;
  total_accounts: number;
  total_goals: number;
  total_investments: number;
  total_debts: number;
};

export default function VisaoGeral() {
  const base = useQuery({
    queryKey: ["admin_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard_stats");
      if (error) throw error;
      return data as unknown as Stats;
    },
  });
  const engagement = useQuery({
    queryKey: ["admin_engagement"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_engagement_stats");
      if (error) throw error;
      return data as Record<string, number>;
    },
  });
  const agent = useQuery({
    queryKey: ["admin_agent_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_agent_stats");
      if (error) throw error;
      return data as Record<string, number>;
    },
  });
  const ops = useQuery({
    queryKey: ["admin_ops_health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_ops_health");
      if (error) throw error;
      return data as Record<string, number>;
    },
  });

  const platform = useAdminPlatformStatus();
  const wa = platform.data?.whatsapp;
  const ag = platform.data?.agent;
  const total = base.data?.total_users ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Visão Geral"
        description="Métricas agregadas do negócio MeuNino — sem exposição de dados pessoais dos usuários."
        status={
          <>
            {ag && <StatusChip view={mapAgentStatus(ag.status)} size="sm" />}
            {wa && <StatusChip view={mapWhatsAppStatus(wa.status)} size="sm" />}
          </>
        }
      />

      <Section title="Usuários" icon={Users}>
        {base.isLoading ? (
          <SkeletonStats />
        ) : base.data && total > 0 ? (
          <StatGrid>
            <StatCard label="Total" value={base.data.total_users} icon={Users} />
            <StatCard label="Novos 7 dias" value={base.data.new_users_7d} tone="primary" />
            <StatCard label="Novos 30 dias" value={base.data.new_users_30d} tone="primary" />
            <StatCard label="Onboarding concluído" value={base.data.onboarded_users} tone="success" />
          </StatGrid>
        ) : (
          <EmptyState
            icon={Users}
            title="Nenhum usuário por aqui ainda"
            description="Quando alguém entrar no MeuNino e ativar o perfil financeiro, aparece aqui."
          />
        )}
      </Section>

      <Section title="Engajamento" icon={Activity} description="Uso do produto nos últimos períodos.">
        {engagement.isLoading ? (
          <SkeletonStats count={6} />
        ) : engagement.data ? (
          <StatGrid cols={4}>
            <StatCard label="Ativos 1 dia" value={engagement.data.dau ?? 0} />
            <StatCard label="Ativos 7 dias" value={engagement.data.wau ?? 0} />
            <StatCard label="Ativos 30 dias" value={engagement.data.mau ?? 0} />
            <StatCard label="Primeiro lançamento" value={engagement.data.activation_first_transaction ?? 0} tone="success" />
            <StatCard label="Primeira meta" value={engagement.data.activation_first_goal ?? 0} tone="success" />
            <StatCard label="WhatsApp vinculado" value={engagement.data.activation_whatsapp ?? 0} icon={MessageCircle} />
            <StatCard label="Divisão do Rolê criadas" value={engagement.data.total_splits ?? 0} />
            <StatCard label="Recorrências criadas" value={engagement.data.total_recurring_rules ?? 0} />
          </StatGrid>
        ) : (
          <EmptyState title="Sem dados suficientes ainda" compact />
        )}
      </Section>

      <Section title="Volume agregado" icon={Wallet} description="Contagens totais — nunca exibimos dados individuais.">
        {base.data ? (
          <StatGrid>
            <StatCard label="Contas" value={base.data.total_accounts} />
            <StatCard label="Lançamentos" value={base.data.total_transactions} />
            <StatCard label="Metas" value={base.data.total_goals} />
            <StatCard label="Investimentos" value={base.data.total_investments} />
            <StatCard label="Dívidas" value={base.data.total_debts} />
          </StatGrid>
        ) : null}
      </Section>

      <Section title="Agente (7 dias)" icon={Bot}>
        {agent.isLoading ? (
          <SkeletonStats count={5} />
        ) : agent.data ? (
          <StatGrid>
            <StatCard label="Runs totais" value={agent.data.runs_total ?? 0} />
            <StatCard label="Runs 7 dias" value={agent.data.runs_7d ?? 0} tone="primary" />
            <StatCard label="Falhas 7 dias" value={agent.data.runs_failed_7d ?? 0} tone="destructive" />
            <StatCard label="Tokens 7 dias" value={Number(agent.data.tokens_7d ?? 0).toLocaleString("pt-BR")} />
            <StatCard label="Custo (USD) 7d" value={`$${Number(agent.data.cost_usd_7d ?? 0).toFixed(2)}`} />
          </StatGrid>
        ) : (
          <EmptyState title="Sem execuções ainda" compact />
        )}
      </Section>

      <Section title="Saúde da operação" icon={TrendingUp}>
        {ops.isLoading ? (
          <SkeletonStats count={6} />
        ) : ops.data ? (
          <StatGrid>
            <StatCard label="Outbox pendentes" value={ops.data.outbox_queued ?? 0} />
            <StatCard label="Outbox falhas" value={ops.data.outbox_failed ?? 0} tone={ops.data.outbox_failed > 0 ? "warning" : "default"} />
            <StatCard label="Outbox dead" value={ops.data.outbox_dead ?? 0} tone={ops.data.outbox_dead > 0 ? "destructive" : "default"} />
            <StatCard label="Lembretes pendentes" value={ops.data.reminders_queued ?? 0} />
            <StatCard label="Importações 7 dias" value={ops.data.imports_recent ?? 0} />
            <StatCard label="Exclusões em análise" value={ops.data.deletion_pending ?? 0} />
          </StatGrid>
        ) : (
          <EmptyState title="Sem dados de operação" compact />
        )}
      </Section>
    </div>
  );
}
