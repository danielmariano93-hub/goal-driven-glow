import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, MessageCircle, Users2, Activity, Plus, Play, RotateCw, PencilLine, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/admin/StatusChip";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";
import { mapWhatsAppStatus, mapAgentStatus, humanizeRelative } from "@/lib/admin/statusMapper";
import { mapAdminActionError } from "@/lib/admin/errorMapper";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

type StructuredCfg = {
  name: string;
  objective: string;
  tone: string;
  do: string[];
  dont: string[];
  welcome: string;
  fallback: string;
  proactive: boolean;
  formality: string;
  emoji_style: string;
  address_style: string;
  signature: string;
  preferred_words: string[];
  forbidden_words: string[];
  templates: Record<string, string>;
};

const DEFAULT_CFG: StructuredCfg = {
  name: "",
  objective: "Ajudar o usuário a organizar a vida financeira com respeito e clareza.",
  tone: "humano, encorajador, direto",
  do: ["Confirmar antes de gravar qualquer alteração financeira"],
  dont: ["Inventar valores, saldos ou datas"],
  welcome: "Oi! Sou o assistente do NoControle.ia. Como posso ajudar?",
  fallback: "Não entendi ainda. Pode reformular?",
  proactive: false,
  formality: "informal e respeitoso",
  emoji_style: "moderado",
  address_style: "você",
  signature: "",
  preferred_words: [],
  forbidden_words: [],
  templates: {},
};

function normalize(cfg: unknown): StructuredCfg {
  const c = (cfg ?? {}) as Partial<StructuredCfg> & Record<string, unknown>;
  return {
    name: String(c.name ?? DEFAULT_CFG.name),
    objective: String(c.objective ?? DEFAULT_CFG.objective),
    tone: String(c.tone ?? DEFAULT_CFG.tone),
    do: Array.isArray(c.do) ? c.do.map(String) : DEFAULT_CFG.do,
    dont: Array.isArray(c.dont) ? c.dont.map(String) : DEFAULT_CFG.dont,
    welcome: String(c.welcome ?? DEFAULT_CFG.welcome),
    fallback: String(c.fallback ?? DEFAULT_CFG.fallback),
    proactive: Boolean(c.proactive ?? false),
    formality: String(c.formality ?? DEFAULT_CFG.formality),
    emoji_style: String(c.emoji_style ?? DEFAULT_CFG.emoji_style),
    address_style: String(c.address_style ?? DEFAULT_CFG.address_style),
    signature: String(c.signature ?? DEFAULT_CFG.signature),
    preferred_words: Array.isArray(c.preferred_words) ? (c.preferred_words as unknown[]).map(String) : [],
    forbidden_words: Array.isArray(c.forbidden_words) ? (c.forbidden_words as unknown[]).map(String) : [],
    templates: typeof c.templates === "object" && c.templates ? c.templates as Record<string, string> : {},
  };
}

const PREVIEW_VARS: Record<string, string> = {
  participant_name: "Lucas",
  owner_name: "Daniel",
  title: "Fakku",
  amount: "R$ 19,95",
  due_date: "22/07",
  due_sentence: " O combinado é pagar até 22/07.",
  pix_key: "daniel@nocontrole.ia",
  pix_sentence: " Pix: daniel@nocontrole.ia.",
};

function renderPreview(template: string, cfg: StructuredCfg): string {
  const raw = template?.trim() || "(usando texto padrão do NoControle.ia)";
  let out = raw.replace(/\{\{([a-z_]+)\}\}/g, (_m, k: string) => PREVIEW_VARS[k] ?? "");
  out = out.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
  const sig = cfg.signature?.trim();
  const name = cfg.name?.trim();
  if (sig) out += `\n\n${sig}`;
  else if (name) out += `\n\n— ${name}`;
  return out;
}

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
    if (error) { const fe = mapAdminActionError(error); toast.error(`${fe.title} · ${fe.code}`); return; }
    toast.success("Rascunho criado.");
    await qc.invalidateQueries({ queryKey: ["agent_prompts_full"] });
    const list = (await supabase.rpc("agent_prompt_list")).data as unknown as PromptRow[] | null;
    const found = list?.find((p) => p.id === (data as string));
    if (found) setEditing(found);
  };

  const restore = async (id: string) => {
    const { error } = await supabase.rpc("agent_prompt_restore", { p_id: id });
    if (error) { const fe = mapAdminActionError(error); toast.error(`${fe.title} · ${fe.code}`); return; }
    toast.success("Versão restaurada como rascunho.");
    await qc.invalidateQueries({ queryKey: ["agent_prompts_full"] });
  };

  const publish = async (row: PromptRow) => {
    const { error } = await supabase.rpc("agent_prompt_publish", { p_id: row.id, p_expected_updated_at: row.updated_at });
    if (error) { const fe = mapAdminActionError(error); toast.error(`${fe.title} · ${fe.code}`); return; }
    toast.success("Comportamento publicado.");
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
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Assistente</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure e publique como o assistente do NoControle.ia deve conversar com os usuários no WhatsApp.
        </p>
      </header>

      <section className="surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusChip view={view} />
            <span className="text-sm text-muted-foreground">{view.impact}</span>
          </div>
          <div className="flex gap-2">
            <Link to="/admin/agente/simulador"
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
              <Play className="h-3 w-3" /> Abrir simulador
            </Link>
          </div>
        </div>
        {wa && wa.status !== "connected" && (
          <p className="text-xs text-muted-foreground mt-3">
            Canal WhatsApp: <span className="font-medium">{mapWhatsAppStatus(wa.status).label}</span>.{" "}
            <Link className="underline" to="/admin/whatsapp">Configurar em WhatsApp</Link>.
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card icon={Users2} label="Vínculos ativos" value={links.data?.active ?? 0} />
        <Card icon={MessageCircle} label="Em fila" value={outbox.data?.queued ?? 0} />
        <Card icon={Bot} label="Entregues" value={outbox.data?.delivered ?? 0} />
        <Card icon={Activity} label="Falhas 24h" value={agent?.failures_24h ?? 0} />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Comportamento em uso</h2>
          {!draft && (
            <button onClick={() => createDraft(active?.id)}
              className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs">
              <PencilLine className="h-3 w-3" /> Criar rascunho
            </button>
          )}
        </div>

        {prompts.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {active && (
          <div className="surface-card p-5 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Versão {active.version} · publicada</p>
                <p className="text-xs text-muted-foreground">
                  {active.published_at ? `Publicada ${humanizeRelative(active.published_at)}` : "Publicada"} · {active.notes ?? "sem notas"}
                </p>
              </div>
              <button onClick={() => setEditing(active)}
                className="text-xs underline text-muted-foreground">Ver detalhes</button>
            </div>
          </div>
        )}

        {draft && (
          <div className="surface-card p-5 mb-3 border-primary/40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Rascunho aberto · versão {draft.version}</p>
                <p className="text-xs text-muted-foreground">{draft.notes ?? "sem notas"} · atualizado {humanizeRelative(draft.updated_at)}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(draft)}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
                  <PencilLine className="h-3 w-3" /> Editar
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs">
                      Publicar
                    </button>
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

        {archived.length > 0 && (
          <div className="surface-card divide-y divide-border">
            <p className="p-3 text-xs uppercase tracking-wider text-muted-foreground">Histórico</p>
            {archived.map((p) => (
              <div key={p.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm">Versão {p.version} · {p.notes ?? "arquivada"}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.published_at ? `Publicada ${humanizeRelative(p.published_at)}` : `Criada ${humanizeRelative(p.created_at)}`}
                  </p>
                </div>
                <button onClick={() => restore(p.id)}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
                  <RotateCw className="h-3 w-3" /> Restaurar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

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
        />
      )}
    </div>
  );
}

function BehaviorEditor({ row, onClose, onSaved }: {
  row: PromptRow; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const readOnly = row.status !== "draft";
  const [cfg, setCfg] = useState<StructuredCfg>(normalize(row.structured_config));
  const [notes, setNotes] = useState(row.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setCfg(normalize(row.structured_config)); setNotes(row.notes ?? ""); }, [row.id, row.updated_at, row.structured_config, row.notes]);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("agent_prompt_update_draft", {
        p_id: row.id,
        p_cfg: cfg as unknown as never,
        p_notes: notes,
        p_expected_updated_at: row.updated_at,
      });
      if (error) throw error;
      toast.success("Rascunho salvo.");
      await onSaved();
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setSaving(false); }
  };

  const setList = (key: "do" | "dont") => (idx: number, value: string) => {
    const arr = [...cfg[key]];
    arr[idx] = value;
    setCfg({ ...cfg, [key]: arr });
  };
  const addItem = (key: "do" | "dont") => setCfg({ ...cfg, [key]: [...cfg[key], ""] });
  const removeItem = (key: "do" | "dont", idx: number) => setCfg({ ...cfg, [key]: cfg[key].filter((_, i) => i !== idx) });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-2xl bg-background h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b bg-background">
          <div>
            <p className="text-sm font-semibold">{readOnly ? `Versão ${row.version} (arquivada/publicada)` : `Rascunho v${row.version}`}</p>
            <p className="text-[11px] text-muted-foreground">Atualizado {humanizeRelative(row.updated_at)}</p>
          </div>
          <button onClick={onClose} className="rounded-full border p-1.5 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-6 space-y-5">
          <Field label="Nome do assistente (opcional)" value={cfg.name} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, name: v })} />
          <Field label="Objetivo" value={cfg.objective} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, objective: v })} textarea />
          <Field label="Tom de voz" value={cfg.tone} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, tone: v })} />
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Formalidade" value={cfg.formality} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, formality: v })} />
            <Field label="Uso de emojis" value={cfg.emoji_style} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, emoji_style: v })} />
            <Field label="Como chamar a pessoa" value={cfg.address_style} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, address_style: v })} />
          </div>
          <Field label="Assinatura (opcional)" value={cfg.signature} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, signature: v })} />

          <ListField label="O que deve fazer" items={cfg.do} disabled={readOnly}
            onChange={setList("do")} onAdd={() => addItem("do")} onRemove={(i) => removeItem("do", i)} />
          <ListField label="O que nunca deve fazer" items={cfg.dont} disabled={readOnly}
            onChange={setList("dont")} onAdd={() => addItem("dont")} onRemove={(i) => removeItem("dont", i)} />

          <Field label="Mensagem de boas-vindas" value={cfg.welcome} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, welcome: v })} textarea />
          <Field label="Quando não entender" value={cfg.fallback} disabled={readOnly} onChange={(v) => setCfg({ ...cfg, fallback: v })} textarea />

          <div className="space-y-3 rounded-2xl border border-border p-4">
            <div>
              <p className="text-sm font-semibold">Mensagens da Divisão do Rolê</p>
              <p className="text-xs text-muted-foreground">Use variáveis como {"{{participant_name}}"}, {"{{title}}"}, {"{{amount}}"}, {"{{due_sentence}}"} e {"{{pix_sentence}}"}. Em branco usa o texto amigável padrão.</p>
            </div>
            {([
              ["invite", "Convite inicial"], ["reminder", "Lembrete"],
              ["due_soon", "Vencimento próximo"], ["overdue", "Em atraso"],
              ["payment_confirmation", "Pagamento confirmado"], ["completed", "Rolê concluído"],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label} value={cfg.templates[key] ?? ""} disabled={readOnly}
                onChange={(v) => setCfg({ ...cfg, templates: { ...cfg.templates, [key]: v } })} textarea />
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.proactive} disabled={readOnly}
              onChange={(e) => setCfg({ ...cfg, proactive: e.target.checked })} />
            Pode sugerir próximos passos proativamente
          </label>

          <div className="rounded-xl border border-border/60 bg-muted/40 p-4 text-xs text-muted-foreground">
            <p className="font-semibold mb-1 text-foreground">Regras de segurança obrigatórias (não editáveis)</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Nunca inventar valores, saldos, datas ou identidades.</li>
              <li>Toda operação que altera dinheiro exige CONFIRMAR antes de gravar.</li>
              <li>Nunca revelar credenciais nem dados de outro usuário.</li>
              <li>Respeitar LGPD; usar só dados do usuário autenticado.</li>
              <li>Se detectar vulnerabilidade emocional, responder com empatia.</li>
            </ul>
          </div>

          {!readOnly && (
            <>
              <Field label="Notas desta versão" value={notes} onChange={setNotes} textarea disabled={false} />
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="rounded-full border px-4 py-2 text-xs">Fechar</button>
                <button onClick={save} disabled={saving}
                  className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
                  {saving ? "Salvando…" : "Salvar rascunho"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, textarea, disabled }: {
  label: string; value: string; onChange: (v: string) => void; textarea?: boolean; disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      {textarea ? (
        <textarea value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-70" />
      ) : (
        <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-70" />
      )}
    </label>
  );
}

function ListField({ label, items, onChange, onAdd, onRemove, disabled }: {
  label: string; items: string[]; disabled: boolean;
  onChange: (idx: number, v: string) => void; onAdd: () => void; onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <span className="text-xs font-medium">{label}</span>
      <ul className="mt-1 space-y-2">
        {items.map((it, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <input value={it} disabled={disabled} onChange={(e) => onChange(idx, e.target.value)}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-70" />
            {!disabled && (
              <button onClick={() => onRemove(idx)} className="rounded-full border p-1.5 hover:bg-accent" aria-label="Remover">
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <button onClick={onAdd} className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
          <Plus className="h-3 w-3" /> Adicionar
        </button>
      )}
    </div>
  );
}

function Card({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wider">
        <Icon size={12} /> {label}
      </div>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}
