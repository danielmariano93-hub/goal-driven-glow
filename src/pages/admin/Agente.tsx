import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, MessageCircle, Users2, Activity, PencilLine, RotateCw, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/admin/StatusChip";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { mapWhatsAppStatus, mapAgentStatus, humanizeRelative } from "@/lib/admin/statusMapper";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonList, SkeletonStats } from "@/components/admin/AdminSkeleton";
import { adminToast } from "@/components/admin/adminToast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BehaviorEditor } from "./agente/BehaviorEditor";

type PromptRow = {
  id: string;
  version: number;
  status: "draft" | "active" | "archived";
  notes: string | null;
  structured_config: Record<string, unknown>;
  model: string;
  temperature: number;
  max_steps: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  published_by: string | null;
  parent_version_id: string | null;
  restored_from_id: string | null;
};

export default function AgenteAdmin() {
  const platform = useAdminPlatformStatus();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PromptRow | null>(null);

  const prompts = useQuery({
    queryKey: ["agent_prompts_full"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("agent_prompt_list");
      if (error) throw error;
      return (data as unknown as PromptRow[]) ?? [];
    },
  });

  const active = useMemo(() => prompts.data?.find((p) => p.status === "active") ?? null, [prompts.data]);
  const draft = useMemo(() => prompts.data?.find((p) => p.status === "draft") ?? null, [prompts.data]);
  const archived = useMemo(() => (prompts.data ?? []).filter((p) => p.status === "archived"), [prompts.data]);

  const createDraft = async (fromId?: string) => {
    const { data, error } = await supabase.rpc("agent_prompt_create_draft", { p_from_id: fromId ?? null });
    if (error) { adminToast.fromError(error, "Não foi possível criar o rascunho"); return; }
    adminToast.success("Rascunho criado");
    await qc.invalidateQueries({ queryKey: ["agent_prompts_full"] });
    const list = (await supabase.rpc("agent_prompt_list")).data as unknown as PromptRow[] | null;
    const found = list?.find((p) => p.id === (data as string));
    if (found) setEditing(found);
  };

  const restore = async (id: string) => {
    const { error } = await supabase.rpc("agent_prompt_restore", { p_id: id });
    if (error) { adminToast.fromError(error, "Não foi possível restaurar"); return; }
    adminToast.success("Versão restaurada como rascunho");
    await qc.invalidateQueries({ queryKey: ["agent_prompts_full"] });
  };

  const publish = async (row: PromptRow) => {
    const { error } = await supabase.rpc("agent_prompt_publish", { p_id: row.id, p_expected_updated_at: row.updated_at });
    if (error) { adminToast.fromError(error, "Não foi possível publicar"); return; }
    adminToast.success("Comportamento publicado");
    setEditing(null);
    await qc.invalidateQueries({ queryKey: ["agent_prompts_full"] });
  };

  const agent = platform.data?.agent;
  const wa = platform.data?.whatsapp;
  const view = mapAgentStatus(agent?.status);

  const links = useQuery({
    queryKey: ["wl_stats"],
    queryFn: async () => {
      const { data } = await supabase.from("whatsapp_links").select("status");
      const rows = (data as { status: string }[] | null) ?? [];
      return { active: rows.filter((r) => r.status === "active").length, total: rows.length };
    },
  });
  const outbox = useQuery({
    queryKey: ["outbox_summary"],
    queryFn: async () => {
      const { data } = await supabase.from("outbound_messages").select("status");
      const rows = (data as { status: string }[] | null) ?? [];
      return {
        queued: rows.filter((r) => r.status === "queued").length,
        delivered: rows.filter((r) => r.status === "delivered").length,
      };
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Assistente"
        description="Configure e publique como o assistente do MeuNino deve conversar com os usuários no WhatsApp e no app."
        status={<StatusChip view={view} size="sm" />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/agente/simulador"><Play size={12} /> Abrir simulador</Link>
          </Button>
        }
      />

      {wa && wa.status !== "connected" && (
        <div className="surface-card p-4 text-xs text-muted-foreground">
          Canal WhatsApp: <span className="font-medium text-foreground">{mapWhatsAppStatus(wa.status).label}</span>.{" "}
          <Link className="underline underline-offset-2 text-primary" to="/admin/whatsapp">Configurar em WhatsApp</Link>.
        </div>
      )}

      <Section title="Indicadores">
        <StatGrid>
          <StatCard icon={Users2} label="Vínculos ativos" value={links.data?.active ?? 0} />
          <StatCard icon={MessageCircle} label="Em fila" value={outbox.data?.queued ?? 0} />
          <StatCard icon={Bot} label="Entregues" value={outbox.data?.delivered ?? 0} tone="success" />
          <StatCard icon={Activity} label="Falhas 24h" value={agent?.failures_24h ?? 0} tone={agent?.failures_24h ? "warning" : "default"} />
        </StatGrid>
      </Section>

      <Section
        title="Comportamento"
        description="Como o assistente conversa. Publique um rascunho para aplicar mudanças em produção."
        action={!draft && (
          <Button size="sm" onClick={() => createDraft(active?.id)}>
            <PencilLine size={12} /> Criar rascunho
          </Button>
        )}
      >
        {prompts.isLoading && <SkeletonStats count={3} />}

        {active && (
          <div className="surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">Versão {active.version}</p>
                  <Badge className="bg-success/15 text-success border-success/30">publicada</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {active.published_at ? `Publicada ${humanizeRelative(active.published_at)}` : "Publicada"} · {active.notes ?? "sem notas"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(active)}>Ver detalhes</Button>
            </div>
          </div>
        )}

        {draft && (
          <div className="surface-card p-5 border-primary/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">Rascunho v{draft.version}</p>
                  <Badge variant="outline" className="border-primary/40 text-primary">rascunho</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {draft.notes ?? "sem notas"} · atualizado {humanizeRelative(draft.updated_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(draft)}>
                  <PencilLine size={12} /> Editar
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm">Publicar</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Publicar este comportamento?</AlertDialogTitle>
                      <AlertDialogDescription>
                        A versão em uso será arquivada e este rascunho passa a valer imediatamente para todos os usuários.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => publish(draft)}>Publicar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        )}

        {!prompts.isLoading && !active && !draft && (
          <EmptyState
            icon={Bot}
            title="Nenhum comportamento configurado ainda"
            description="Crie um rascunho para definir tom, regras e templates do assistente."
            action={<Button onClick={() => createDraft()}><PencilLine size={12} /> Criar rascunho</Button>}
          />
        )}
      </Section>

      {archived.length > 0 && (
        <Section title="Histórico">
          {prompts.isLoading ? <SkeletonList rows={3} /> : (
            <div className="surface-card divide-y divide-border">
              {archived.map((p) => (
                <div key={p.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">Versão {p.version} · {p.notes ?? "arquivada"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.published_at ? `Publicada ${humanizeRelative(p.published_at)}` : `Criada ${humanizeRelative(p.created_at)}`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => restore(p.id)}>
                    <RotateCw size={12} /> Restaurar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {editing && (
        <BehaviorEditor
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ["agent_prompts_full"] });
            const list = (await supabase.rpc("agent_prompt_list")).data as unknown as PromptRow[] | null;
            const fresh = list?.find((p) => p.id === editing.id) ?? null;
            setEditing(fresh);
          }}
          onPublish={editing.status === "draft" ? () => publish(editing) : undefined}
        />
      )}
    </div>
  );
}
