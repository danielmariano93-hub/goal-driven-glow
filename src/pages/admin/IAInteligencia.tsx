import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Search, Loader2, Brain, Target, MessageSquare, Zap, Activity, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { SkeletonList, SkeletonStats } from "@/components/admin/AdminSkeleton";
import { adminToast } from "@/components/admin/adminToast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type InspectResult = {
  memory: Array<{ id: string; kind: string; key: string; value: unknown; confidence: number; source: string; use_count: number; updated_at: string }>;
  profile_snapshot: {
    net_worth?: number | null;
    savings_capacity?: number | null;
    estimated_income?: number | null;
    risk_level?: string | null;
    behavior_tags?: string[] | null;
  } | null;
  preferences: Record<string, unknown> | null;
  decisions: Array<{ id: string; intent: string; policy_decision: string; validations: unknown; fallback: boolean; error: string | null; duration_ms: number | null; created_at: string }>;
  suggestions: Array<{ id: string; kind: string; severity: string; title: string; body: string; status: string; created_at: string }>;
  recent_runs: Array<{ id: string; status: string; path: string; steps: number; tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; started_at: string; error_sanitized: string | null }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveUserIdByQuery(term: string): Promise<{ userId: string; displayName: string | null; email: string } | null> {
  const trimmed = term.trim();
  if (!trimmed) return null;
  if (UUID_RE.test(trimmed)) {
    return { userId: trimmed, displayName: null, email: trimmed };
  }
  const { data, error } = await supabase.rpc("admin_users_list", {
    p_search: trimmed,
    p_limit: 5,
    p_offset: 0,
  });
  if (error) throw error;
  const rows = (data as Array<{ user_id: string; email: string; display_name: string | null }> | null) ?? [];
  const exact = rows.find((r) => r.email?.toLowerCase() === trimmed.toLowerCase());
  const hit = exact ?? rows[0];
  return hit ? { userId: hit.user_id, displayName: hit.display_name, email: hit.email } : null;
}

export default function IAInteligencia() {
  const [term, setTerm] = useState("");
  const [target, setTarget] = useState<{ userId: string; email: string; displayName: string | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [running, setRunning] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const inspect = useQuery({
    queryKey: ["admin_ai_inspect", target?.userId],
    enabled: !!target?.userId,
    queryFn: async (): Promise<InspectResult> => {
      const { data, error } = await supabase.functions.invoke("admin-ai-inspect", { body: { user_id: target!.userId } });
      if (error) throw error;
      return data as InspectResult;
    },
  });

  async function search() {
    if (!term.trim()) return;
    setSearching(true);
    setNotFound(false);
    try {
      const found = await resolveUserIdByQuery(term);
      if (!found) {
        setTarget(null);
        setNotFound(true);
        return;
      }
      setTarget(found);
    } catch (e) {
      adminToast.fromError(e, "Não foi possível buscar o usuário");
    } finally {
      setSearching(false);
    }
  }

  async function runScan() {
    if (!target) return;
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("agent-proactive-tick", { body: { user_id: target.userId } });
      if (error) throw error;
      adminToast.success("Scan proativo executado");
      await inspect.refetch();
    } catch (e) {
      adminToast.fromError(e, "Falha ao executar o scan");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="IA & Inteligência"
        description="Memória, perfil, decisões e sugestões proativas do assistente por usuário."
        status={<Badge variant="secondary" className="gap-1"><Sparkles size={12} /> Assistente</Badge>}
      />

      <section className="surface-card p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); void search(); }}
          className="flex flex-col gap-3 md:flex-row md:items-center"
          role="search"
        >
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              autoComplete="off"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="E-mail do usuário ou UUID"
              className="pl-9"
              aria-label="Buscar usuário por e-mail ou UUID"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={searching || !term.trim()} className="min-w-[120px]">
              {searching ? <Loader2 className="animate-spin" size={16} /> : "Inspecionar"}
            </Button>
            {target && (
              <Button type="button" variant="outline" onClick={runScan} disabled={running}>
                {running ? <Loader2 className="animate-spin" size={16} /> : "Rodar scan proativo"}
              </Button>
            )}
          </div>
        </form>

        {target && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <User size={12} />
            Inspecionando <span className="font-medium text-foreground">{target.displayName ?? target.email}</span>
            <span className="font-mono">({target.userId.slice(0, 8)}…)</span>
          </p>
        )}
      </section>

      {notFound && (
        <EmptyState
          icon={Search}
          title="Nenhum usuário encontrado"
          description="Confira o e-mail exatamente como está cadastrado ou cole o UUID do usuário. A busca só considera contas já ativas na plataforma."
        />
      )}

      {!target && !notFound && (
        <EmptyState
          icon={Sparkles}
          title="Busque um usuário para inspecionar a inteligência do assistente"
          description="Você verá o snapshot do perfil, memória aprendida, sugestões proativas, decisões recentes e execuções do agente."
        />
      )}

      {target && inspect.isLoading && (
        <div className="space-y-4">
          <SkeletonStats />
          <SkeletonList rows={4} />
        </div>
      )}

      {target && inspect.isError && (
        <EmptyState
          icon={Activity}
          title="Não foi possível carregar a inteligência agora"
          description="Tente novamente em instantes. Se persistir, verifique suas permissões."
          action={<Button variant="outline" onClick={() => void inspect.refetch()}>Tentar novamente</Button>}
        />
      )}

      {target && inspect.data && <InspectView data={inspect.data} />}
    </div>
  );
}

function InspectView({ data }: { data: InspectResult }) {
  const suggestionsCount = data.suggestions.length;
  return (
    <Tabs defaultValue="summary" className="space-y-4">
      <TabsList className="grid w-full grid-cols-2 md:w-auto md:inline-grid md:grid-cols-5">
        <TabsTrigger value="summary">Resumo</TabsTrigger>
        <TabsTrigger value="memory">Memória</TabsTrigger>
        <TabsTrigger value="suggestions">
          Sugestões {suggestionsCount > 0 && <span className="ml-1 rounded-full bg-primary/15 text-primary px-1.5 text-[10px]">{suggestionsCount}</span>}
        </TabsTrigger>
        <TabsTrigger value="decisions">Decisões</TabsTrigger>
        <TabsTrigger value="runs">Runs</TabsTrigger>
      </TabsList>

      <TabsContent value="summary" className="space-y-6">
        <SummaryPanel snap={data.profile_snapshot} prefs={data.preferences} />
      </TabsContent>

      <TabsContent value="memory">
        <MemoryPanel memory={data.memory} />
      </TabsContent>

      <TabsContent value="suggestions">
        <SuggestionsPanel items={data.suggestions} />
      </TabsContent>

      <TabsContent value="decisions">
        <DecisionsPanel items={data.decisions} />
      </TabsContent>

      <TabsContent value="runs">
        <RunsPanel items={data.recent_runs} />
      </TabsContent>
    </Tabs>
  );
}

function SummaryPanel({ snap, prefs }: { snap: InspectResult["profile_snapshot"]; prefs: InspectResult["preferences"] }) {
  if (!snap && !prefs) {
    return (
      <EmptyState
        icon={Brain}
        title="Snapshot ainda não calculado"
        description="Rode um scan proativo para gerar o perfil dinâmico deste usuário."
      />
    );
  }
  return (
    <div className="space-y-6">
      {snap ? (
        <StatGrid cols={4}>
          <StatCard label="Patrimônio" value={fmt(snap.net_worth)} tone="primary" />
          <StatCard label="Capacidade poupar/mês" value={fmt(snap.savings_capacity)} tone="success" />
          <StatCard label="Renda estimada" value={fmt(snap.estimated_income)} />
          <StatCard label="Perfil de risco" value={snap.risk_level ?? "—"} />
        </StatGrid>
      ) : (
        <EmptyState icon={Brain} title="Sem snapshot financeiro ainda" compact />
      )}

      {snap?.behavior_tags && snap.behavior_tags.length > 0 && (
        <div className="surface-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tags comportamentais</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {snap.behavior_tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[11px]">{t}</Badge>
            ))}
          </div>
        </div>
      )}

      <div className="surface-card p-4">
        <p className="text-sm font-semibold flex items-center gap-2"><Target size={14} className="text-primary" /> Preferências de conversa</p>
        {prefs ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-secondary/40 p-3 text-[11px]">
            {JSON.stringify(prefs, null, 2)}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Usando padrões — o usuário ainda não personalizou.</p>
        )}
      </div>
    </div>
  );
}

function MemoryPanel({ memory }: { memory: InspectResult["memory"] }) {
  if (memory.length === 0) {
    return <EmptyState icon={Brain} title="Sem fatos aprendidos ainda" description="A memória cresce à medida que o usuário interage com o assistente." />;
  }
  return (
    <div className="surface-card divide-y divide-border">
      {memory.map((m) => (
        <article key={m.id} className="p-4 grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{m.kind} · {m.key}</p>
            <p className="mt-0.5 text-xs text-muted-foreground break-words line-clamp-2">
              {typeof m.value === "string" ? m.value : JSON.stringify(m.value)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Atualizado {new Date(m.updated_at).toLocaleString("pt-BR")} · uso {m.use_count}×
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
            <Badge variant="outline" className="text-[10px]">{m.source}</Badge>
            <Badge variant="secondary" className="text-[10px] font-numeric tabular-nums">{Math.round(m.confidence * 100)}%</Badge>
          </div>
        </article>
      ))}
    </div>
  );
}

function SuggestionsPanel({ items }: { items: InspectResult["suggestions"] }) {
  if (items.length === 0) {
    return <EmptyState icon={Zap} title="Nenhuma sugestão pendente" description="As sugestões aparecem quando o motor proativo identifica oportunidades." />;
  }
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <article key={s.id} className="surface-card p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SeverityBadge severity={s.severity} />
            <span className="text-muted-foreground">{s.kind}</span>
            <span className="ml-auto text-muted-foreground">{s.status}</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{s.title}</p>
          <p className="text-xs text-muted-foreground break-words">{s.body}</p>
        </article>
      ))}
    </div>
  );
}

function DecisionsPanel({ items }: { items: InspectResult["decisions"] }) {
  if (items.length === 0) {
    return <EmptyState icon={MessageSquare} title="Sem decisões logadas" />;
  }
  return (
    <div className="surface-card divide-y divide-border max-h-[600px] overflow-y-auto">
      {items.map((d) => (
        <div key={d.id} className="p-3 grid gap-1.5 md:grid-cols-[170px_1fr_120px_80px_90px] md:items-center text-[11px]">
          <span className="text-muted-foreground truncate">{new Date(d.created_at).toLocaleString("pt-BR")}</span>
          <span className="font-semibold truncate">{d.intent}</span>
          <span className="truncate text-muted-foreground">{d.policy_decision}</span>
          <span className="tabular-nums text-muted-foreground">{d.duration_ms ?? "—"}ms</span>
          <Badge
            variant="outline"
            className={
              d.error ? "border-destructive/40 text-destructive"
                : d.fallback ? "border-warning/40 text-warning-foreground"
                : "border-success/40 text-success"
            }
          >
            {d.error ? "erro" : d.fallback ? "fallback" : "ok"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function RunsPanel({ items }: { items: InspectResult["recent_runs"] }) {
  if (items.length === 0) {
    return <EmptyState icon={Activity} title="Sem execuções recentes" />;
  }
  return (
    <div className="surface-card divide-y divide-border">
      {items.map((r) => (
        <div key={r.id} className="p-3 grid gap-2 md:grid-cols-[160px_100px_80px_1fr_100px] md:items-center text-[11px]">
          <span className="text-muted-foreground">{new Date(r.started_at).toLocaleString("pt-BR")}</span>
          <Badge variant="outline">{r.path ?? "—"}</Badge>
          <span className="text-muted-foreground">{r.steps} passos</span>
          <span className="text-muted-foreground truncate">
            {r.tokens_in ?? 0}→{r.tokens_out ?? 0} tk · {r.latency_ms ?? 0}ms
            {r.error_sanitized && <span className="ml-2 text-destructive">{r.error_sanitized}</span>}
          </span>
          <Badge
            variant="outline"
            className={r.status === "ok" ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}
          >
            {r.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical") return <Badge className="bg-destructive/15 text-destructive border-destructive/30">crítico</Badge>;
  if (severity === "attention") return <Badge className="bg-warning/15 text-warning-foreground border-warning/40">atenção</Badge>;
  return <Badge variant="secondary">{severity || "info"}</Badge>;
}

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
