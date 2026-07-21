import { useEffect, useState } from "react";
import { X, Plus, Save, Send, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { adminToast } from "@/components/admin/adminToast";
import { humanizeRelative } from "@/lib/admin/statusMapper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { normalizeCfg, renderPreview, type StructuredCfg } from "./cfg";

type PromptRow = {
  id: string;
  version: number;
  status: "draft" | "active" | "archived";
  notes: string | null;
  structured_config: Record<string, unknown>;
  updated_at: string;
  published_at: string | null;
};

const TEMPLATE_KEYS: Array<[string, string]> = [
  ["invite", "Divisão do Rolê · Convite inicial"],
  ["reminder", "Divisão do Rolê · Lembrete"],
  ["due_soon", "Divisão do Rolê · Vencimento próximo"],
  ["overdue", "Divisão do Rolê · Em atraso"],
  ["payment_confirmation", "Divisão do Rolê · Pagamento confirmado"],
  ["completed", "Divisão do Rolê · Rolê concluído"],
  ["financial_chat", "Conversa financeira geral (assessor)"],
  ["insights", "Insights e relatórios"],
  ["platform_support", "Suporte da plataforma"],
];

export function BehaviorEditor({
  row,
  onClose,
  onSaved,
  onPublish,
}: {
  row: PromptRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onPublish?: () => void;
}) {
  const readOnly = row.status !== "draft";
  const [cfg, setCfg] = useState<StructuredCfg>(normalizeCfg(row.structured_config));
  const [notes, setNotes] = useState(row.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCfg(normalizeCfg(row.structured_config));
    setNotes(row.notes ?? "");
  }, [row.id, row.updated_at, row.structured_config, row.notes]);

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
      adminToast.success("Rascunho salvo");
      await onSaved();
    } catch (e) {
      adminToast.fromError(e, "Não foi possível salvar");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end" role="dialog" aria-modal="true" aria-label="Editor de comportamento">
      <div className="w-full max-w-3xl bg-background h-dvh overflow-hidden flex flex-col shadow-2xl">
        <header className="flex items-center justify-between gap-3 px-5 md:px-6 py-4 border-b border-border bg-card">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {readOnly ? `Versão ${row.version} · ${row.status}` : `Rascunho v${row.version}`}
            </p>
            <p className="text-[11px] text-muted-foreground">Atualizado {humanizeRelative(row.updated_at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border p-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Fechar editor"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 md:px-6 py-5">
            <Tabs defaultValue="identity" className="space-y-5">
              <TabsList className="grid w-full grid-cols-3 md:inline-grid md:grid-cols-5 md:w-auto">
                <TabsTrigger value="identity">Identidade</TabsTrigger>
                <TabsTrigger value="tone">Tom</TabsTrigger>
                <TabsTrigger value="rules">Regras</TabsTrigger>
                <TabsTrigger value="templates">Templates</TabsTrigger>
                <TabsTrigger value="advanced">Avançado</TabsTrigger>
              </TabsList>

              <TabsContent value="identity" className="space-y-4">
                <FieldGroup>
                  <FormField id="cfg-name" label="Nome do assistente" hint="Opcional — usado como assinatura automática se não houver assinatura explícita." optional readOnly={readOnly}>
                    <Input id="cfg-name" value={cfg.name} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder="Ex.: NoControle.ia" />
                  </FormField>
                  <FormField id="cfg-objective" label="Objetivo principal" hint="Explica em uma frase o que o assistente deve fazer." required readOnly={readOnly}>
                    <Textarea id="cfg-objective" value={cfg.objective} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, objective: e.target.value })} rows={3} />
                  </FormField>
                  <FormField id="cfg-signature" label="Assinatura" hint="Texto aplicado ao final das mensagens." optional readOnly={readOnly}>
                    <Input id="cfg-signature" value={cfg.signature} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, signature: e.target.value })} placeholder="— NoControle.ia" />
                  </FormField>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="tone" className="space-y-4">
                <FieldGroup>
                  <FormField id="cfg-tone" label="Tom de voz" hint="Palavras-chave que descrevem o jeito de falar." required readOnly={readOnly}>
                    <Input id="cfg-tone" value={cfg.tone} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, tone: e.target.value })} />
                  </FormField>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FormField id="cfg-formality" label="Formalidade" optional readOnly={readOnly}>
                      <Input id="cfg-formality" value={cfg.formality} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, formality: e.target.value })} />
                    </FormField>
                    <FormField id="cfg-emoji" label="Uso de emojis" optional readOnly={readOnly}>
                      <Input id="cfg-emoji" value={cfg.emoji_style} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, emoji_style: e.target.value })} />
                    </FormField>
                    <FormField id="cfg-address" label="Como chamar a pessoa" optional readOnly={readOnly}>
                      <Input id="cfg-address" value={cfg.address_style} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, address_style: e.target.value })} />
                    </FormField>
                  </div>
                  <FormField id="cfg-welcome" label="Mensagem de boas-vindas" optional readOnly={readOnly}>
                    <Textarea id="cfg-welcome" value={cfg.welcome} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, welcome: e.target.value })} rows={3} />
                  </FormField>
                  <FormField id="cfg-fallback" label="Quando não entender" hint="Resposta padrão para casos ambíguos." optional readOnly={readOnly}>
                    <Textarea id="cfg-fallback" value={cfg.fallback} disabled={readOnly} onChange={(e) => setCfg({ ...cfg, fallback: e.target.value })} rows={2} />
                  </FormField>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="rules" className="space-y-4">
                <FieldGroup>
                  <ListField
                    label="O que deve fazer"
                    hint="Comportamentos obrigatórios do assistente."
                    items={cfg.do}
                    disabled={readOnly}
                    onChange={(i, v) => { const a = [...cfg.do]; a[i] = v; setCfg({ ...cfg, do: a }); }}
                    onAdd={() => setCfg({ ...cfg, do: [...cfg.do, ""] })}
                    onRemove={(i) => setCfg({ ...cfg, do: cfg.do.filter((_, x) => x !== i) })}
                  />
                  <ListField
                    label="O que nunca deve fazer"
                    hint="Comportamentos proibidos."
                    items={cfg.dont}
                    disabled={readOnly}
                    onChange={(i, v) => { const a = [...cfg.dont]; a[i] = v; setCfg({ ...cfg, dont: a }); }}
                    onAdd={() => setCfg({ ...cfg, dont: [...cfg.dont, ""] })}
                    onRemove={(i) => setCfg({ ...cfg, dont: cfg.dont.filter((_, x) => x !== i) })}
                  />
                  <ListField
                    label="Palavras preferidas"
                    items={cfg.preferred_words}
                    disabled={readOnly}
                    onChange={(i, v) => { const a = [...cfg.preferred_words]; a[i] = v; setCfg({ ...cfg, preferred_words: a }); }}
                    onAdd={() => setCfg({ ...cfg, preferred_words: [...cfg.preferred_words, ""] })}
                    onRemove={(i) => setCfg({ ...cfg, preferred_words: cfg.preferred_words.filter((_, x) => x !== i) })}
                  />
                  <ListField
                    label="Palavras proibidas"
                    items={cfg.forbidden_words}
                    disabled={readOnly}
                    onChange={(i, v) => { const a = [...cfg.forbidden_words]; a[i] = v; setCfg({ ...cfg, forbidden_words: a }); }}
                    onAdd={() => setCfg({ ...cfg, forbidden_words: [...cfg.forbidden_words, ""] })}
                    onRemove={(i) => setCfg({ ...cfg, forbidden_words: cfg.forbidden_words.filter((_, x) => x !== i) })}
                  />
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
                    <div className="min-w-0">
                      <Label htmlFor="cfg-proactive" className="text-sm font-medium">Modo proativo</Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Se ligado, o assistente pode sugerir próximos passos sem ser perguntado.
                      </p>
                    </div>
                    <Switch id="cfg-proactive" checked={cfg.proactive} disabled={readOnly} onCheckedChange={(v) => setCfg({ ...cfg, proactive: v })} />
                  </div>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="templates" className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs text-muted-foreground flex gap-2">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <p>
                    Variáveis: <code>{"{{participant_name}}"}</code>, <code>{"{{owner_name}}"}</code>, <code>{"{{title}}"}</code>,{" "}
                    <code>{"{{amount}}"}</code>, <code>{"{{due_date}}"}</code>, <code>{"{{due_sentence}}"}</code>,{" "}
                    <code>{"{{pix_key}}"}</code>, <code>{"{{pix_sentence}}"}</code>. Em branco, o NoControle.ia usa o texto padrão.
                  </p>
                </div>
                <div className="space-y-4">
                  {TEMPLATE_KEYS.map(([key, label]) => (
                    <TemplateField
                      key={key}
                      label={label}
                      value={cfg.templates[key] ?? ""}
                      disabled={readOnly}
                      cfg={cfg}
                      onChange={(v) => setCfg({ ...cfg, templates: { ...cfg.templates, [key]: v } })}
                    />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-muted/40 p-4 text-xs text-muted-foreground">
                  <p className="font-semibold mb-2 text-foreground">Regras de segurança obrigatórias (não editáveis)</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Nunca inventar valores, saldos, datas ou identidades.</li>
                    <li>Toda operação que altera dinheiro exige CONFIRMAR antes de gravar.</li>
                    <li>Nunca revelar credenciais nem dados de outro usuário.</li>
                    <li>Respeitar LGPD; usar só dados do usuário autenticado.</li>
                    <li>Se detectar vulnerabilidade emocional, responder com empatia.</li>
                  </ul>
                </div>
                {!readOnly && (
                  <FormField id="cfg-notes" label="Notas desta versão" hint="Documente o motivo desta mudança." optional readOnly={false}>
                    <Textarea id="cfg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
                  </FormField>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {!readOnly && (
          <footer className="border-t border-border bg-card px-5 md:px-6 py-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save size={14} /> {saving ? "Salvando…" : "Salvar rascunho"}
            </Button>
            {onPublish && (
              <Button size="sm" variant="secondary" onClick={onPublish} disabled={saving}>
                <Send size={14} /> Publicar
              </Button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

function FormField({
  id, label, hint, children, required, optional, readOnly,
}: {
  id: string; label: string; hint?: string; children: React.ReactNode;
  required?: boolean; optional?: boolean; readOnly?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        {required && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">obrigatório</Badge>}
        {optional && <Badge variant="outline" className="text-[10px] text-muted-foreground">opcional</Badge>}
        {readOnly && <Badge variant="secondary" className="text-[10px]">somente leitura</Badge>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function ListField({
  label, hint, items, onChange, onAdd, onRemove, disabled,
}: {
  label: string; hint?: string; items: string[]; disabled: boolean;
  onChange: (idx: number, v: string) => void; onAdd: () => void; onRemove: (idx: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <ul className="space-y-2">
        {items.map((it, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <Input value={it} disabled={disabled} onChange={(e) => onChange(idx, e.target.value)} />
            {!disabled && (
              <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(idx)} aria-label="Remover item">
                <X size={14} />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <Button type="button" variant="ghost" size="sm" onClick={onAdd} className="text-primary hover:text-primary">
          <Plus size={12} /> Adicionar
        </Button>
      )}
    </div>
  );
}

function TemplateField({
  label, value, onChange, disabled, cfg,
}: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean; cfg: StructuredCfg;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2 rounded-xl border border-border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{label}</Label>
        <Textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="font-mono text-xs"
        />
      </div>
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 p-3 min-h-[140px]">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prévia</p>
        <p className="whitespace-pre-wrap text-xs text-foreground/90 break-words">{renderPreview(value, cfg)}</p>
      </div>
    </div>
  );
}
