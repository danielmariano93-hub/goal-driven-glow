import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PlayCircle, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminToast } from "@/components/admin/adminToast";

type Affinity = { topic_key: string; score: number | string; signals: number; last_seen_at: string | null };
type LearningEvent = {
  topic_key: string;
  signal: string;
  source: string;
  delta: number | string;
  score_before: number | string;
  score_after: number | string;
  created_at: string;
};
type Item = {
  id: string;
  topic_key?: string;
  logical_topic_key?: string;
  title_fact?: string;
  interpretation?: string;
  sentiment?: string;
  financial_weight?: number;
  affinity_score?: number;
  rank_score?: number;
  suppression_reason?: string | null;
  structural_or_timing?: string;
};
type Observability = {
  user_id: string;
  snapshot: Record<string, unknown> | null;
  affinity: Affinity[];
  events: LearningEvent[];
  preferred_comparison: { mode: string; confidence: number | string; use_count: number | null; updated_at: string } | null;
  generated_at: string;
};

type DryRun = {
  as_of: string;
  headline: string;
  methodology: string | null;
  next_action: string | null;
  items: Item[];
  suppressed: Item[];
  transactions_considered: number;
  formula_version: string;
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Observabilidade do consultor: snapshot vigente, afinidade aprendida e
 * dry-run ("como o Nino avaliaria este usuário hoje") sem enviar mensagem. */
export function AdvisorObservabilityBoard({ userId }: { userId: string }) {
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [running, setRunning] = useState(false);

  const obs = useQuery({
    queryKey: ["admin_v2_advisor_observability", userId],
    queryFn: async (): Promise<Observability> => {
      const { data, error } = await supabase.rpc("admin_v2_advisor_observability", { _user_id: userId });
      if (error) throw error;
      return data as unknown as Observability;
    },
  });

  async function runDryRun() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("advisor-dry-run", { body: { user_id: userId } });
      if (error) throw error;
      setDryRun((data as { data?: DryRun })?.data ?? (data as DryRun));
      adminToast.success("Dry-run concluído. Nada foi gravado nem enviado.");
    } catch (e) {
      adminToast.fromError(e, "Não foi possível simular o consultor");
    } finally {
      setRunning(false);
    }
  }

  const snapshot = obs.data?.snapshot ?? null;
  const snapshotItems = (snapshot?.highlights as Item[] | undefined) ?? [];

  return (
    <div className="space-y-4">
      <section className="surface-card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Snapshot vigente do acompanhamento</h3>
            <p className="text-xs text-muted-foreground">
              {snapshot
                ? `${String(snapshot.mode)} · referência ${String(snapshot.as_of)} · versão ${String(snapshot.formula_version)}`
                : "Nenhum snapshot válido — a próxima abertura da Home recalcula."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void runDryRun()} disabled={running}>
            {running ? <Loader2 className="animate-spin" size={14} /> : <PlayCircle size={14} />}
            <span className="ml-1.5">Dry run</span>
          </Button>
        </div>

        {obs.isLoading ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted" aria-hidden />
        ) : snapshot ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{String(snapshot.headline ?? "")}</p>
            <ul className="space-y-1.5">
              {snapshotItems.map((item) => (
                <li key={item.id} className="rounded-xl border border-border bg-background p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.title_fact ?? item.logical_topic_key ?? item.id}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      peso {num(item.financial_weight).toFixed(2)} · rank {num(item.rank_score).toFixed(2)}
                    </span>
                  </div>
                  {item.interpretation ? <p className="mt-1 text-muted-foreground">{item.interpretation}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="surface-card space-y-2 p-4">
        <h3 className="text-sm font-semibold">Afinidade aprendida por tema</h3>
        {(obs.data?.affinity ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem sinais registrados ainda — o ranking usa só peso financeiro.</p>
        ) : (
          <ul className="space-y-1.5">
            {(obs.data?.affinity ?? []).map((row) => (
              <li key={row.topic_key} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono">{row.topic_key}</span>
                <span className="shrink-0 text-muted-foreground">
                  score {num(row.score).toFixed(2)} · {row.signals} sinal(is)
                  {row.last_seen_at ? ` · ${new Date(row.last_seen_at).toLocaleDateString("pt-BR")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface-card space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Comparação preferida</h3>
          {obs.data?.preferred_comparison ? (
            <Badge variant="secondary">{obs.data.preferred_comparison.mode}</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {obs.data?.preferred_comparison
            ? `Aprendida do texto do usuário · confiança ${num(obs.data.preferred_comparison.confidence).toFixed(2)} · atualizada em ${new Date(obs.data.preferred_comparison.updated_at).toLocaleDateString("pt-BR")}`
            : "Nenhum recorte pedido explicitamente — o consultor usa o recorte padrão do período."}
        </p>
      </section>

      <section className="surface-card space-y-2 p-4">
        <h3 className="text-sm font-semibold">Últimos sinais de aprendizado</h3>
        {(obs.data?.events ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum sinal ainda — app, WhatsApp e simulador registram aqui assim que o usuário interagir.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(obs.data?.events ?? []).map((event, index) => (
              <li
                key={`${event.created_at}-${event.topic_key}-${index}`}
                className="rounded-xl border border-border bg-background p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono">{event.topic_key}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(event.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {event.signal} · {event.source} · delta {num(event.delta) >= 0 ? "+" : ""}
                  {num(event.delta).toFixed(2)} · {num(event.score_before).toFixed(2)} → {num(event.score_after).toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dryRun ? (
        <section className="surface-card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Dry run — como o Nino avaliaria hoje</h3>
            <Badge variant="secondary">nada enviado</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {dryRun.as_of} · {dryRun.transactions_considered} lançamentos considerados · {dryRun.methodology ?? "metodologia padrão"}
          </p>
          <p className="text-sm font-medium">{dryRun.headline}</p>
          <ul className="space-y-1.5">
            {dryRun.items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border bg-background p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{item.title_fact ?? item.id}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    peso {num(item.financial_weight).toFixed(2)} · afinidade {num(item.affinity_score).toFixed(2)}
                  </span>
                </div>
                {item.interpretation ? <p className="mt-1 text-muted-foreground">{item.interpretation}</p> : null}
              </li>
            ))}
          </ul>
          {dryRun.suppressed.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Suprimidos e por quê</p>
              <ul className="space-y-1">
                {dryRun.suppressed.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{item.title_fact ?? item.id}</span>
                    <span className="shrink-0 font-mono">{item.suppression_reason ?? "sem motivo"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {dryRun.next_action ? <p className="text-xs font-semibold text-primary">{dryRun.next_action}</p> : null}
        </section>
      ) : running ? null : (
        <EmptyState
          icon={Compass}
          title="Rode um dry run para ver a avaliação de hoje"
          description="A simulação usa os mesmos motores do app e do WhatsApp, sem gravar snapshot nem enviar mensagem."
        />
      )}
    </div>
  );
}
