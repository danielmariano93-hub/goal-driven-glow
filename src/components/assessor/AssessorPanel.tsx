import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, Loader2, Check, Ban, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AssessorAttachButton } from "./AssessorAttachButton";
import { ReviewSheet } from "./ReviewSheet";

type Pending = {
  id: string;
  kind: string;
  summary_text: string;
  payload: Record<string, unknown>;
  expires_at: string;
};

type DocDraft = {
  document_id: string;
  status: string;
  items_count?: number;
  document_kind?: string;
  error?: string | null;
};

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; pending?: Pending | null; doc?: DocDraft | null };

const SUGGESTIONS = [
  "Como está meu mês?",
  "Ver minhas metas",
  "O que posso melhorar?",
  "Registrar um gasto",
];

const STORAGE_KEY = "nc:assessor:conv";

export function AssessorPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const endRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (convId) {
      try { localStorage.setItem(STORAGE_KEY, convId); } catch { /* ignore */ }
    }
  }, [convId]);

  async function callAgent(payload: Record<string, unknown>): Promise<{ reply: string; pending: Pending | null; executed: any; conversation_id: string } | null> {
    const { data, error } = await supabase.functions.invoke("agent-chat", {
      body: { conversation_id: convId, ...payload },
    });
    if (error) throw error;
    const d = data as any;
    if (d?.error) throw new Error(d.error);
    if (d?.conversation_id && d.conversation_id !== convId) setConvId(d.conversation_id);
    return d;
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setMessages((m) => [...m, { role: "user", content: clean }]);
    setInput("");
    setSending(true);
    try {
      const res = await callAgent({ text: clean });
      setMessages((m) => [...m, { role: "assistant", content: res?.reply ?? "…", pending: res?.pending ?? null }]);
      if (res?.executed) refetchAll();
    } catch (e) {
      const msg = (e as Error).message || "Falha ao consultar seu assessor";
      toast.error("Erro no assessor", { description: msg });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Tive uma dificuldade agora. Tente novamente em instantes." },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function decide(pending: Pending, action: "confirm" | "cancel", idx: number) {
    if (sending) return;
    setSending(true);
    try {
      const res = await callAgent({ action, pending_id: pending.id });
      // Clear pending on the originating message
      setMessages((m) => m.map((msg, i) => (i === idx && msg.role === "assistant" ? { ...msg, pending: null } : msg)));
      setMessages((m) => [...m, { role: "assistant", content: res?.reply ?? "…" }]);
      if (res?.executed) refetchAll();
    } catch (e) {
      toast.error("Não consegui concluir", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["home"] });
    qc.invalidateQueries({ queryKey: ["credit_cards"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["goals"] });
  }

  const panel = (
    <div className="fixed inset-0 z-50 flex flex-col bg-background md:items-end md:justify-end md:bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-card md:h-[85vh] md:max-h-[720px] md:w-[420px] md:m-4 md:rounded-2xl md:shadow-brand"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-display text-base font-bold">Seu assessor</p>
            <p className="text-[11px] text-muted-foreground">Converse como no WhatsApp</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary" aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Oi! Eu conheço suas contas, cartões e metas. Posso registrar gastos, analisar seu mês e sugerir ajustes.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-secondary px-3 py-1.5 text-xs hover:border-primary/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-2"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "max-w-[85%] rounded-2xl border border-border bg-secondary px-3 py-2 text-sm whitespace-pre-line"
                }
              >
                {m.content}
              </div>
              {m.role === "assistant" && m.pending && (
                <ConfirmationCard pending={m.pending} onConfirm={() => decide(m.pending!, "confirm", i)} onCancel={() => decide(m.pending!, "cancel", i)} disabled={sending} />
              )}
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Um instante…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escreva uma mensagem…"
            className="input-base flex-1"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="btn-brand inline-flex items-center gap-1.5 disabled:opacity-50"
            aria-label="Enviar"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}

function ConfirmationCard({
  pending,
  onConfirm,
  onCancel,
  disabled,
}: {
  pending: Pending;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <div className="w-[85%] max-w-[85%] rounded-2xl border border-primary/30 bg-background p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Confirmar antes de registrar</p>
      <p className="text-sm text-foreground">{pending.summary_text}</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="btn-brand inline-flex flex-1 items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Check size={14} /> Confirmar
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2 text-sm hover:bg-secondary/70 disabled:opacity-50"
        >
          <Ban size={14} /> Cancelar
        </button>
      </div>
    </div>
  );
}
