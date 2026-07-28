import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ListChecks, Play, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminErrorMessage } from "@/lib/admin/adminRpc";
import { adminToast } from "@/components/admin/adminToast";

type EngineStatus = {
  enabled: boolean;
  channels: string[] | null;
  last_tick_at: string | null;
  last_tick_duration_ms: number | null;
  last_tick_users: number | null;
  last_tick_errors: Array<{ user_id?: string; error?: string }> | null;
  next_tick_at: string | null;
  cron: Array<{ jobname: string; schedule: string; active: boolean }>;
  pending_suggestions: number;
  deliveries_7d: number;
  blocked_7d: number;
};

type QueueData = {
  pending: Array<{ id: string; kind: string; severity: string; title: string; created_at: string; channel_ready: string }>;
  recent: Array<{ id: string; kind: string; channel: string; status: string; reason: string | null; created_at: string }>;
  blocks: Array<{ reason: string; total: number }>;
};

type CatalogRow = {
  kind: string;
  label: string | null;
  family: string | null;
  active: boolean;
  base_priority: number;
  allowed_channels: string[];
  cooldown_hours: number;
  max_per_day: number;
  requires_manual_approval: boolean;
};

// deno-lint irrelevant: client-side untyped RPC helper
const rpc = (supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}).rpc.bind(supabase);

function fmtDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export function ProactiveEnginePanel() {
  const qc = useQueryClient();
  const [running, setRunning] = useState<"dry" | "real" | null>(null);

  const status = useQuery({
    queryKey: ["admin_proactive_engine_status"],
    queryFn: async (): Promise<EngineStatus> => {
      const { data, error } = await rpc("admin_proactive_engine_status");
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar status do motor"));
      return data as EngineStatus;
    },
    staleTime: 15_000,
  });

  const queue = useQuery({
    queryKey: ["admin_proactive_queue"],
    queryFn: async (): Promise<QueueData> => {
      const { data, error } = await rpc("admin_proactive_queue", { _limit: 25 });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar a fila"));
      return data as QueueData;
    },
    staleTime: 15_000,
  });

  const catalog = useQuery({
    queryKey: ["admin_communication_catalog"],
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await rpc("admin_communication_catalog");
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar o catálogo"));
      return (data as CatalogRow[]) ?? [];
    },
    staleTime: 60_000,
  });

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin_proactive_engine_status"] }),
      qc.invalidateQueries({ queryKey: ["admin_proactive_queue"] }),
      qc.invalidateQueries({ queryKey: ["admin_proactive_summary"] }),
    ]);
  };

  const toggle = useMutation({
    mutationFn: async (args: { enabled?: boolean; channels?: string[] }) => {
      const { error } = await rpc("admin_proactive_engine_toggle", {
        _enabled: args.enabled ?? null,
        _channels: args.channels ?? null,
      });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao alterar o motor"));
    },
    onSuccess: async () => { adminToast.success("Motor atualizado"); await refreshAll(); },
    onError: (e: Error) => adminToast.error(e.message),
  });

  const catalogUpdate = useMutation({
    mutationFn: async (args: { kind: string; active?: boolean; channels?: string[] }) => {
      const { error } = await rpc("admin_communication_catalog_update", {
        _kind: args.kind,
        _active: args.active ?? null,
        _allowed_channels: args.channels ?? null,
      });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao atualizar o tipo"));
    },
    onSuccess: async () => {
      adminToast.success("Tipo atualizado");
      await qc.invalidateQueries({ queryKey: ["admin_communication_catalog"] });
    },
    onError: (e: Error) => adminToast.error(e.message),
  });

  const runNow = async (dryRun: boolean) => {
    setRunning(dryRun ? "dry" : "real");
    try {
      const { data, error } = await supabase.functions.invoke("agent-proactive-tick", {
        body: { dry_run: dryRun, limit: 25 },
      });
      if (error) throw new Error(error.message);
      const scanned = (data as { scanned?: number } | null)?.scanned ?? 0;
      adminToast.success(dryRun ? `Simulação concluída (${scanned} usuários)` : `Execução concluída (${scanned} usuários)`);
      if (!dryRun) await refreshAll();
    } catch (e) {
      adminToast.error((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const s = status.data;
  const channels = s?.channels ?? [];

  return (
    <div className="space-y-6">
      <Section
        title="Motor proativo"
        icon={Activity}
        description="Estado real da orquestração: agendamento, última execução e canais liberados."
      >
        {status.isError ? (
          <EmptyState title="Sem acesso ao status" description={(status.error as Error)?.message ?? ""} />
        ) : (
          <>
            <StatGrid cols={4}>
              <StatCard label="Motor" value={s?.enabled ? "Ligado" : "Desligado"} tone={s?.enabled ? "success" : "warning"} />
              <StatCard label="Canais" value={channels.length ? channels.join(" + ") : "—"} />
              <StatCard label="Última execução" value={fmtDate(s?.last_tick_at ?? null)} hint={`${s?.last_tick_users ?? 0} usuários · ${s?.last_tick_duration_ms ?? 0} ms`} />
              <StatCard label="Sugestões na fila" value={s?.pending_suggestions ?? 0} />
            </StatGrid>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggle.mutate({ enabled: !s?.enabled })}
                disabled={toggle.isPending}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:border-neutral-300 disabled:opacity-60"
              >
                {s?.enabled ? "Desligar motor" : "Ligar motor"}
              </button>
              <button
                type="button"
                onClick={() => toggle.mutate({ channels: channels.includes("whatsapp") ? ["app"] : ["app", "whatsapp"] })}
                disabled={toggle.isPending}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:border-neutral-300 disabled:opacity-60"
              >
                {channels.includes("whatsapp") ? "Restringir ao app" : "Liberar WhatsApp"}
              </button>
              <button
                type="button"
                onClick={() => runNow(true)}
                disabled={running !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:border-neutral-300 disabled:opacity-60"
              >
                <Play size={14} /> {running === "dry" ? "Simulando..." : "Simular (dry-run)"}
              </button>
              <button
                type="button"
                onClick={() => runNow(false)}
                disabled={running !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-60"
              >
                <Play size={14} /> {running === "real" ? "Executando..." : "Executar agora"}
              </button>
            </div>

            <p className="mt-3 text-xs text-neutral-500">
              Agendamento: {s?.cron?.length ? s.cron.map((c) => `${c.jobname} (${c.schedule})`).join(", ") : "nenhum cron ativo"}
              {" · "}Próxima janela prevista: {fmtDate(s?.next_tick_at ?? null)}
            </p>

            {(s?.last_tick_errors ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-amber-700">
                {(s?.last_tick_errors ?? []).slice(0, 5).map((err, index) => (
                  <li key={`${err.user_id}-${index}`}>{err.user_id?.slice(0, 8)}… — {err.error}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Fila e bloqueios" icon={ListChecks} description="O que está pendente e por que comunicações foram barradas nos últimos 30 dias.">
        {(queue.data?.blocks ?? []).length === 0 ? (
          <EmptyState title="Nenhum bloqueio recente" description="Nenhuma comunicação foi barrada pela política no período." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr><th className="py-2 pr-4 text-left">Motivo do bloqueio</th><th className="text-right">Ocorrências</th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {(queue.data?.blocks ?? []).map((b) => (
                  <tr key={b.reason}>
                    <td className="py-2 pr-4 font-medium text-neutral-800">{b.reason}</td>
                    <td className="text-right tabular-nums">{b.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Catálogo de comunicações" icon={Settings2} description="Ativar, desativar e liberar canais por tipo. Toda alteração é auditada.">
        {(catalog.data ?? []).length === 0 ? (
          <EmptyState title="Catálogo vazio" description="Nenhum tipo de comunicação cadastrado." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-2 pr-4 text-left">Tipo</th>
                  <th className="pr-4 text-left">Família</th>
                  <th className="pr-4 text-right">Prioridade</th>
                  <th className="pr-4 text-left">Canais</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {(catalog.data ?? []).map((row) => (
                  <tr key={row.kind} className={row.active ? "" : "opacity-50"}>
                    <td className="py-2 pr-4 font-medium text-neutral-800">{row.label || row.kind}</td>
                    <td className="pr-4 text-neutral-600">{row.family ?? "—"}</td>
                    <td className="pr-4 text-right tabular-nums">{row.base_priority}</td>
                    <td className="pr-4 text-neutral-600">{(row.allowed_channels ?? []).join(", ")}</td>
                    <td className="space-x-2 text-right">
                      <button
                        type="button"
                        onClick={() => catalogUpdate.mutate({ kind: row.kind, active: !row.active })}
                        disabled={catalogUpdate.isPending}
                        className="rounded-lg border border-neutral-200 px-2 py-1 text-xs hover:border-neutral-300 disabled:opacity-60"
                      >
                        {row.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => catalogUpdate.mutate({
                          kind: row.kind,
                          channels: (row.allowed_channels ?? []).includes("whatsapp") ? ["app"] : ["app", "whatsapp"],
                        })}
                        disabled={catalogUpdate.isPending}
                        className="rounded-lg border border-neutral-200 px-2 py-1 text-xs hover:border-neutral-300 disabled:opacity-60"
                      >
                        {(row.allowed_channels ?? []).includes("whatsapp") ? "Só app" : "+ WhatsApp"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
