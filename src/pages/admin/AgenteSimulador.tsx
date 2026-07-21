import { useEffect, useState } from "react";
import { Loader2, Play, RotateCcw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminToast } from "@/components/admin/adminToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type SimResult = { ok?: boolean; reply?: string; reply_kind?: string; draft_id?: string; result?: unknown; error?: string };
type SandboxUser = { id: string; display_name: string | null };

type PendingConfirmation = { id: string; kind: string; summary_text: string; status: string; expires_at: string };
type Receipt = { id: string; kind: string; summary_text: string; status: string };
type Run = { id: string; path: string | null; model: string | null; steps: number | null; tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; status: string; error_sanitized: string | null };
type ToolCall = { step_index: number; tool_name: string; args: unknown; ok: boolean; duration_ms: number; error: string | null };

export default function AgenteSimulador() {
  const [sandbox, setSandbox] = useState<SandboxUser[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [phone, setPhone] = useState<string>("+5511999990000");
  const [text, setText] = useState<string>("gastei 42,90 no almoço hoje");
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ from: "user" | "agent"; body: string; kind?: string }>>([]);
  const [lastPending, setLastPending] = useState<PendingConfirmation | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [lastToolCalls, setLastToolCalls] = useState<ToolCall[]>([]);

  useEffect(() => { void loadSandbox(); }, []);

  const loadSandbox = async () => {
    const { data } = await supabase.from("profiles").select("id, display_name, is_sandbox").eq("is_sandbox", true);
    const list = ((data as Array<{ id: string; display_name: string | null }> | null) ?? []) as SandboxUser[];
    setSandbox(list);
    if (list[0]) setUserId(list[0].id);
  };

  const loadState = async (uid: string) => {
    const { data: pending } = await supabase.from("pending_confirmations")
      .select("id, kind, summary_text, status, expires_at")
      .eq("user_id", uid).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
    setLastPending((pending as PendingConfirmation[] | null)?.[0] ?? null);
    const { data: rec } = await supabase.from("pending_confirmations")
      .select("id, kind, summary_text, executed_at, result_snapshot, status")
      .eq("user_id", uid).in("status", ["confirmed", "cancelled"]).order("created_at", { ascending: false }).limit(10);
    setReceipts(((rec as Receipt[] | null) ?? []));
    const { data: runs } = await supabase.from("agent_runs")
      .select("id, path, model, steps, tokens_in, tokens_out, latency_ms, status, error_sanitized, started_at")
      .eq("user_id", uid).order("started_at", { ascending: false }).limit(1);
    const run = ((runs as Run[] | null) ?? [])[0] ?? null;
    setLastRun(run);
    if (run?.id) {
      const { data: calls } = await supabase.from("agent_tool_calls")
        .select("step_index, tool_name, args, result, ok, duration_ms, error")
        .eq("run_id", run.id).order("step_index");
      setLastToolCalls((calls as ToolCall[] | null) ?? []);
    } else {
      setLastToolCalls([]);
    }
  };

  const send = async () => {
    if (!userId) { adminToast.warn("Selecione um usuário sandbox"); return; }
    setBusy(true);
    try {
      const { data: enq, error: e1 } = await supabase.rpc("agent_sim_enqueue", {
        p_user_id: userId, p_from_phone: phone, p_text: text,
      });
      if (e1) throw e1;
      const meta = enq as { inbound_message_id: string; conversation_id: string };
      setTranscript((t) => [...t, { from: "user", body: text }]);

      const { data: res, error: e2 } = await supabase.functions.invoke<SimResult>("agent-run", {
        body: {
          user_id: userId,
          conversation_id: meta.conversation_id,
          inbound_message_id: meta.inbound_message_id,
          text, to_phone: phone, source: "simulator",
        },
      });
      if (e2) throw e2;
      setTranscript((t) => [...t, { from: "agent", body: res?.reply ?? "(sem resposta)", kind: res?.reply_kind }]);
      await loadState(userId);
    } catch (e) {
      adminToast.fromError(e, "Falha na simulação");
    } finally { setBusy(false); }
  };

  const quick = (t: string) => {
    setText(t);
    setTimeout(() => void send(), 50);
  };

  const reset = async () => {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.rpc("agent_sim_reset", { p_user_id: userId });
    setBusy(false);
    if (error) adminToast.fromError(error, "Não foi possível limpar");
    else { adminToast.success("Sandbox limpo"); setTranscript([]); setLastPending(null); setReceipts([]); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador do assistente"
        description="Executa o mesmo pipeline do WhatsApp — sem enviar mensagem real."
        crumbs={[{ label: "Assistente", to: "/admin/agente" }, { label: "Simulador" }]}
      />

      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <span>Simulação — nenhuma mensagem real é enviada. Use somente com usuários marcados como sandbox.</span>
      </div>

      <Section title="Envio">
        <div className="surface-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sim-user">Usuário sandbox</Label>
              {sandbox.length === 0 ? (
                <p className="text-xs text-muted-foreground pt-2">Nenhum — marque um perfil com <code>is_sandbox=true</code>.</p>
              ) : (
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="sim-user"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sandbox.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.id.slice(0, 8)}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-phone">Telefone simulado</Label>
              <Input id="sim-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex items-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={busy || !userId} className="border-warning/40 text-warning-foreground hover:bg-warning/10">
                    <RotateCcw size={12} /> Reset sandbox
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apagar todos os dados do usuário sandbox?</AlertDialogTitle>
                    <AlertDialogDescription>Esta ação é irreversível e afeta apenas o usuário sandbox selecionado.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={reset}>Confirmar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sim-msg">Mensagem</Label>
            <Textarea id="sim-msg" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["gastei 42,90 no almoço hoje", "recebi 3000 salário", "transferir 100 de Nubank para Itaú", "resumo do mês", "CONFIRMAR", "CANCELAR"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => quick(s)}
                  className="rounded-full border border-border bg-secondary/60 px-2 py-1 text-[11px] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={send} disabled={busy || !userId}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />} Enviar
          </Button>
        </div>
      </Section>

      <Section title="Conversa">
        <div className="surface-card p-5">
          {transcript.length === 0 ? (
            <EmptyState title="Envie uma mensagem para começar" compact />
          ) : (
            <div className="space-y-2">
              {transcript.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-2xl px-3 py-2 max-w-[85%] break-words ${
                    m.from === "user"
                      ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                      : "mr-auto bg-secondary text-foreground rounded-bl-sm"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  {m.kind && <div className="text-[10px] mt-1 opacity-70">{m.kind}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {lastPending && (
        <Section title="Rascunho pendente">
          <div className="surface-card p-5 space-y-2">
            <p className="text-sm break-words">{lastPending.summary_text}</p>
            <p className="text-[11px] text-muted-foreground">
              Kind: {lastPending.kind} · expira {new Date(lastPending.expires_at).toLocaleString("pt-BR")}
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => quick("CONFIRMAR")}>CONFIRMAR</Button>
              <Button size="sm" variant="outline" onClick={() => quick("CANCELAR")}>CANCELAR</Button>
            </div>
          </div>
        </Section>
      )}

      {lastRun && (
        <Section title="Última execução do agente">
          <div className="surface-card p-5 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <KV label="Caminho" value={lastRun.path ?? "—"} tone={lastRun.path === "llm" ? "primary" : "warn"} />
              <KV label="Modelo" value={lastRun.model ?? "—"} />
              <KV label="Passos" value={String(lastRun.steps ?? 0)} />
              <KV label="Latência" value={`${lastRun.latency_ms ?? 0} ms`} />
              <KV label="Tokens in" value={String(lastRun.tokens_in ?? 0)} />
              <KV label="Tokens out" value={String(lastRun.tokens_out ?? 0)} />
              <KV label="Status" value={lastRun.status} tone={lastRun.status === "ok" ? "success" : "danger"} />
              {lastRun.error_sanitized && <div className="col-span-2 md:col-span-4 text-destructive">Erro: {lastRun.error_sanitized}</div>}
            </div>
            {lastToolCalls.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1">Tools executadas</p>
                <ul className="text-[11px] space-y-1 font-mono">
                  {lastToolCalls.map((c, i) => (
                    <li key={i} className="break-words">
                      <span className={c.ok ? "text-success" : "text-destructive"}>[{c.ok ? "ok" : "erro"}]</span>{" "}
                      {c.tool_name}({JSON.stringify(c.args).slice(0, 80)}) · {c.duration_ms}ms
                      {c.error && <span className="text-destructive"> — {c.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {receipts.length > 0 && (
        <Section title="Últimos recibos">
          <div className="surface-card p-5">
            <ul className="text-sm space-y-1.5">
              {receipts.map((r) => (
                <li key={r.id} className="text-xs flex flex-wrap items-start gap-2">
                  {r.status === "confirmed"
                    ? <Badge className="bg-success/15 text-success border-success/30">confirmado</Badge>
                    : <Badge variant="secondary">cancelado</Badge>}
                  <span className="text-muted-foreground break-words min-w-0 flex-1">{r.summary_text}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}

function KV({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "primary" | "success" | "warn" | "danger" }) {
  const toneCls = tone === "primary" ? "text-primary font-semibold"
    : tone === "success" ? "text-success font-semibold"
    : tone === "warn" ? "text-warning-foreground font-semibold"
    : tone === "danger" ? "text-destructive font-semibold"
    : "text-foreground";
  return (
    <div>
      <p className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`mt-0.5 ${toneCls}`}>{value}</p>
    </div>
  );
}
