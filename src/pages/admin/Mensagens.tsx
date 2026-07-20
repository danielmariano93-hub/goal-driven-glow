import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCheck, Clock3, MessageCircle, RefreshCw, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type MessageRow = {
  id: string; created_at: string; updated_at: string; sent_at: string | null;
  status: string; channel: string; kind: string; attempts: number; last_error: string | null;
  provider_message_id: string | null; context_type: string | null; context_id: string | null;
  participant_id: string | null; recipient: string; preview: string; metadata: Record<string, unknown>;
};
type Metrics = { total: number; queued: number; sent: number; delivered: number; failed: number; split: number };
type ConversationRow = { id: string; created_at: string; direction: "inbound" | "outbound"; source: string; contact: string | null; preview: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Aguardando envio", cls: "bg-amber-100 text-amber-800" },
  processing: { label: "Enviando", cls: "bg-blue-100 text-blue-800" },
  sent: { label: "Enviada", cls: "bg-blue-100 text-blue-800" },
  delivered: { label: "Entregue", cls: "bg-emerald-100 text-emerald-800" },
  read: { label: "Lida", cls: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-800" },
  dead: { label: "Falha definitiva", cls: "bg-red-100 text-red-800" },
};

export default function MensagensAdmin() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const from = useMemo(() => new Date(Date.now() - 7 * 86400000).toISOString(), []);
  const to = new Date().toISOString();
  const messages = useQuery({
    queryKey: ["admin_message_activity", status, kind],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_message_activity", {
        p_from: from, p_to: to, p_status: status || null, p_kind: kind || null, p_limit: 200, p_offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
    refetchInterval: 15000,
  });
  const metrics = useQuery({
    queryKey: ["admin_message_metrics"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_message_metrics", { p_from: from, p_to: to });
      if (error) throw error;
      return data as Metrics;
    },
    refetchInterval: 15000,
  });
  const conversations = useQuery({
    queryKey: ["admin_conversation_activity"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_conversation_activity", { p_from: from, p_to: to, p_limit: 100 });
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
    refetchInterval: 15000,
  });
  const kinds = [...new Set((messages.data ?? []).map((m) => m.kind))].sort();
  const refresh = () => { void messages.refetch(); void metrics.refetch(); void conversations.refetch(); };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Mensagens</h1>
        <p className="mt-1 text-sm text-muted-foreground">Histórico real da fila, WhatsApp, assessor e cobranças da Divisão do Rolê.</p>
      </div>
      <button onClick={refresh} className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs"><RefreshCw size={14}/> Atualizar</button>
    </header>

    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Metric icon={MessageCircle} label="Total 7 dias" value={metrics.data?.total ?? 0}/>
      <Metric icon={Clock3} label="Na fila" value={metrics.data?.queued ?? 0}/>
      <Metric icon={Send} label="Enviadas" value={metrics.data?.sent ?? 0}/>
      <Metric icon={CheckCheck} label="Entregues/lidas" value={metrics.data?.delivered ?? 0}/>
      <Metric icon={AlertCircle} label="Falhas" value={metrics.data?.failed ?? 0}/>
    </section>

    <section className="surface-card p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm">
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border bg-background px-3 py-2 text-sm">
          <option value="">Todas as origens</option>
          {kinds.map((value) => <option key={value} value={value}>{friendlyKind(value)}</option>)}
        </select>
      </div>
      {messages.isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Carregando histórico…</p>}
      {messages.isError && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar o histórico. Verifique se a migration deste patch foi implantada.</p>}
      {!messages.isLoading && (messages.data?.length ?? 0) === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem neste período.</p>}
      <div className="divide-y">
        {(messages.data ?? []).map((m) => {
          const s = STATUS[m.status] ?? { label: m.status, cls: "bg-secondary text-foreground" };
          return <article key={m.id} className="grid gap-2 py-4 md:grid-cols-[150px_1fr_160px] md:items-start">
            <div>
              <p className="text-xs font-medium">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
              <p className="text-[11px] text-muted-foreground">{m.recipient} · tentativa {m.attempts}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold">{friendlyKind(m.kind)}</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">{m.preview}</p>
              {m.last_error && <p className="mt-1 text-xs text-red-600">{friendlyError(m.last_error)}</p>}
            </div>
            <div className="md:text-right">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
              {m.context_type === "shared_expense" && <p className="mt-1 text-[11px] text-muted-foreground">Divisão do Rolê</p>}
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className="surface-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Conversas do assessor</h2>
        <p className="text-xs text-muted-foreground">Mensagens do app e do WhatsApp, já armazenadas de forma mascarada.</p>
      </div>
      {conversations.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando conversas…</p>}
      <div className="divide-y">
        {(conversations.data ?? []).map((m) => <article key={m.id} className="grid gap-2 py-3 md:grid-cols-[150px_110px_1fr]">
          <div><p className="text-xs font-medium">{new Date(m.created_at).toLocaleString("pt-BR")}</p><p className="text-[11px] text-muted-foreground">{m.contact ?? "Usuário do app"}</p></div>
          <div><span className="rounded-full bg-secondary px-2 py-1 text-[11px]">{m.source} · {m.direction === "inbound" ? "recebida" : "respondida"}</span></div>
          <p className="break-words text-sm text-muted-foreground">{m.preview}</p>
        </article>)}
      </div>
    </section>
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof MessageCircle; label: string; value: number }) {
  return <div className="surface-card p-4"><Icon size={15} className="text-muted-foreground"/><p className="mt-2 text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}
function friendlyKind(kind: string) {
  if (kind.startsWith("split_")) return `Divisão do Rolê · ${kind.replace("split_", "").replaceAll("_", " ")}`;
  if (kind === "agent") return "Resposta do assessor";
  if (kind === "system") return "Mensagem de serviço";
  if (kind === "document_status") return "Status da importação";
  return kind.replaceAll("_", " ");
}
function friendlyError(error: string) {
  if (error.includes("timeout")) return "O provedor demorou para responder; uma nova tentativa será feita.";
  if (error.includes("not_configured")) return "Canal ainda não configurado.";
  return `Falha técnica: ${error.slice(0, 140)}`;
}
