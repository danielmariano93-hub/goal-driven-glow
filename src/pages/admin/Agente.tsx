import { useQuery } from "@tanstack/react-query";
import { Bot, MessageCircle, Users2, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/admin/StatusChip";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { mapWhatsAppStatus, mapAgentStatus, humanizeRelative } from "@/lib/admin/statusMapper";

type PromptRow = {
  id: string;
  version: number;
  status: string;
  notes: string | null;
};

export default function AgenteAdmin() {
  const status = useAdminPlatformStatus();

  const links = useQuery({
    queryKey: ["wl_stats"],
    queryFn: async () => {
      const { data } = await supabase.from("whatsapp_links").select("status");
      const rows = (data as { status: string }[] | null) ?? [];
      return {
        active: rows.filter((r) => r.status === "active").length,
        total: rows.length,
      };
    },
  });

  const outbox = useQuery({
    queryKey: ["outbox_summary"],
    queryFn: async () => {
      const { data } = await supabase.from("outbound_messages").select("status");
      const rows = (data as { status: string }[] | null) ?? [];
      return {
        queued: rows.filter((r) => r.status === "queued").length,
        delivered: rows.filter((r) => r.status === "delivered").length,
        failed: rows.filter((r) => ["failed", "dead"].includes(r.status)).length,
      };
    },
  });

  const prompts = useQuery({
    queryKey: ["agent_prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_prompt_versions")
        .select("id,version,status,notes")
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PromptRow[];
    },
  });

  const agent = status.data?.agent;
  const wa = status.data?.whatsapp;
  const view = mapAgentStatus(agent?.status);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Assistente</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Como o assistente do NoControle.ia está atendendo os usuários no WhatsApp.
        </p>
      </header>

      <section className="surface-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip view={view} />
          <span className="text-sm text-muted-foreground">{view.impact}</span>
        </div>
        {wa && wa.status !== "connected" && (
          <p className="text-xs text-muted-foreground mt-3">
            Canal WhatsApp: <span className="font-medium">{mapWhatsAppStatus(wa.status).label}</span>.
            Ajuste em <a className="underline" href="/admin/whatsapp">WhatsApp</a> para restabelecer o atendimento.
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card icon={Users2} label="Vínculos ativos" value={links.data?.active ?? 0} />
        <Card icon={MessageCircle} label="Mensagens em fila" value={outbox.data?.queued ?? 0} />
        <Card icon={Bot} label="Entregues" value={outbox.data?.delivered ?? 0} />
        <Card icon={Activity} label="Falhas 24h" value={agent?.failures_24h ?? 0} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Comportamento do assistente</h2>
        <div className="surface-card divide-y divide-border">
          {prompts.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
          ) : (prompts.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhuma versão publicada ainda. Publique uma versão para ativar o assistente.
            </p>
          ) : (
            (prompts.data ?? []).map((p) => (
              <div key={p.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    Versão {p.version}
                    <span className="ml-2 text-[11px] uppercase text-muted-foreground">
                      {p.status === "active" ? "publicada" : p.status}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{p.notes ?? "—"}</p>
                </div>
              </div>
            ))
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          A configuração detalhada do comportamento fica no simulador administrativo.
        </p>
      </section>
    </div>
  );
}

function Card({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wider">
        <Icon size={12} /> {label}
      </div>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}

// Silence unused imports when linting; humanizeRelative can be used later.
void humanizeRelative;
