import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  CheckCircle2,
  Download,
  Loader2,
  MessageSquareText,
  Pencil,
  Save,
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
import type {
  MemoryItem,
  ProactivePreferences,
} from "@/lib/nino/contracts";

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

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const VALUE_LABELS: Record<string, string> = {
  amount: "Valor",
  value: "Valor",
  category: "Categoria",
  category_name: "Categoria",
  merchant: "Estabelecimento",
  description: "Descrição",
  frequency: "Frequência",
  day: "Dia",
  weekday: "Dia da semana",
  goal: "Meta",
  note: "Observação",
};

function humanizeValueEntry(key: string, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "object") return null;
  const label = VALUE_LABELS[key] ?? key.replace(/_/g, " ");
  if (typeof raw === "number" && /amount|valor|value|total/i.test(key)) {
    return `${label}: ${BRL.format(raw)}`;
  }
  if (typeof raw === "boolean") return `${label}: ${raw ? "sim" : "não"}`;
  return `${label}: ${String(raw)}`;
}

/** Converte o payload da memória em texto legível — nunca mostramos JSON cru. */
export function humanizeMemoryValue(value: unknown): string {
  if (value === null || value === undefined) return "Sem detalhes registrados.";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === "object" ? null : String(v))).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "Sem detalhes registrados.";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => humanizeValueEntry(k, v))
    .filter((item): item is string => Boolean(item));
  return entries.length > 0 ? entries.join(" · ") : "Sem detalhes registrados.";
}

function confidenceLabel(value: number): string {
  if (value >= 0.85) return "confiança alta";
  if (value >= 0.65) return "confiança média";
  return "confiança baixa";
}

function memoryLabel(memory: MemoryItem): string {
  return memory.key.replace(/[_:]+/g, " ").replace(/\s+/g, " ").trim();
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

export default function NinoContexto() {
  const queryClient = useQueryClient();
  const contextQuery = useQuery({
    queryKey: ["nino-context"],
    queryFn: loadNinoContext,
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [draft, setDraft] = useState("");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["nino-context"] });
  };

  const memoryMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(draft) as Record<string, unknown>;
      } catch {
        throw new Error("O conteúdo precisa ser um JSON válido.");
      }
      await updateNinoMemory({ id: editing.id, value, expiresAt: editing.expires_at });
    },
    onSuccess: async () => {
      toast.success("Memória corrigida");
      setEditing(null);
      setDraft("");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hypotheses = useMemo(
    () => (contextQuery.data?.hypotheses ?? []).filter((item) => item.status !== "expired"),
    [contextQuery.data],
  );

  const setPreference = async (
    patch: Partial<ProactivePreferences>,
  ) => {
    if (!contextQuery.data) return;
    try {
      await updateProactivePreferences(contextQuery.data.preferences, patch);
      toast.success("Preferências atualizadas");
      await refresh();
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
            Revise memórias, confirme hipóteses e escolha como o Nino pode falar com você.
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
            <p className="text-xs text-muted-foreground">
              Correções feitas aqui passam a ter prioridade sobre inferências automáticas.
            </p>
          </div>
        </div>

        {context.memory.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            O Nino ainda não guardou nenhuma memória sobre você.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {context.memory.map((memory) => (
              <article key={memory.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{memoryLabel(memory)}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {humanizeMemoryValue(memory.value)}
                    </p>
                    <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {memory.source === "correction" ? "Confirmado por você" : "Inferido pelo Nino"}
                      {" · "}
                      {confidenceLabel(Number(memory.confidence))}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label="Editar memória"
                      onClick={() => {
                        setEditing(memory);
                        setDraft(JSON.stringify(memory.value, null, 2));
                      }}
                      className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Apagar memória"
                      onClick={async () => {
                        if (!window.confirm("Apagar esta memória do Nino?")) return;
                        try {
                          await deleteNinoMemory(memory.id);
                          toast.success("Memória apagada");
                          await refresh();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Não foi possível apagar");
                        }
                      }}
                      className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Hipóteses comportamentais</h2>
            <p className="text-xs text-muted-foreground">
              São sinais baseados nos seus registros, nunca diagnósticos. Você decide o que faz sentido.
            </p>
          </div>
        </div>

        {hypotheses.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            Ainda não há dados suficientes para gerar hipóteses confiáveis.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {hypotheses.map((hypothesis) => (
              <article key={hypothesis.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{hypothesis.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {hypothesis.explanation}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10px]">
                    {Math.round(Number(hypothesis.confidence) * 100)}%
                  </span>
                </div>

                {hypothesis.status === "pending" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ["confirmed", "Sim, faz sentido"],
                      ["partial", "Em parte"],
                      ["rejected", "Não faz sentido"],
                    ].map(([verdict, label]) => (
                      <button
                        key={verdict}
                        type="button"
                        onClick={async () => {
                          try {
                            await sendHypothesisFeedback({
                              id: hypothesis.id,
                              verdict: verdict as "confirmed" | "partial" | "rejected",
                            });
                            toast.success("Resposta registrada");
                            await refresh();
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
                ) : (
                  <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <CheckCircle2 size={13} />
                    {hypothesis.status === "confirmed"
                      ? "Confirmado por você"
                      : hypothesis.status === "partial"
                        ? "Parcialmente confirmado"
                        : "Descartado por você"}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Comunicação proativa</h2>
            <p className="text-xs text-muted-foreground">Limites e assuntos que podem gerar alertas.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="rounded-xl border border-border bg-background p-3 text-xs">
            <span className="font-medium">Limite diário</span>
            <select
              value={preferences.max_proactive_per_day}
              onChange={(event) => setPreference({
                max_proactive_per_day: Number(event.target.value),
              })}
              className="input-base mt-2"
            >
              <option value={0}>Não enviar automaticamente</option>
              <option value={1}>Até 1 comunicação por dia</option>
              <option value={2}>Até 2 comunicações por dia</option>
              <option value={3}>Até 3 comunicações por dia</option>
            </select>
          </label>
          <Toggle
            label="Permitir WhatsApp proativo"
            checked={preferences.whatsapp_proactive}
            onChange={(checked) => setPreference({ whatsapp_proactive: checked })}
          />
          <Toggle
            label="Alertas financeiros"
            checked={preferences.proactive_financial}
            onChange={(checked) => setPreference({ proactive_financial: checked })}
          />
          <Toggle
            label="Inteligência emocional"
            checked={preferences.emotional_checkin}
            onChange={(checked) => setPreference({ emotional_checkin: checked })}
          />
        </div>

        <p className="mt-5 text-xs font-semibold">Assuntos silenciados</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {Object.entries(KIND_LABELS).map(([kind, label]) => {
            const muted = preferences.muted_proactive_kinds.includes(kind);
            return (
              <label key={kind} className="flex items-center justify-between rounded-xl border border-border bg-background p-3 text-xs">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={muted}
                  onChange={() => {
                    const next = muted
                      ? preferences.muted_proactive_kinds.filter((item) => item !== kind)
                      : [...preferences.muted_proactive_kinds, kind];
                    setPreference({ muted_proactive_kinds: next });
                  }}
                />
              </label>
            );
          })}
        </div>
      </section>

      {context.recent_deliveries.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
          <h2 className="text-sm font-semibold">Os alertas foram úteis?</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Este retorno ajuda a reduzir mensagens repetitivas ou pouco relevantes.
          </p>
          <div className="mt-3 space-y-2">
            {context.recent_deliveries.slice(0, 8).map((delivery) => (
              <article key={delivery.id} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{KIND_LABELS[delivery.kind] ?? delivery.kind}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {delivery.channel === "whatsapp" ? "WhatsApp" : "Aplicativo"}
                    {" · "}
                    {new Date(delivery.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                {delivery.user_feedback ? (
                  <span className="text-xs text-muted-foreground">
                    {delivery.user_feedback === "useful" ? "Marcado como útil" : "Feedback registrado"}
                  </span>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await sendCommunicationFeedback(delivery.id, "useful");
                        toast.success("Obrigado pelo retorno");
                        await refresh();
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs"
                    >
                      Útil
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await sendCommunicationFeedback(delivery.id, "not_useful");
                        toast.success("Vamos ajustar os próximos alertas");
                        await refresh();
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs"
                    >
                      Não foi útil
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-0 sm:place-items-center sm:p-4">
          <div className="w-full rounded-t-3xl bg-background p-5 shadow-xl sm:max-w-lg sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Corrigir memória</h2>
                <p className="text-xs text-muted-foreground">{memoryLabel(editing)}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="rounded-full p-2">
                <X size={18} />
              </button>
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="input-base mt-4 min-h-48 font-mono text-xs"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Edite apenas o conteúdo entre chaves. A correção ficará marcada como confirmada por você.
            </p>
            <button
              type="button"
              disabled={memoryMutation.isPending}
              onClick={() => memoryMutation.mutate()}
              className="btn-brand mt-4 inline-flex w-full items-center justify-center gap-2"
            >
              {memoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={15} />}
              Salvar correção
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-border bg-background p-3 text-xs">
      <span className="font-medium">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
