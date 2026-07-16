import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, CheckCircle2, XCircle, Play } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { WhatsAppSessionPanel } from "./WhatsAppSessionPanel";

type Health = {
  configured: boolean;
  secrets: Record<string, boolean>;
  health: { ok: boolean; latency_ms: number; error?: string } | null;
  session: { status: string } | null;
};

export default function AgenteAdmin() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);

  const checkHealth = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: {} });
    setLoading(false);
    if (error) { toast.error("Falha ao consultar mensageria."); return; }
    setHealth(data as Health);
  };
  useEffect(() => { checkHealth(); }, []);

  const { data: prompts } = useQuery({
    queryKey: ["agent_prompts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_prompt_versions").select("*").order("version", { ascending: false });
      if (error) throw error; return data;
    },
  });
  const { data: settings } = useQuery({
    queryKey: ["agent_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agent_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error; return data;
    },
  });
  const { data: links } = useQuery({
    queryKey: ["wl_stats"],
    queryFn: async () => {
      const { data: all } = await supabase.from("whatsapp_links").select("status");
      const rows = (all as { status: string }[] | null) ?? [];
      return {
        total: rows.length,
        active: rows.filter(r => r.status === "active").length,
        revoked: rows.filter(r => r.status === "revoked").length,
      };
    },
  });
  const { data: outbox } = useQuery({
    queryKey: ["outbox_stats"],
    queryFn: async () => {
      const { data } = await supabase.from("outbound_messages").select("status");
      const rows = (data as { status: string }[] | null) ?? [];
      return {
        queued: rows.filter(r => r.status === "queued").length,
        sent: rows.filter(r => r.status === "sent").length,
        delivered: rows.filter(r => r.status === "delivered").length,
        failed: rows.filter(r => r.status === "failed").length,
        dead: rows.filter(r => r.status === "dead").length,
      };
    },
  });

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <header className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Agente & Mensageria</h1>
          <p className="text-sm text-muted-foreground">Painel administrativo — apenas admins.</p>
        </div>
        <a href="/admin/agente/simulador" className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">Abrir simulador</a>
      </header>

      {!health?.configured && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5 mb-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-yellow-700 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-yellow-900">Configuração pendente</p>
            <p className="text-yellow-800 mt-1">
              A integração WhatsApp (WAHA) ainda não está configurada. Adicione os secrets abaixo em Project Settings → Secrets para ativar.
            </p>
            <ul className="mt-3 space-y-1">
              {Object.entries(health?.secrets ?? { WAHA_API_URL: false, WAHA_API_KEY: false, WAHA_WEBHOOK_SECRET: false, CRON_SECRET: false, LOVABLE_API_KEY: false }).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2">
                  {v ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
                  <code className="text-xs">{k}</code>
                  <span className="text-xs text-muted-foreground">{v ? "configurado" : "não configurado"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Sessão WAHA</p>
          <p className="mt-1 font-semibold">{health?.session?.status ?? "—"}</p>
          {health?.health && (
            <p className="text-xs text-muted-foreground mt-1">
              Latência: {health.health.latency_ms}ms • {health.health.ok ? "ok" : health.health.error}
            </p>
          )}
          <button onClick={checkHealth} disabled={loading} className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Reverificar
          </button>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Vínculos</p>
          <p className="mt-1 text-2xl font-bold">{links?.active ?? 0}</p>
          <p className="text-xs text-muted-foreground">ativos • {links?.revoked ?? 0} revogados • {links?.total ?? 0} total</p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Outbox</p>
          <ul className="mt-1 text-sm space-y-0.5">
            <li>Fila: <strong>{outbox?.queued ?? 0}</strong></li>
            <li>Enviadas: {outbox?.sent ?? 0}</li>
            <li>Entregues: {outbox?.delivered ?? 0}</li>
            <li>Falha/Dead-letter: {(outbox?.failed ?? 0) + (outbox?.dead ?? 0)}</li>
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Configurações do agente</p>
          {settings ? (
            <ul className="mt-1 text-sm space-y-0.5">
              <li>Modelo: <code className="text-xs">{settings.model}</code></li>
              <li>Temp: {Number(settings.temperature)}</li>
              <li>Passos max: {settings.max_steps}</li>
              <li>Timeout: {settings.timeout_ms}ms</li>
              <li>Proativas: <span className={settings.proactive_enabled ? "text-orange-600" : "text-green-700"}>{settings.proactive_enabled ? "on" : "off"}</span></li>
            </ul>
          ) : <p className="text-xs text-muted-foreground">Carregando…</p>}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold mb-3">Versões do prompt</h2>
        <div className="rounded-xl border bg-card divide-y">
          {(prompts ?? []).length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma versão publicada. O agente responde com mensagem neutra até que uma versão ativa exista.</p>
          )}
          {(prompts ?? []).map((p) => (
            <div key={p.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">v{p.version} · <span className="text-xs uppercase text-muted-foreground">{p.status}</span></p>
                <p className="text-xs text-muted-foreground">{p.notes ?? "—"}</p>
              </div>
              {p.status !== "active" && (
                <button
                  onClick={async () => {
                    const { error } = await supabase.rpc("set_active_prompt_version", { p_id: p.id });
                    if (error) toast.error("Falha ao ativar."); else toast.success("Versão ativada.");
                  }}
                  className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
                >Ativar</button>
              )}
            </div>
          ))}
        </div>
      </section>

      <WhatsAppSessionPanel />
    </div>
  );
}
