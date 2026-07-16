import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, Activity, Bot, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
      return data as any;
    },
  });
  const agent = useQuery({
    queryKey: ["admin_agent_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_agent_stats");
      if (error) throw error;
      return data as any;
    },
  });
  const ops = useQuery({
    queryKey: ["admin_ops_health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_ops_health");
      if (error) throw error;
      return data as any;
    },
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Visão Geral</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Métricas agregadas do negócio NoControle.ia — sem exposição de dados pessoais dos usuários.
        </p>
      </header>

      <Section title="Usuários" icon={Users}>
        {base.isLoading ? <Spinner /> : base.data ? (
          <Grid>
            <Stat label="Total" value={base.data.total_users} />
            <Stat label="Novos 7d" value={base.data.new_users_7d} />
            <Stat label="Novos 30d" value={base.data.new_users_30d} />
            <Stat label="Onboarding concluído" value={base.data.onboarded_users} />
          </Grid>
        ) : <Empty />}
      </Section>

      <Section title="Engajamento (últimos períodos)" icon={Activity}>
        {engagement.isLoading ? <Spinner /> : engagement.data ? (
          <Grid>
            <Stat label="Ativos 1d" value={engagement.data.dau ?? 0} />
            <Stat label="Ativos 7d" value={engagement.data.wau ?? 0} />
            <Stat label="Ativos 30d" value={engagement.data.mau ?? 0} />
            <Stat label="Ativação: primeiro lançamento" value={engagement.data.activation_first_transaction ?? 0} />
            <Stat label="Ativação: primeira meta" value={engagement.data.activation_first_goal ?? 0} />
            <Stat label="WhatsApp vinculado" value={engagement.data.activation_whatsapp ?? 0} />
            <Stat label="Divisão do Rolê criadas" value={engagement.data.total_splits ?? 0} />
            <Stat label="Recorrências criadas" value={engagement.data.total_recurring_rules ?? 0} />
          </Grid>
        ) : <Empty />}
      </Section>

      <Section title="Volume agregado (sem PII)" icon={Wallet}>
        {base.data ? (
          <Grid>
            <Stat label="Contas" value={base.data.total_accounts} />
            <Stat label="Lançamentos" value={base.data.total_transactions} />
            <Stat label="Metas" value={base.data.total_goals} />
            <Stat label="Investimentos" value={base.data.total_investments} />
            <Stat label="Dívidas" value={base.data.total_debts} />
          </Grid>
        ) : null}
      </Section>

      <Section title="Agente (7 dias)" icon={Bot}>
        {agent.isLoading ? <Spinner /> : agent.data ? (
          <Grid>
            <Stat label="Runs totais" value={agent.data.runs_total ?? 0} />
            <Stat label="Runs 7d" value={agent.data.runs_7d ?? 0} />
            <Stat label="Falhas 7d" value={agent.data.runs_failed_7d ?? 0} />
            <Stat label="Tokens 7d" value={agent.data.tokens_7d ?? 0} />
            <Stat label="Custo USD 7d" value={Number(agent.data.cost_usd_7d ?? 0).toFixed(2)} />
          </Grid>
        ) : <Empty />}
      </Section>

      <Section title="Saúde da operação" icon={Activity}>
        {ops.isLoading ? <Spinner /> : ops.data ? (
          <Grid>
            <Stat label="Outbox pendentes" value={ops.data.outbox_queued ?? 0} />
            <Stat label="Outbox falhas" value={ops.data.outbox_failed ?? 0} />
            <Stat label="Outbox dead" value={ops.data.outbox_dead ?? 0} />
            <Stat label="Lembretes pendentes" value={ops.data.reminders_queued ?? 0} />
            <Stat label="Importações 7d" value={ops.data.imports_recent ?? 0} />
            <Stat label="Exclusões em análise" value={ops.data.deletion_pending ?? 0} />
          </Grid>
        ) : <Empty />}
      </Section>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon size={14} className="text-primary" /> {title}
      </h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="surface-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}

function Spinner() {
  return <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}
function Empty() {
  return <p className="text-sm text-muted-foreground">Sem dados suficientes ainda.</p>;
}
