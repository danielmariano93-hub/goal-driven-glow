import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Eye, FileText, ListChecks, Play, Save, Settings2 } from "lucide-react";
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

const rpc = (supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}).rpc.bind(supabase);

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function readableReason(reason: string | null): string {
  const labels: Record<string, string> = {
    rollout_channel_disabled: "Canal não liberado no rollout",
    candidate_channel_not_ready: "A sugestão não foi preparada para este canal",
    kind_disabled_in_catalog: "Tipo desativado no catálogo",
    channel_disabled_in_catalog: "Canal desativado para este tipo",
    awaiting_manual_approval: "Aguardando aprovação manual",
    daily_frequency_cap: "Limite diário atingido",
    weekly_frequency_cap: "Limite semanal atingido",
    quiet_hours: "Horário silencioso",
    dedup_cooldown: "Assunto já enviado recentemente",
  };
  return labels[reason ?? ""] ?? reason ?? "Sem motivo registrado";
}

export function ProactiveEnginePanelV2() {
  const queryClient = useQueryClient();
  const [previewUserId, setPreviewUserId] = useState("");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRow | null>(null);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");

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
      const { data, error } = await rpc("admin_proactive_queue", { _limit: 50 });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar fila"));
      return data as QueueData;
    },
    staleTime: 15_000,
  });
  const catalog = useQuery({
    queryKey: ["admin_communication_catalog"],
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await rpc("admin_communication_catalog");
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar catálogo"));
      return (data as CatalogRow[]) ?? [];
    },
  });
  const templates = useQuery({
    queryKey: ["admin_communication_templates"],
    queryFn: async (): Promise<TemplateRow[]> => {
      const { data, error } = await rpc("admin_communication_templates", { _kind: null });
      if (error) throw new Error(adminErrorMessage(error, "Falha ao carregar templates"));
      return (data as TemplateRow[]) ?? [];
    },
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
    mutationFn: async (args: { kind: string; active: boolean }) => {
      const { error } = await rpc("admin_communication_catalog_update", { _kind: args.kind, _active: args.active });
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

  const activeTemplates = useMemo(() => (templates.data ?? []).filter((item) => item.active), [templates.data]);
  const s = status.data;
  const channels = s?.channels ?? [];

  return (
    <div className="space-y-6">
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
            {(s?.last_tick_errors ?? []).length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{(s?.last_tick_errors ?? []).slice(0, 5).map((item, index) => <p key={index}>{item.user_id?.slice(0, 8)}… — {item.error}</p>)}</div>}
          </>
        )}
      </Section>

      <Section title="Simulação por usuário" icon={Play} description="Mostra o output que seria gerado. Não grava sugestão, notificação nem WhatsApp.">
        <div className="flex flex-col gap-2 md:flex-row">
          <input value={previewUserId} onChange={(event) => setPreviewUserId(event.target.value)} placeholder="UUID do usuário" className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <button type="button" disabled={dryRun.isPending} onClick={() => dryRun.mutate()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"><Eye size={15} /> {dryRun.isPending ? "Simulando..." : "Simular sem enviar"}</button>
        </div>
        {preview.length > 0 && <div className="mt-4 space-y-3">{preview.map((item) => <article key={item.dedup_key} className="rounded-xl border border-neutral-200 bg-white p-4"><div className="flex justify-between gap-3"><p className="font-medium">{item.title}</p><span className="text-xs text-neutral-500">{item.kind} · {item.channel_ready}</span></div><p className="mt-2 text-sm text-neutral-600">{item.body}</p><p className="mt-2 break-all text-[11px] text-neutral-400">{item.dedup_key}</p></article>)}</div>}
      </Section>

      <Section title="Fila e bloqueios" icon={ListChecks} description="Sugestões pendentes e motivos reais de supressão.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div><h3 className="text-sm font-semibold">Pendentes ({queue.data?.pending.length ?? 0})</h3><div className="mt-2 max-h-72 space-y-2 overflow-auto">{(queue.data?.pending ?? []).slice(0, 20).map((item) => <div key={item.id} className="rounded-lg border border-neutral-200 p-3"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-neutral-500">{item.kind} · {dateTime(item.created_at)} · {item.channel_ready}</p></div>)}</div></div>
          <div><h3 className="text-sm font-semibold">Bloqueios</h3><div className="mt-2 space-y-2">{(queue.data?.blocks ?? []).map((item) => <div key={item.reason} className="flex justify-between rounded-lg border border-neutral-200 p-3 text-sm"><span>{readableReason(item.reason)}</span><strong>{item.total}</strong></div>)}</div></div>
        </div>
      </Section>

      <Section title="Catálogo de comunicações" icon={Settings2} description="Tipos ativos, família, prioridade e modo de conteúdo.">
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs uppercase text-neutral-500"><tr><th className="py-2 text-left">Tipo</th><th className="text-left">Família</th><th className="text-left">Modo</th><th className="text-right">Prioridade</th><th className="text-right">Ação</th></tr></thead><tbody className="divide-y divide-neutral-100">{(catalog.data ?? []).map((item) => <tr key={item.kind} className={item.active ? "" : "opacity-50"}><td className="py-2 font-medium">{item.label || item.kind}</td><td>{item.family}</td><td>{item.content_mode}</td><td className="text-right">{item.base_priority}</td><td className="text-right"><button type="button" onClick={() => catalogUpdate.mutate({ kind: item.kind, active: !item.active })} className="rounded border border-neutral-200 px-2 py-1 text-xs">{item.active ? "Desativar" : "Ativar"}</button></td></tr>)}</tbody></table></div>
      </Section>

      <Section title="Templates e prévia" icon={FileText} description="Edite app e WhatsApp com versionamento e validação de variáveis.">
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="max-h-[420px] space-y-2 overflow-auto">{activeTemplates.map((item) => <button key={item.id} type="button" onClick={() => { setSelectedTemplate(item); setTitleTemplate(item.title_template); setBodyTemplate(item.body_template); }} className={`w-full rounded-lg border p-3 text-left ${selectedTemplate?.id === item.id ? "border-primary bg-primary/5" : "border-neutral-200"}`}><p className="text-sm font-medium">{item.kind}</p><p className="mt-1 text-xs text-neutral-500">{item.channel} · versão {item.version}</p></button>)}</div>
          {!selectedTemplate ? <EmptyState title="Selecione um template" description="Escolha um tipo e canal para editar e visualizar." /> : <div className="space-y-3"><div className="flex items-center justify-between"><p className="text-sm font-semibold">{selectedTemplate.kind} · {selectedTemplate.channel}</p><span className="text-xs text-neutral-500">Variáveis: {selectedTemplate.allowed_variables.map((item) => `{{${item}}}`).join(", ")}</span></div><input value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" /><textarea value={bodyTemplate} onChange={(event) => setBodyTemplate(event.target.value)} rows={6} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" /><div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4"><p className="text-xs uppercase text-neutral-500">Prévia com dados fictícios</p><p className="mt-2 font-semibold">{titleTemplate.replace(/\{\{title\}\}/g, "Possível duplicidade: Uber")}</p><p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">{bodyTemplate.replace(/\{\{body\}\}/g, "Encontrei dois lançamentos de R$ 19,90 no mesmo dia. Confirme se são compras diferentes.").replace(/\{\{action_url\}\}/g, "/app/alertas/exemplo")}</p></div><button type="button" disabled={templateSave.isPending} onClick={() => templateSave.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-60"><Save size={15} /> Publicar nova versão</button></div>}
        </div>
      </Section>
    </div>
  );
}
