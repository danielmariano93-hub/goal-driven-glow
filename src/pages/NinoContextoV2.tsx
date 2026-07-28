import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Pencil,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteNinoMemory,
  loadNinoContext,
  sendCommunicationFeedback,
  sendHypothesisFeedback,
  updateNinoMemory,
  updateProactivePreferences,
} from "@/lib/nino/client";
import type { MemoryItem, ProactivePreferences } from "@/lib/nino/contracts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const KIND_LABELS: Record<string, string> = {
  spending_spike: "Gasto atípico",
  forgotten_bill: "Conta próxima ou vencida",
  goal_at_risk: "Meta em risco",
  engagement_drop: "Queda de engajamento",
  recurring_pattern: "Padrão recorrente",
  emotional_spending: "Emoção e gastos",
  impulsive_spending: "Gastos concentrados",
  financial_procrastination: "Compromissos adiados",
  financial_discipline: "Disciplina financeira",
  relapse_risk: "Mudança recente de hábito",
};

function memoryGroup(memory: MemoryItem): string {
  if (memory.kind === "frequent_merchant") return "Estabelecimentos";
  if (memory.kind === "favorite_category") return "Categorias e interesses";
  if (/preference|channel|tone|notification/i.test(memory.kind)) return "Preferências";
  if (/goal|objective/i.test(memory.kind)) return "Objetivos";
  return "Outras informações";
}

function memoryTitle(memory: MemoryItem): string {
  const friendly = String(memory.value?.friendly_name ?? "").trim();
  if (friendly) return friendly;
  return memory.key.replace(/[_:]+/g, " ").replace(/\s+/g, " ").trim();
}

function humanMemory(memory: MemoryItem): string {
  const value = memory.value ?? {};
  if (memory.kind === "frequent_merchant") {
    const category = typeof value.category === "string" && value.category.trim()
      ? value.category
      : "categoria ainda não confirmada";
    const amount = Number(value.last_amount ?? value.amount ?? 0);
    const amountText = amount > 0 ? ` Último valor observado: ${BRL.format(amount)}.` : "";
    return `O Nino reconhece este estabelecimento como ${category}.${amountText}`;
  }
  if (memory.kind === "favorite_category") {
    const count = Number(value.count ?? 0);
    return count > 0
      ? `Essa categoria apareceu ${count} vez(es) nos sinais recentes. Ainda é uma observação, não uma preferência definitiva.`
      : "Categoria percebida nos seus registros.";
  }
  const note = String(value.note ?? value.description ?? value.value ?? "").trim();
  return note || "Informação usada apenas quando ajuda a personalizar uma resposta.";
}

function confidenceLabel(value: number): string {
  if (value >= 0.85) return "confiança alta";
  if (value >= 0.65) return "confiança média";
  return "confiança baixa";
}

function downloadContext(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `meu-nino-contexto-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function NinoContextoV2() {
  const queryClient = useQueryClient();
  const contextQuery = useQuery({
    queryKey: ["nino-context"],
    queryFn: loadNinoContext,
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState<MemoryItem | null>(null);

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["nino-context"] });

  const memoryMutation = useMutation({
    mutationFn: async (args: { memory: MemoryItem; friendlyName: string; category: string; note: string }) => {
      const next: Record<string, unknown> = { ...args.memory.value };
      if (args.friendlyName.trim()) next.friendly_name = args.friendlyName.trim();
      else delete next.friendly_name;
      if (args.category.trim()) next.category = args.category.trim();
      else if ("category" in next) next.category = null;
      if (args.note.trim()) next.note = args.note.trim();
      else delete next.note;
      await updateNinoMemory({ id: args.memory.id, value: next, expiresAt: args.memory.expires_at });
    },
    onSuccess: async () => {
      setEditing(null);
      await refresh();
      toast.success("Memória corrigida.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hypotheses = useMemo(
    () => (contextQuery.data?.hypotheses ?? []).filter((item) => item.status !== "expired"),
    [contextQuery.data],
  );
  const visibleMemory = useMemo(
    () => (contextQuery.data?.memory ?? []).filter((memory) => !/^(weekly|monthly):/.test(memory.key) && memory.kind !== "advisor_review"),
    [contextQuery.data],
  );
  const important = visibleMemory.filter((memory) => Number(memory.confidence) >= 0.6);
  const lowRelevance = visibleMemory.filter((memory) => Number(memory.confidence) < 0.6);
  const grouped = useMemo(() => {
    const map = new Map<string, MemoryItem[]>();
    for (const memory of important) {
      const group = memoryGroup(memory);
      map.set(group, [...(map.get(group) ?? []), memory]);
    }
    return [...map.entries()];
  }, [important]);

  const setPreference = async (patch: Partial<ProactivePreferences>) => {
    if (!contextQuery.data) return;
    try {
      await updateProactivePreferences(contextQuery.data.preferences, patch);
      await refresh();
      toast.success("Preferências atualizadas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar");
    }
  };

  if (contextQuery.isLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (contextQuery.isError || !contextQuery.data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-card p-6 text-sm">
        <p className="font-semibold">Não foi possível carregar o contexto do Nino.</p>
        <p className="mt-1 text-muted-foreground">{(contextQuery.error as Error)?.message}</p>
      </div>
    );
  }

  const context = contextQuery.data;
  const preferences = context.preferences;

  return (
    <div className="space-y-6 pb-10">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">O que o Nino sabe sobre mim</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informações em linguagem humana, com origem, confiança e controle. Nenhum JSON precisa ser editado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadContext(context)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium"
        >
          <Download size={14} /> Exportar
        </button>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Memórias utilizadas pelo Nino</h2>
            <p className="text-xs text-muted-foreground">Memórias técnicas e revisões internas não aparecem aqui.</p>
          </div>
        </div>

        {grouped.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            O Nino ainda não guardou nenhuma memória útil sobre você.
          </p>
        ) : (
          <div className="mt-5 space-y-6">
            {grouped.map(([group, memories]) => (
              <div key={group}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                <div className="mt-2 space-y-2">
                  {memories.map((memory) => (
                    <MemoryCard
                      key={memory.id}
                      memory={memory}
                      onEdit={() => setEditing(memory)}
                      onDelete={async () => {
                        if (!window.confirm("Remover esta informação da memória do Nino?")) return;
                        try {
                          await deleteNinoMemory(memory.id);
                          await refresh();
                          toast.success("Memória removida.");
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Não foi possível remover");
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {lowRelevance.length > 0 && (
          <details className="mt-5 rounded-xl border border-border bg-background p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold">
              Menos relevantes ({lowRelevance.length}) <ChevronDown size={14} />
            </summary>
            <p className="mt-1 text-[11px] text-muted-foreground">Sinais fracos ou baseados em poucas ocorrências.</p>
            <div className="mt-3 space-y-2">
              {lowRelevance.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} onEdit={() => setEditing(memory)} onDelete={async () => {
                  await deleteNinoMemory(memory.id);
                  await refresh();
                }} />
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Hipóteses comportamentais</h2>
            <p className="text-xs text-muted-foreground">São perguntas baseadas em sinais, nunca diagnósticos.</p>
          </div>
        </div>

        {hypotheses.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            Ainda não há hipóteses que precisem da sua confirmação.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {hypotheses.map((hypothesis) => (
              <article key={hypothesis.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{hypothesis.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hypothesis.explanation}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10px]">
                    {Math.round(Number(hypothesis.confidence) * 100)}% de confiança
                  </span>
                </div>
                {hypothesis.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {([
                      ["confirmed", "Sim, faz sentido"],
                      ["partial", "Em parte"],
                      ["rejected", "Não faz sentido"],
                    ] as const).map(([verdict, label]) => (
                      <button
                        key={verdict}
                        type="button"
                        onClick={async () => {
                          try {
                            await sendHypothesisFeedback({ id: hypothesis.id, verdict });
                            await refresh();
                            toast.success("Obrigado. O Nino vai considerar sua resposta.");
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Não foi possível registrar");
                          }
                        }}
                        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <h2 className="text-sm font-semibold">Como o Nino pode falar com você</h2>
        <div className="mt-4 space-y-3">
          <PreferenceRow
            label="Alertas financeiros proativos"
            description="Contas, metas em risco e lançamentos que precisam da sua atenção."
            checked={preferences.proactive_financial}
            onChange={(checked) => setPreference({ proactive_financial: checked })}
          />
          <PreferenceRow
            label="Dicas inteligentes"
            description="Sugestões no app, respeitando variedade e feedback de utilidade."
            checked={preferences.smart_tips}
            onChange={(checked) => setPreference({ smart_tips: checked })}
          />
          <PreferenceRow
            label="WhatsApp proativo"
            description="Só pode ser usado quando o canal estiver liberado no Admin e você autorizar aqui."
            checked={preferences.whatsapp_proactive}
            onChange={(checked) => setPreference({ whatsapp_proactive: checked })}
          />
        </div>
      </section>

      {(context.recent_deliveries ?? []).length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
          <h2 className="text-sm font-semibold">Comunicações recentes</h2>
          <div className="mt-3 space-y-2">
            {context.recent_deliveries.slice(0, 8).map((delivery) => (
              <article key={delivery.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{KIND_LABELS[delivery.kind] ?? delivery.kind}</p>
                  <span className="text-[10px] text-muted-foreground">{delivery.channel}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => { await sendCommunicationFeedback(delivery.id, "useful"); await refresh(); }}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px]"
                  >
                    Foi útil
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await sendCommunicationFeedback(delivery.id, "not_useful"); await refresh(); }}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px]"
                  >
                    Não foi útil
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <MemoryEditor
          memory={editing}
          saving={memoryMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(payload) => memoryMutation.mutate({ memory: editing, ...payload })}
        />
      )}
    </div>
  );
}

function MemoryCard({ memory, onEdit, onDelete }: { memory: MemoryItem; onEdit: () => void; onDelete: () => void | Promise<void> }) {
  return (
    <article className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium capitalize">{memoryTitle(memory)}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{humanMemory(memory)}</p>
          <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            {memory.source === "correction" ? "Confirmado por você" : "Inferido pelos seus registros"}
            {" · "}{confidenceLabel(Number(memory.confidence))}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onEdit} aria-label="Editar memória" className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => void onDelete()} aria-label="Remover memória" className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function MemoryEditor({
  memory,
  saving,
  onClose,
  onSave,
}: {
  memory: MemoryItem;
  saving: boolean;
  onClose: () => void;
  onSave: (value: { friendlyName: string; category: string; note: string }) => void;
}) {
  const [friendlyName, setFriendlyName] = useState(String(memory.value?.friendly_name ?? memoryTitle(memory)));
  const [category, setCategory] = useState(String(memory.value?.category ?? ""));
  const [note, setNote] = useState(String(memory.value?.note ?? ""));
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-card" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold">Corrigir memória</h3>
            <p className="mt-1 text-xs text-muted-foreground">Edite somente campos compreensíveis. A estrutura técnica continua protegida.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-border p-2"><X size={14} /></button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium">
            Nome amigável
            <input value={friendlyName} onChange={(event) => setFriendlyName(event.target.value)} className="input-base mt-1" />
          </label>
          {memory.kind === "frequent_merchant" && (
            <label className="block text-xs font-medium">
              Categoria reconhecida
              <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex.: Transporte" className="input-base mt-1" />
            </label>
          )}
          <label className="block text-xs font-medium">
            Observação opcional
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="input-base mt-1 resize-none" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-xs">Cancelar</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave({ friendlyName, category, note })}
            className="btn-brand inline-flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Salvar correção
          </button>
        </div>
      </div>
    </div>
  );
}

function PreferenceRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-3">
      <span>
        <span className="block text-xs font-semibold">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" />
    </label>
  );
}
