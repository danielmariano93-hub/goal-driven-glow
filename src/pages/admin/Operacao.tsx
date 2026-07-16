import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const CRON_ENDPOINTS: { label: string; endpoint: string; desc: string }[] = [
  { label: "WhatsApp — envio outbox", endpoint: "whatsapp-send", desc: "Processa fila de mensagens outbound" },
  { label: "WhatsApp — ACK watchdog", endpoint: "whatsapp-ack-watchdog", desc: "Reconcilia ACKs pendentes" },
  { label: "Split — lembretes", endpoint: "split-reminders-dispatch", desc: "Dispara lembretes de divisões" },
  { label: "Recorrências — geração", endpoint: "recurring-generate", desc: "Gera ocorrências agendadas" },
];

export default function Operacao() {
  const q = useQuery({
    queryKey: ["admin_ops_full"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_ops_health");
      if (error) throw error;
      return data as any;
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Operação</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filas, jobs e dead letters. Ações destrutivas exigem confirmação e ficam auditadas.
          </p>
        </div>
        <button onClick={() => q.refetch()} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1">
          <RefreshCcw size={12} /> Atualizar
        </button>
      </header>

      {q.isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : q.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Outbox pendentes" value={q.data.outbox_queued ?? 0} />
          <Card label="Outbox processando" value={q.data.outbox_processing ?? 0} />
          <Card label="Outbox falhas" value={q.data.outbox_failed ?? 0} />
          <Card label="Outbox dead letters" value={q.data.outbox_dead ?? 0} />
          <Card label="Lembretes pendentes" value={q.data.reminders_queued ?? 0} />
          <Card label="Lembretes falhas" value={q.data.reminders_failed ?? 0} />
          <Card label="Importações 7d" value={q.data.imports_recent ?? 0} />
          <Card label="Exclusões em análise" value={q.data.deletion_pending ?? 0} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem dados.</p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Cron endpoints</h2>
        <div className="surface-card divide-y divide-border">
          {CRON_ENDPOINTS.map((c) => (
            <div key={c.endpoint} className="p-4">
              <p className="text-sm font-medium">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.desc}</p>
              <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                POST /functions/v1/{c.endpoint} · header: x-cron-secret
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Configure schedulers externos (cron-job.org, GitHub Actions, etc.) enviando o secret <code>CRON_SECRET</code>.
        </p>
      </section>
    </div>
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
