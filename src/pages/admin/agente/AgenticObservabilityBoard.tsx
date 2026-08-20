import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { callAdminRpc } from "@/lib/admin/adminRpc";

/**
 * Observabilidade do agente: do pedido ao recibo.
 * Mostra quantos turnos viraram plano, quantos exigiram confirmação, quais
 * capacidades falham e quais ferramentas quebram — sem PII.
 */

type Funnel = {
  turns?: number; planned?: number; write_planned?: number;
  awaiting_confirmation?: number; auto_executed?: number;
  fallbacks?: number; errors?: number;
};
type CapabilityRow = { capability: string; turns: number; ok: number; errors: number; avg_latency_ms: number };
type ToolRow = { tool: string; calls: number; ok: number; failed: number; avg_ms: number };
type FailureRow = { at: string; tool: string; error: string; capability: string | null; channel: string | null };
type Payload = {
  funnel?: Funnel;
  capabilities?: CapabilityRow[];
  tools?: ToolRow[];
  failures?: FailureRow[];
  days?: number;
};

const RANGES = [1, 7, 30];

export default function AgenticObservabilityBoard() {
  const [days, setDays] = useState(7);
  const q = useQuery({
    queryKey: ["admin-agent-autonomy", days],
    queryFn: () => callAdminRpc<Payload>("admin_v2_agent_autonomy", { _days: days }),
  });

  if (q.isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Carregando comportamento do Nino…</div>;
  }
  if (q.error) {
    return <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Não foi possível carregar a observabilidade do agente agora.</div>;
  }

  const f = q.data?.funnel ?? {};
  const caps = q.data?.capabilities ?? [];
  const tools = q.data?.tools ?? [];
  const failures = q.data?.failures ?? [];
  const turns = Number(f.turns ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Activity size={17} className="text-primary" />Do pedido ao recibo</h2>
          <p className="text-sm text-muted-foreground">Como o Nino decidiu agir: plano, confirmação, execução e falhas.</p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${d === days ? "border-transparent bg-gradient-brand text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
            >
              {d === 1 ? "24h" : `${d} dias`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Conversas com o Nino" value={turns} hint="Turnos processados no período" />
        <Stat label="Com plano de ação" value={Number(f.planned ?? 0)} hint={pct(Number(f.planned ?? 0), turns)} />
        <Stat label="Pediram registro" value={Number(f.write_planned ?? 0)} hint="Turnos que envolviam escrever algo" />
        <Stat label="Executados direto" value={Number(f.auto_executed ?? 0)} hint="Baixo risco, sem confirmação" icon={<CheckCircle2 size={14} className="text-success" />} />
        <Stat label="Aguardaram você" value={Number(f.awaiting_confirmation ?? 0)} hint="Confirmação exigida pela política" icon={<ShieldCheck size={14} className="text-primary" />} />
        <Stat label="Turnos com erro" value={Number(f.errors ?? 0)} hint={`${Number(f.fallbacks ?? 0)} usaram plano B`} icon={<AlertTriangle size={14} className="text-destructive" />} tone={Number(f.errors ?? 0) > 0 ? "danger" : "neutral"} />
      </div>

      <section className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold">Capacidades mais usadas</h3>
        {caps.length === 0
          ? <p className="mt-2 text-sm text-muted-foreground">Sem execuções no período.</p>
          : <ul className="mt-3 space-y-2">
              {caps.map((c) => (
                <li key={c.capability} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                  <span className="font-medium">{c.capability}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {c.turns} exec · {c.errors} com erro · {Math.round(Number(c.avg_latency_ms ?? 0))} ms
                  </span>
                </li>
              ))}
            </ul>}
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold">Ferramentas do agente</h3>
        {tools.length === 0
          ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma ferramenta acionada no período.</p>
          : <ul className="mt-3 space-y-2">
              {tools.map((t) => (
                <li key={t.tool} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{t.tool}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t.calls} chamadas · {t.failed} falhas · {Math.round(Number(t.avg_ms ?? 0))} ms
                  </span>
                </li>
              ))}
            </ul>}
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h3 className="font-semibold">Últimas falhas</h3>
        {failures.length === 0
          ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma falha registrada. 🎯</p>
          : <ul className="mt-3 space-y-2">
              {failures.map((row, i) => (
                <li key={`${row.at}-${i}`} className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{row.tool}</span>
                    <span className="text-xs text-muted-foreground">{new Date(row.at).toLocaleString("pt-BR")}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.error}</p>
                </li>
              ))}
            </ul>}
      </section>
    </div>
  );
}

function pct(part: number, total: number): string {
  if (!total) return "sem base";
  return `${Math.round((part / total) * 100)}% dos turnos`;
}

function Stat({ label, value, hint, icon, tone = "neutral" }: {
  label: string; value: number; hint?: string; icon?: JSX.Element; tone?: "neutral" | "danger";
}) {
  return (
    <div className={`rounded-2xl border bg-card p-4 ${tone === "danger" ? "border-destructive/30" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">{icon}{label}</div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
