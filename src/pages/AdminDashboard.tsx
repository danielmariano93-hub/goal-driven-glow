import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
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

export default function AdminDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard_stats");
      if (error) throw error;
      return data as unknown as Stats;
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-8">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-white">
              <ShieldCheck size={16} />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Admin</p>
              <p className="font-display text-base font-bold">NoControle.ia</p>
            </div>
          </div>
          <Link to="/app" className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
            Voltar ao app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        {isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Não foi possível carregar estatísticas.</p>
        ) : data ? (
          <>
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users size={14} /> Usuários
              </h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Total" value={data.total_users} />
                <Stat label="Novos 7d" value={data.new_users_7d} />
                <Stat label="Novos 30d" value={data.new_users_30d} />
                <Stat label="Onboarding concluído" value={data.onboarded_users} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold">Volume agregado (sem PII)</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Contas" value={data.total_accounts} />
                <Stat label="Lançamentos" value={data.total_transactions} />
                <Stat label="Metas" value={data.total_goals} />
                <Stat label="Investimentos" value={data.total_investments} />
                <Stat label="Dívidas" value={data.total_debts} />
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString("pt-BR")}</p>
    </div>
  );
}
