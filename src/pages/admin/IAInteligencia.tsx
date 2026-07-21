import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Search, Sparkles, Brain, Target, MessageSquare, Zap } from "lucide-react";
import { toast } from "sonner";

type InspectResult = {
  memory: Array<{ id: string; kind: string; key: string; value: any; confidence: number; source: string; use_count: number; updated_at: string }>;
  profile_snapshot: any | null;
  preferences: any | null;
  decisions: Array<{ id: string; intent: string; policy_decision: string; validations: any; fallback: boolean; error: string | null; duration_ms: number | null; created_at: string }>;
  suggestions: Array<{ id: string; kind: string; severity: string; title: string; body: string; status: string; created_at: string }>;
  recent_runs: Array<{ id: string; status: string; path: string; steps: number; tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; started_at: string; error_sanitized: string | null }>;
};

export default function IAInteligencia() {
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<InspectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  async function search() {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase.from("profiles")
        .select("id, display_name").ilike("email", email.trim()).limit(1);
      if (error) throw error;
      let uid = rows?.[0]?.id as string | undefined;
      if (!uid) {
        // fallback: allow raw UUID input
        if (/^[0-9a-f-]{36}$/i.test(email.trim())) uid = email.trim();
      }
      if (!uid) { toast.error("Usuário não encontrado"); setLoading(false); return; }
      setUserId(uid);
      await load(uid);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao buscar");
    } finally { setLoading(false); }
  }

  async function load(uid: string) {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("admin-ai-inspect", { body: { user_id: uid } });
      if (error) throw error;
      setData(res as InspectResult);
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao carregar");
    } finally { setLoading(false); }
  }

  async function runScan() {
    if (!userId) return;
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("agent-proactive-tick", { body: { user_id: userId } });
      if (error) throw error;
      toast.success("Scan proativo executado");
      await load(userId);
    } catch (e: any) {
      toast.error(e.message ?? "Erro no scan");
    } finally { setRunning(false); }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="text-primary" size={22} /> IA & Inteligência
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Memória, perfil, decisões e sugestões proativas do assistente por usuário.
        </p>
      </header>

      <div className="surface-card p-4 flex flex-col md:flex-row gap-3">
        <div className="flex-1 flex items-center gap-2 border border-border rounded-xl px-3 py-2 bg-background">
          <Search size={16} className="text-muted-foreground" />
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="E-mail do usuário ou UUID"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button
          onClick={search}
          disabled={loading || !email.trim()}
          className="rounded-xl bg-gradient-brand text-white text-sm font-semibold px-4 py-2 disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : "Inspecionar"}
        </button>
        {userId && (
          <button
            onClick={runScan}
            disabled={running}
            className="rounded-xl border border-border text-sm font-semibold px-4 py-2 disabled:opacity-60"
          >
            {running ? "Executando…" : "Rodar scan proativo"}
          </button>
        )}
      </div>

      {data && (
        <div className="grid gap-6">
          <Section icon={<Brain size={16} />} title={`Perfil financeiro (snapshot)`}>
            {data.profile_snapshot ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Kpi label="Patrimônio" value={fmt(data.profile_snapshot.net_worth)} />
                <Kpi label="Capacidade poupar/mês" value={fmt(data.profile_snapshot.savings_capacity)} />
                <Kpi label="Renda estimada" value={fmt(data.profile_snapshot.estimated_income)} />
                <Kpi label="Perfil de risco" value={data.profile_snapshot.risk_level ?? "—"} />
                <div className="col-span-2 md:col-span-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Tags comportamentais</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(data.profile_snapshot.behavior_tags ?? []).map((t: string) => (
                      <span key={t} className="text-[11px] rounded-full bg-secondary px-2 py-0.5">{t}</span>
                    ))}
                    {(!data.profile_snapshot.behavior_tags || data.profile_snapshot.behavior_tags.length === 0) && (
                      <span className="text-xs text-muted-foreground">Nenhuma tag ainda.</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Empty>Snapshot ainda não calculado. Rode um scan proativo.</Empty>
            )}
          </Section>

          <Section icon={<Brain size={16} />} title={`Memória (${data.memory.length})`}>
            {data.memory.length === 0 ? <Empty>Sem fatos aprendidos ainda.</Empty> : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {data.memory.map((m) => (
                  <div key={m.id} className="text-xs flex items-center justify-between gap-2 border-b border-border/60 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{m.kind} · {m.key}</p>
                      <p className="text-muted-foreground truncate">{JSON.stringify(m.value)}</p>
                    </div>
                    <span className="text-[10px] rounded bg-secondary px-1.5 py-0.5">{m.source}</span>
                    <span className="text-[10px] tabular-nums">{Math.round(m.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={<Zap size={16} />} title={`Sugestões proativas (${data.suggestions.length})`}>
            {data.suggestions.length === 0 ? <Empty>Nenhuma sugestão pendente.</Empty> : (
              <div className="space-y-2">
                {data.suggestions.map((s) => (
                  <div key={s.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded-full ${sevClass(s.severity)}`}>{s.severity}</span>
                      <span className="text-muted-foreground">{s.kind}</span>
                      <span className="ml-auto text-muted-foreground">{s.status}</span>
                    </div>
                    <p className="font-semibold text-sm mt-1">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.body}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={<Target size={16} />} title={`Preferências de conversa`}>
            {data.preferences ? (
              <pre className="text-[11px] bg-secondary/40 p-3 rounded overflow-x-auto">
                {JSON.stringify(data.preferences, null, 2)}
              </pre>
            ) : <Empty>Usando padrões (o usuário ainda não personalizou).</Empty>}
          </Section>

          <Section icon={<MessageSquare size={16} />} title={`Decisões recentes (${data.decisions.length})`}>
            {data.decisions.length === 0 ? <Empty>Sem decisões logadas.</Empty> : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {data.decisions.map((d) => (
                  <div key={d.id} className="text-[11px] grid grid-cols-6 gap-2 border-b border-border/60 py-1">
                    <span className="col-span-2 truncate">{new Date(d.created_at).toLocaleString("pt-BR")}</span>
                    <span className="font-semibold truncate">{d.intent}</span>
                    <span className="truncate">{d.policy_decision}</span>
                    <span className="tabular-nums">{d.duration_ms ?? "—"}ms</span>
                    <span className={d.fallback ? "text-warning" : d.error ? "text-destructive" : "text-success"}>
                      {d.error ? "erro" : d.fallback ? "fallback" : "ok"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="surface-card p-4">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">{icon} {title}</h2>
      {children}
    </div>
  );
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold text-sm mt-0.5">{value}</p>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function sevClass(sev: string) {
  if (sev === "critical") return "bg-destructive/10 text-destructive";
  if (sev === "attention") return "bg-warning/10 text-warning-foreground";
  return "bg-secondary text-foreground";
}
