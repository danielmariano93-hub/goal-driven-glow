import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Eye, FileText, ListChecks, Play, Plus, Save, Search, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { adminErrorMessage } from "@/lib/admin/adminRpc";
import { adminToast } from "@/components/admin/adminToast";
import { dict } from "@/lib/admin/displayDictionary";

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
};

type QueueData = {
  pending: Array<{ id: string; kind: string; severity: string; title: string; created_at: string; channel_ready: string }>;
  recent: Array<{ id: string; kind: string; channel: string; status: string; reason: string | null; created_at: string }>;
  blocks: Array<{ reason: string; total: number }>;
};

type CatalogRow = {
  kind: string;
  label: string;
  family: string;
  active: boolean;
  base_priority: number;
  allowed_channels: string[];
  content_mode: string;
  cooldown_hours: number | null;
  max_per_day: number | null;
  requires_manual_approval: boolean | null;
};

type TemplateRow = {
  id: string;
  kind: string;
  channel: "app" | "whatsapp";
  title_template: string;
  body_template: string;
  allowed_variables: string[];
  active: boolean;
  version: number;
};

type PreviewItem = {
  kind: string;
  channel_ready: string;
  title: string;
  body: string;
  dedup_key: string;
  evidence?: Record<string, unknown>;
};

type EffectivenessRow = {
  kind: string;
  total: number;
  delivered: number;
  suppressed: number;
  acted: number;
  dismissed: number;
  not_useful: number;
  action_rate: number;
};

const rpc = (supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}).rpc.bind(supabase);

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function readableReason(reason: string | null): string {
  return reason ? dict.commReason(reason) : "Sem motivo registrado";
}

export type CommSection = "engine" | "simulation" | "queue" | "effectiveness" | "catalog" | "templates";

const ALL_SECTIONS: CommSection[] = ["engine", "simulation", "queue", "effectiveness", "catalog", "templates"];

export function ProactiveEnginePanelV2({ sections }: { sections?: CommSection[] } = {}) {
  const visible = new Set(sections ?? ALL_SECTIONS);
  const show = (id: CommSection) => visible.has(id);
  const queryClient = useQueryClient();
  const [previewUserId, setPreviewUserId] = useState("");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRow | null>(null);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateChannel, setTemplateChannel] = useState<"all" | "app" | "whatsapp">("all");

  const status = useQuery({
    queryKey: ["admin_proactive_engine_status"],
    queryFn: async (): Promise<EngineStatus> => {
      const { data, error } = await rpc("admin_proactive_engine_status");
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar status do motor"));
      return data as EngineStatus;
    },
    staleTime: 15_000,
    enabled: show("engine"),
  });
  const queue = useQuery({
    queryKey: ["admin_proactive_queue"],
    queryFn: async (): Promise<QueueData> => {
      const { data, error } = await rpc("admin_proactive_queue", { _limit: 50 });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar fila"));
      return data as QueueData;
    },
    staleTime: 15_000,
    enabled: show("queue"),
  });
  const catalog = useQuery({
    queryKey: ["admin_communication_catalog"],
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await rpc("admin_communication_catalog");
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar catálogo"));
      return (data as CatalogRow[]) ?? [];
    },
    enabled: show("catalog"),
  });
  const templates = useQuery({
    queryKey: ["admin_communication_templates"],
    queryFn: async (): Promise<TemplateRow[]> => {
      const { data, error } = await rpc("admin_communication_templates", { _kind: null });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar templates"));
      return (data as TemplateRow[]) ?? [];
    },
    enabled: show("templates"),
  });
  const effectiveness = useQuery({
    queryKey: ["admin_v2_insight_effectiveness"],
    queryFn: async (): Promise<EffectivenessRow[]> => {
      const { data, error } = await rpc("admin_v2_insight_effectiveness", { _days: 30 });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar eficácia dos insights"));
      return ((data as { by_kind?: EffectivenessRow[] } | null)?.by_kind ?? []);
    },
    staleTime: 60_000,
    enabled: show("effectiveness"),
  });



  const refresh = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["admin_proactive_engine_status"] }),
    queryClient.invalidateQueries({ queryKey: ["admin_proactive_queue"] }),
    queryClient.invalidateQueries({ queryKey: ["admin_proactive_summary"] }),
  ]);

  const toggle = useMutation({
    mutationFn: async (args: { enabled?: boolean; channels?: string[] }) => {
      const { error } = await rpc("admin_proactive_engine_toggle", {
        _enabled: args.enabled ?? null,
        _channels: args.channels ?? null,
      });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao alterar motor"));
    },
    onSuccess: async () => { await refresh(); adminToast.success("Motor atualizado"); },
    onError: (error: Error) => adminToast.error(error.message),
  });

  const catalogUpdate = useMutation({
    mutationFn: async (args: { kind: string; active?: boolean; cooldown_hours?: number; max_per_day?: number; requires_manual_approval?: boolean }) => {
      const { error } = await rpc("admin_communication_catalog_update", {
        _kind: args.kind,
        _active: args.active ?? null,
        _cooldown_hours: args.cooldown_hours ?? null,
        _max_per_day: args.max_per_day ?? null,
        _requires_manual_approval: args.requires_manual_approval ?? null,
      });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao atualizar tipo"));
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["admin_communication_catalog"] }),
    onError: (error: Error) => adminToast.error(error.message),
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      if (!previewUserId.trim()) throw new Error("Informe o UUID do usuário para uma simulação segura.");
      const { data, error } = await supabase.functions.invoke("agent-proactive-tick", {
        body: { user_id: previewUserId.trim(), dry_run: true, only: ["proactive"], limit: 1 },
      });
      if (error) throw new Error(error.message);
      const results = (data as { results?: Array<{ preview?: PreviewItem[]; errors?: string[] }> } | null)?.results ?? [];
      const errors = results.flatMap((item) => item.errors ?? []);
      if (errors.length > 0) throw new Error(errors.join(" · "));
      return results.flatMap((item) => item.preview ?? []);
    },
    onSuccess: (items) => {
      setPreview(items);
      adminToast.success(`Simulação concluída: ${items.length} sugestão(ões), sem persistir ou enviar.`);
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  const templateSave = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate) throw new Error("Selecione um template.");
      const { error } = await rpc("admin_communication_template_upsert", {
        _kind: selectedTemplate.kind,
        _channel: selectedTemplate.channel,
        _title_template: titleTemplate,
        _body_template: bodyTemplate,
        _active: true,
      });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao salvar template"));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin_communication_templates"] });
      adminToast.success("Nova versão do template publicada");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  const activeTemplates = useMemo(() => {
    const normalized = templateSearch.trim().toLocaleLowerCase("pt-BR");
    return (templates.data ?? [])
      .filter((item) => item.active)
      .filter((item) => templateChannel === "all" || item.channel === templateChannel)
      .filter((item) => {
        if (!normalized) return true;
        const searchable = `${dict.commKind(item.kind)} ${item.kind} ${dict.channel(item.channel)}`.toLocaleLowerCase("pt-BR");
        return searchable.includes(normalized);
      });
  }, [templates.data, templateChannel, templateSearch]);
  const s = status.data;
  const channels = s?.channels ?? [];

  return (
    <div className="space-y-6">
      {show("engine") && <>
      <Section title="Motor proativo" icon={Activity} description="Estado real, kill switch, canais e execução automática.">
        {status.isError ? <EmptyState title="Sem acesso ao status" description={(status.error as Error).message} /> : (
          <>
            <StatGrid cols={4}>
              <StatCard label="Motor" value={s?.enabled ? "Ligado" : "Desligado"} tone={s?.enabled ? "success" : "warning"} />
              <StatCard label="Canais" value={channels.join(" + ") || "—"} />
              <StatCard label="Última execução" value={dateTime(s?.last_tick_at ?? null)} hint={`${s?.last_tick_users ?? 0} usuários · ${s?.last_tick_duration_ms ?? 0} ms`} />
              <StatCard label="Próxima execução" value={dateTime(s?.next_tick_at ?? null)} />
            </StatGrid>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => toggle.mutate({ enabled: !s?.enabled })} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm">{s?.enabled ? "Desligar motor" : "Ligar motor"}</button>
              <button
                type="button"
                onClick={() => {
                  const enabling = !channels.includes("whatsapp");
                  if (enabling && !window.confirm("Liberar WhatsApp permite envios reais para tipos autorizados. Confirma após concluir o smoke test em app?")) return;
                  toggle.mutate({ channels: enabling ? ["app", "whatsapp"] : ["app"] });
                }}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm"
              >
                {channels.includes("whatsapp") ? "Bloquear WhatsApp" : "Liberar WhatsApp"}
              </button>
            </div>
            <p className="mt-3 text-xs text-neutral-500">Agendamento: {s?.cron?.map((item) => `${item.jobname} (${item.schedule})`).join(", ") || "nenhum"}</p>
            {(s?.last_tick_errors ?? []).length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                A última execução encontrou {(s?.last_tick_errors ?? []).length} erro(s).
                Abra a observabilidade técnica para investigar sem expor dados nesta tela.
              </div>
            )}
          </>
        )}
      </Section>
      </>}

      {show("simulation") && <>
      <Section title="Simulação por usuário" icon={Play} description="Mostra o output que seria gerado. Não grava sugestão, notificação nem WhatsApp.">
        <div className="flex flex-col gap-2 md:flex-row">
          <input value={previewUserId} onChange={(event) => setPreviewUserId(event.target.value)} placeholder="UUID do usuário" className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <button type="button" disabled={dryRun.isPending} onClick={() => dryRun.mutate()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"><Eye size={15} /> {dryRun.isPending ? "Simulando..." : "Simular sem enviar"}</button>
        </div>
        {preview.length > 0 && <div className="mt-4 space-y-3">{preview.map((item) => <article key={item.dedup_key} className="rounded-xl border border-neutral-200 bg-white p-4"><div className="flex justify-between gap-3"><p className="font-medium">{item.title}</p><span className="text-xs text-neutral-500">{dict.commKind(item.kind)} · {dict.channel(item.channel_ready)}</span></div><p className="mt-2 text-sm text-neutral-600">{item.body}</p><p className="mt-2 break-all text-[11px] text-neutral-400">{item.dedup_key}</p></article>)}</div>}
      </Section>
      </>}

      {show("queue") && <>
      <Section title="Fila e bloqueios" icon={ListChecks} description="Sugestões pendentes e motivos reais de supressão.">
        {queue.isLoading ? (
          <p className="text-sm text-neutral-500">Carregando a operação de mensagens…</p>
        ) : queue.isError ? (
          <EmptyState title="Não foi possível carregar a fila" description={(queue.error as Error).message} />
        ) : (
          <div className="space-y-5">
            <StatGrid cols={3}>
              <StatCard label="Aguardando processamento" value={queue.data?.pending.length ?? 0} tone={(queue.data?.pending.length ?? 0) > 20 ? "warning" : "default"} />
              <StatCard label="Falhas recentes" value={(queue.data?.recent ?? []).filter((item) => item.status === "failed").length} tone={(queue.data?.recent ?? []).some((item) => item.status === "failed") ? "warning" : "default"} />
              <StatCard label="Retidas por regra" value={(queue.data?.blocks ?? []).reduce((total, item) => total + item.total, 0)} />
            </StatGrid>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Aguardando processamento</h3>
                <div className="mt-2 max-h-72 space-y-2 overflow-auto">
                  {(queue.data?.pending ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed p-4 text-sm text-neutral-500">Nenhuma comunicação aguardando processamento.</p>
                  ) : (queue.data?.pending ?? []).slice(0, 20).map((item) => (
                    <div key={item.id} className="rounded-xl border border-neutral-200 p-3">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-1 text-xs text-neutral-500">{dict.commKind(item.kind)} · {dateTime(item.created_at)} · {dict.channel(item.channel_ready)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Por que mensagens foram retidas</h3>
                <div className="mt-2 space-y-2">
                  {(queue.data?.blocks ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed p-4 text-sm text-neutral-500">Nenhuma retenção registrada nos últimos 30 dias.</p>
                  ) : (queue.data?.blocks ?? []).map((item) => (
                    <div key={item.reason} className="flex justify-between rounded-xl border border-neutral-200 p-3 text-sm">
                      <span>{readableReason(item.reason)}</span><strong>{item.total}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>
      </>}

      {show("effectiveness") && <>
      <Section title="Eficácia por tipo de insight" icon={Activity} description="Últimos 30 dias: quais avisos geraram ação e quais o usuário descartou.">
        {effectiveness.isLoading ? (
          <p className="text-sm text-neutral-500">Calculando eficácia…</p>
        ) : effectiveness.isError ? (
          <EmptyState title="Não foi possível calcular a eficácia" description={(effectiveness.error as Error).message} />
        ) : (effectiveness.data ?? []).length === 0 ? (
          <EmptyState title="Ainda sem histórico" description="Nenhuma comunicação foi entregue nos últimos 30 dias." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-neutral-500">
                <tr>
                  <th className="py-2 text-left">Tipo</th>
                  <th className="text-right">Entregues</th>
                  <th className="text-right">Geraram ação</th>
                  <th className="text-right">Descartadas</th>
                  <th className="text-right">Não útil</th>
                  <th className="text-right">Retidas</th>
                  <th className="text-right">Taxa de ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {[...(effectiveness.data ?? [])]
                  .sort((a, b) => b.delivered - a.delivered)
                  .map((row) => (
                    <tr key={row.kind}>
                      <td className="py-2 font-medium">{dict.commKind(row.kind)}</td>
                      <td className="text-right">{row.delivered}</td>
                      <td className="text-right">{row.acted}</td>
                      <td className="text-right">{row.dismissed}</td>
                      <td className="text-right">{row.not_useful}</td>
                      <td className="text-right">{row.suppressed}</td>
                      <td className={`text-right font-medium ${row.action_rate >= 0.2 ? "text-emerald-600" : row.dismissed > row.acted ? "text-amber-600" : ""}`}>
                        {(row.action_rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-neutral-500">
              Tipos com mais descartes que ações têm a prioridade reduzida automaticamente para cada usuário.
            </p>
          </div>
        )}
      </Section>
      </>}



      {show("catalog") && <>
      <Section title="Fluxos e regras de convivência" icon={Settings2} description="Cada tipo é um fluxo: quando dispara, por quais canais, com que intervalo mínimo e teto diário.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              <tr>
                <th className="py-2 text-left">Fluxo</th>
                <th className="text-left">Família</th>
                <th className="text-left">Canais</th>
                <th className="text-right">Intervalo mínimo</th>
                <th className="text-right">Máx./dia</th>
                <th className="text-right">Aprovação</th>
                <th className="text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(catalog.data ?? []).map((item) => (
                <tr key={item.kind} className={item.active ? "" : "opacity-50"}>
                  <td className="py-2 font-medium">{item.label || dict.commKind(item.kind)}</td>
                  <td className="text-neutral-600">{item.family}</td>
                  <td className="text-neutral-600">{(item.allowed_channels ?? []).map((c) => dict.channel(c)).join(" + ") || "—"}</td>
                  <td className="text-right">
                    <input
                      type="number"
                      min={0}
                      defaultValue={item.cooldown_hours ?? 0}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value !== (item.cooldown_hours ?? 0)) {
                          catalogUpdate.mutate({ kind: item.kind, cooldown_hours: value });
                        }
                      }}
                      className="w-16 rounded border border-neutral-200 px-2 py-1 text-right text-xs"
                      aria-label={`Intervalo mínimo em horas para ${item.label || item.kind}`}
                    />
                    <span className="ml-1 text-xs text-neutral-400">h</span>
                  </td>
                  <td className="text-right">
                    <input
                      type="number"
                      min={0}
                      defaultValue={item.max_per_day ?? 0}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value !== (item.max_per_day ?? 0)) {
                          catalogUpdate.mutate({ kind: item.kind, max_per_day: value });
                        }
                      }}
                      className="w-14 rounded border border-neutral-200 px-2 py-1 text-right text-xs"
                      aria-label={`Máximo por dia para ${item.label || item.kind}`}
                    />
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => catalogUpdate.mutate({ kind: item.kind, requires_manual_approval: !item.requires_manual_approval })}
                      className="rounded border border-neutral-200 px-2 py-1 text-xs"
                    >
                      {item.requires_manual_approval ? "Manual" : "Automático"}
                    </button>
                  </td>
                  <td className="text-right">
                    <button type="button" onClick={() => catalogUpdate.mutate({ kind: item.kind, active: !item.active })} className="rounded border border-neutral-200 px-2 py-1 text-xs">
                      {item.active ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      </>}

      {show("templates") && <>
      <Section title="Templates e prévia" icon={FileText} description="Edite app e WhatsApp com versionamento e validação de variáveis.">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-neutral-400" />
            <input
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="Buscar por nome ou caso de uso"
              className="w-full rounded-xl border border-neutral-200 py-2 pl-9 pr-3 text-sm"
            />
          </label>
          <select
            value={templateChannel}
            onChange={(event) => setTemplateChannel(event.target.value as typeof templateChannel)}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
            aria-label="Filtrar templates por canal"
          >
            <option value="all">Todos os canais</option>
            <option value="app">App</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const first = activeTemplates[0] ?? (templates.data ?? []).find((item) => item.active);
              if (!first) {
                adminToast.error("Nenhum caso de uso disponível para criar um template.");
                return;
              }
              setSelectedTemplate(first);
              setTitleTemplate(first.title_template);
              setBodyTemplate(first.body_template);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary px-4 py-2 text-sm font-medium text-primary"
          >
            <Plus size={16} /> Criar template
          </button>
        </div>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {templates.isLoading ? <p className="p-3 text-sm text-neutral-500">Carregando templates…</p> : activeTemplates.length === 0 ? <p className="rounded-xl border border-dashed p-4 text-sm text-neutral-500">Nenhum template corresponde aos filtros.</p> : activeTemplates.map((item) => <button key={item.id} type="button" onClick={() => { setSelectedTemplate(item); setTitleTemplate(item.title_template); setBodyTemplate(item.body_template); }} className={`w-full rounded-xl border p-3 text-left transition ${selectedTemplate?.id === item.id ? "border-primary bg-primary/5" : "border-neutral-200 hover:border-neutral-300"}`}><p className="text-sm font-medium">{dict.commKind(item.kind)}</p><p className="mt-1 text-xs text-neutral-500">{dict.channel(item.channel)} · versão {item.version}</p></button>)}
          </div>
          {!selectedTemplate ? <EmptyState title="Selecione um template" description="Escolha um caso de uso e canal para editar e visualizar." /> : <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs font-medium text-neutral-600">Caso de uso<select value={selectedTemplate.kind} onChange={(event) => { const next = (templates.data ?? []).find((item) => item.active && item.kind === event.target.value && item.channel === selectedTemplate.channel); if (next) { setSelectedTemplate(next); setTitleTemplate(next.title_template); setBodyTemplate(next.body_template); } }} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900">{Array.from(new Set((templates.data ?? []).filter((item) => item.active && item.channel === selectedTemplate.channel).map((item) => item.kind))).map((item) => <option key={item} value={item}>{dict.commKind(item)}</option>)}</select></label><label className="text-xs font-medium text-neutral-600">Canal<select value={selectedTemplate.channel} onChange={(event) => { const nextChannel = event.target.value as TemplateRow["channel"]; const next = (templates.data ?? []).find((item) => item.active && item.kind === selectedTemplate.kind && item.channel === nextChannel); if (!next) { adminToast.error("Este caso de uso ainda não está liberado para esse canal."); return; } setSelectedTemplate(next); setTitleTemplate(next.title_template); setBodyTemplate(next.body_template); }} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"><option value="app">App</option><option value="whatsapp">WhatsApp</option></select></label></div><p className="text-xs text-neutral-500">Versão atual {selectedTemplate.version} · variáveis permitidas: {selectedTemplate.allowed_variables.map((item) => `{{${item}}}`).join(", ")}</p><input aria-label="Título do template" value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" /><textarea aria-label="Mensagem do template" value={bodyTemplate} onChange={(event) => setBodyTemplate(event.target.value)} rows={6} className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" /><div className="rounded-xl border border-dashed border-neutral-300 bg-[#ECE5DD] p-4"><p className="text-xs uppercase text-neutral-500">Prévia com dados fictícios</p><div className="mt-2 max-w-sm rounded-2xl rounded-tl-sm bg-white p-3 shadow-sm"><p className="font-semibold">{titleTemplate.replace(/\{\{title\}\}/g, "Possível duplicidade: Uber")}</p><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{bodyTemplate.replace(/\{\{body\}\}/g, "Encontrei dois lançamentos de R$ 19,90 no mesmo dia. Confirme se são compras diferentes.").replace(/\{\{action_url\}\}/g, "www.meunino.com.br/app/alertas/exemplo")}</p></div></div><button type="button" disabled={templateSave.isPending} onClick={() => templateSave.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"><Save size={15} /> Publicar nova versão</button></div>}
        </div>
      </Section>
      </>}
    </div>
  );
}
