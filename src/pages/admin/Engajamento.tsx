import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function Engajamento() {
  const q = useQuery({
    queryKey: ["admin_engagement_full"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_engagement_stats");
      if (error) throw error;
      return data as any;
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Engajamento</h1>
        <p className="text-sm text-muted-foreground mt-1">Uso do produto e ativação — métricas agregadas.</p>
      </header>

      {q.isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : q.data ? (
        <div className="space-y-6">
          <Group title="Atividade recente">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card label="Ativos 1d" value={q.data.dau ?? 0} />
              <Card label="Ativos 7d" value={q.data.wau ?? 0} />
              <Card label="Ativos 30d" value={q.data.mau ?? 0} />
            </div>
          </Group>
          <Group title="Ativação">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card label="Primeiro lançamento" value={q.data.activation_first_transaction ?? 0} />
              <Card label="Primeira meta" value={q.data.activation_first_goal ?? 0} />
              <Card label="WhatsApp vinculado" value={q.data.activation_whatsapp ?? 0} />
            </div>
          </Group>
          <Group title="Uso de módulos">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card label="Divisão do Rolê" value={q.data.total_splits ?? 0} />
              <Card label="Recorrências" value={q.data.total_recurring_rules ?? 0} />
              <Card label="Desafios ativados" value={q.data.total_challenges_joined ?? 0} />
            </div>
          </Group>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}
