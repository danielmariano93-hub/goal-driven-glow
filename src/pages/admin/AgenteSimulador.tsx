import { useEffect, useState } from "react";
import { Loader2, Play, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type SimResult = {
  ok?: boolean;
  reply?: string;
  reply_kind?: string;
  draft_id?: string;
  result?: unknown;
  error?: string;
};

type SandboxUser = { id: string; display_name: string | null };

export default function AgenteSimulador() {
  const [sandbox, setSandbox] = useState<SandboxUser[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [phone, setPhone] = useState<string>("+5511999990000");
  const [text, setText] = useState<string>("gastei 42,90 no almoço hoje");
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ from: "user" | "agent"; body: string; kind?: string }>>([]);
  const [lastPending, setLastPending] = useState<any | null>(null);
  const [receipts, setReceipts] = useState<any[]>([]);

  useEffect(() => { void loadSandbox(); }, []);

  const loadSandbox = async () => {
    const { data } = await supabase.from("profiles").select("id, display_name, is_sandbox").eq("is_sandbox", true);
    const list = (data as any[] | null) ?? [];
    setSandbox(list);
    if (list[0]) setUserId(list[0].id);
  };

  const loadState = async (uid: string) => {
    const { data: pending } = await supabase.from("pending_confirmations")
      .select("id, kind, summary_text, status, expires_at")
      .eq("user_id", uid).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
    setLastPending(pending?.[0] ?? null);
    const { data: rec } = await supabase.from("pending_confirmations")
      .select("id, kind, summary_text, executed_at, result_snapshot, status")
      .eq("user_id", uid).in("status", ["confirmed", "cancelled"]).order("created_at", { ascending: false }).limit(10);
    setReceipts((rec as any[]) ?? []);
  };

  const send = async () => {
    if (!userId) { toast.error("Selecione um usuário sandbox."); return; }
    setBusy(true);
    try {
      const { data: enq, error: e1 } = await supabase.rpc("agent_sim_enqueue", {
        p_user_id: userId, p_from_phone: phone, p_text: text,
      });
      if (e1) throw e1;
      const meta = enq as { inbound_message_id: string; conversation_id: string };
      setTranscript(t => [...t, { from: "user", body: text }]);

      const { data: res, error: e2 } = await supabase.functions.invoke<SimResult>("agent-run", {
        body: {
          user_id: userId,
          conversation_id: meta.conversation_id,
          inbound_message_id: meta.inbound_message_id,
          text, to_phone: phone, source: "simulator",
        },
      });
      if (e2) throw e2;
      setTranscript(t => [...t, { from: "agent", body: res?.reply ?? "(sem resposta)", kind: res?.reply_kind }]);
      await loadState(userId);
    } catch (e: any) {
      toast.error("Falha: " + (e?.message ?? String(e)));
    } finally { setBusy(false); }
  };

  const quick = async (t: string) => {
    setText(t);
    setTimeout(send, 50);
  };

  const reset = async () => {
    if (!userId) return;
    if (!confirm("Apagar todos os dados do usuário sandbox?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("agent_sim_reset", { p_user_id: userId });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Sandbox limpo."); setTranscript([]); setLastPending(null); setReceipts([]); }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Simulador do Agente</h1>
        <p className="text-sm text-muted-foreground">Executa o mesmo pipeline do WhatsApp, sem enviar mensagem real.</p>
      </header>

      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5" />
        Simulação — nenhuma mensagem real é enviada. Use somente com usuários marcados como sandbox.
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold">Usuário sandbox</label>
            <select value={userId} onChange={e => setUserId(e.target.value)}
                    className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm">
              {sandbox.length === 0 && <option value="">Nenhum — marque um perfil com is_sandbox=true</option>}
              {sandbox.map(u => <option key={u.id} value={u.id}>{u.display_name ?? u.id.slice(0, 8)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold">Telefone simulado</label>
            <input value={phone} onChange={e => setPhone(e.target.value)}
                   className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
          </div>
          <div className="flex items-end">
            <button onClick={reset} disabled={busy || !userId}
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
              <RotateCcw className="h-3 w-3" /> Reset sandbox
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold">Mensagem</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {["gastei 42,90 no almoço hoje", "recebi 3000 salário", "transferir 100 de Nubank para Itaú", "resumo do mês", "CONFIRMAR", "CANCELAR"].map(s => (
              <button key={s} onClick={() => quick(s)} className="rounded-full border px-2 py-1 hover:bg-accent">{s}</button>
            ))}
          </div>
        </div>

        <button onClick={send} disabled={busy || !userId}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Enviar
        </button>
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <p className="text-sm font-semibold mb-2">Conversa</p>
        {transcript.length === 0 && <p className="text-xs text-muted-foreground">Envie uma mensagem para começar.</p>}
        <div className="space-y-2">
          {transcript.map((m, i) => (
            <div key={i} className={`text-sm rounded-lg px-3 py-2 max-w-[80%] ${m.from === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted"}`}>
              <div className="whitespace-pre-wrap">{m.body}</div>
              {m.kind && <div className="text-[10px] mt-1 opacity-70">{m.kind}</div>}
            </div>
          ))}
        </div>
      </div>

      {lastPending && (
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-sm font-semibold mb-1">Rascunho pendente</p>
          <p className="text-sm">{lastPending.summary_text}</p>
          <p className="text-xs text-muted-foreground mt-1">Kind: {lastPending.kind} · expira {new Date(lastPending.expires_at).toLocaleString("pt-BR")}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => quick("CONFIRMAR")} className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs">CONFIRMAR</button>
            <button onClick={() => quick("CANCELAR")} className="rounded-full border px-3 py-1 text-xs">CANCELAR</button>
          </div>
        </div>
      )}

      {receipts.length > 0 && (
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-sm font-semibold mb-2">Últimos recibos</p>
          <ul className="text-sm space-y-1">
            {receipts.map(r => (
              <li key={r.id} className="text-xs">
                <span className={r.status === "confirmed" ? "text-green-700" : "text-muted-foreground"}>[{r.status}]</span>{" "}
                {r.summary_text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
