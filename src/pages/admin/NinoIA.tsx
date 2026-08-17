import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bot, BrainCircuit, BookOpen, Loader2, Save } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import type { AiModelRoute, KnowledgeEntry } from "@/lib/admin/ninoContracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminToast } from "@/components/admin/adminToast";
import IAInteligencia from "./IAInteligencia";
import Assistente from "./operacao/Assistente";
import IaOcr from "./operacao/IaOcr";
import Simulador from "./AgenteSimulador";

/**
 * Destino único da inteligência: qualidade, custo, configuração, documentos
 * e simulador em um só nível de aba — nunca aba dentro de aba.
 */
export default function NinoIA() {
  return (
    <div className="space-y-6">
      <PageHeader title="Nino & IA" description="Qualidade das respostas, custo por modelo, conhecimento oficial, leitura de documentos e simulador." />
      <AdminTabs tabs={[
        { id: "qualidade", label: "Qualidade", render: () => <Assistente /> },
        { id: "custo", label: "Custo e uso", render: () => <IAInteligencia /> },
        { id: "modelos", label: "Modelos", render: () => <Models /> },
        { id: "conhecimento", label: "Conhecimento", render: () => <Knowledge /> },
        { id: "documentos", label: "Documentos", render: () => <IaOcr /> },
        { id: "simulador", label: "Simulador", render: () => <Simulador /> },
      ]} />
    </div>
  );
}

function Models() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-ai-model-routes"], queryFn: () => callAdminRpc<AiModelRoute[]>("admin_ai_model_routes") });
  const [saving, setSaving] = useState<string | null>(null);
  async function save(row: AiModelRoute) {
    setSaving(row.task);
    try {
      await callAdminRpc("admin_ai_model_route_update", {
        _task: row.task, _primary_model: row.primary_model, _fallback_model: row.fallback_model,
        _max_latency_ms: row.max_latency_ms, _max_steps: row.max_steps, _active: row.active,
      });
      await qc.invalidateQueries({ queryKey: ["admin-ai-model-routes"] });
      adminToast.success("Rota de IA atualizada");
    } catch (e) { adminToast.fromError(e, "Não foi possível salvar"); } finally { setSaving(null); }
  }
  if (q.isLoading) return <Loader2 className="animate-spin" />;
  return <div className="space-y-3">
    <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
      <p className="font-semibold text-foreground">Como funciona</p>
      <p>O Nino escolhe o modelo pela tarefa. Alterações valem para novas execuções e ficam registradas em auditoria.</p>
    </div>
    {(q.data ?? []).map((initial) => <ModelCard key={initial.task} initial={initial} saving={saving === initial.task} onSave={save} />)}
  </div>;
}

function ModelCard({ initial, saving, onSave }: { initial: AiModelRoute; saving: boolean; onSave: (v: AiModelRoute) => void }) {
  const [row, setRow] = useState(initial);
  return <section className="rounded-2xl border bg-card p-4 space-y-3">
    <div className="flex items-center gap-2"><BrainCircuit size={17} className="text-primary" /><h2 className="font-semibold">{friendlyTask(row.task)}</h2></div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-muted-foreground">Modelo principal<Input value={row.primary_model} onChange={e => setRow({ ...row, primary_model: e.target.value })} /></label>
      <label className="text-xs text-muted-foreground">Fallback<Input value={row.fallback_model ?? ""} onChange={e => setRow({ ...row, fallback_model: e.target.value || null })} /></label>
      <label className="text-xs text-muted-foreground">Limite de tempo (ms)<Input type="number" value={row.max_latency_ms} onChange={e => setRow({ ...row, max_latency_ms: Number(e.target.value) })} /></label>
      <label className="text-xs text-muted-foreground">Máximo de etapas<Input type="number" value={row.max_steps} onChange={e => setRow({ ...row, max_steps: Number(e.target.value) })} /></label>
    </div>
    <div className="flex justify-between items-center">
      <label className="text-sm"><input type="checkbox" checked={row.active} onChange={e => setRow({ ...row, active: e.target.checked })} /> Ativa</label>
      <Button onClick={() => onSave(row)} disabled={saving || !row.primary_model.trim()}><Save size={14} />{saving ? "Salvando..." : "Salvar"}</Button>
    </div>
  </section>;
}

function Knowledge() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-agent-knowledge"], queryFn: () => callAdminRpc<KnowledgeEntry[]>("admin_agent_knowledge_list") });
  const [draft, setDraft] = useState<Partial<KnowledgeEntry>>({ category: "produto", active: true });
  async function save() {
    if (!draft.key?.trim() || !draft.title?.trim() || !draft.content?.trim()) return;
    try {
      await callAdminRpc("admin_agent_knowledge_upsert", {
        _id: draft.id ?? null, _key: draft.key, _title: draft.title, _category: draft.category ?? "produto",
        _content: draft.content, _source_url: draft.source_url ?? null, _active: draft.active ?? true,
      });
      setDraft({ category: "produto", active: true });
      await qc.invalidateQueries({ queryKey: ["admin-agent-knowledge"] });
      adminToast.success("Conhecimento oficial salvo");
    } catch (e) { adminToast.fromError(e, "Não foi possível salvar"); }
  }
  return <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2"><BookOpen size={17} className="text-primary" /><h2 className="font-semibold">Informação oficial</h2></div>
      <Input placeholder="Chave, ex.: site_oficial" value={draft.key ?? ""} onChange={e => setDraft({ ...draft, key: e.target.value })} />
      <Input placeholder="Título" value={draft.title ?? ""} onChange={e => setDraft({ ...draft, title: e.target.value })} />
      <Input placeholder="Categoria" value={draft.category ?? ""} onChange={e => setDraft({ ...draft, category: e.target.value })} />
      <Textarea rows={6} placeholder="O que o Nino deve saber e responder" value={draft.content ?? ""} onChange={e => setDraft({ ...draft, content: e.target.value })} />
      <Input placeholder="URL de referência (opcional)" value={draft.source_url ?? ""} onChange={e => setDraft({ ...draft, source_url: e.target.value || null })} />
      <Button className="w-full" onClick={save}><Save size={14} />Salvar conhecimento</Button>
    </section>
    <section className="space-y-3">
      {(q.data ?? []).map(item => <button key={item.id} type="button" onClick={() => setDraft(item)} className="w-full rounded-2xl border bg-card p-4 text-left">
        <div className="flex justify-between gap-3"><span className="font-semibold">{item.title}</span><span className="text-xs text-muted-foreground">v{item.version}</span></div>
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{item.content}</p>
      </button>)}
    </section>
  </div>;
}

function friendlyTask(task: string) {
  return ({ fast_operation: "Respostas rápidas", semantic_classification: "Classificação e categorias", financial_analysis: "Análise financeira", complex_reasoning: "Análises e highlights", vision: "Leitura de documentos" } as Record<string, string>)[task] ?? task;
}
