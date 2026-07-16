import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Como está meu mês?",
  "Ver minhas metas",
  "O que posso melhorar?",
  "Analisar a fatura do cartão",
  "Registrar um gasto",
];

export function AssessorPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setMessages((m) => [...m, { role: "user", content: clean }]);
    setInput("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { text: clean, conversation_id: convId },
      });
      if (error) throw error;
      const payload = data as { reply?: string; conversation_id?: string; error?: string };
      if (payload?.error) throw new Error(payload.error);
      if (payload?.conversation_id && !convId) setConvId(payload.conversation_id);
      setMessages((m) => [...m, { role: "assistant", content: payload?.reply ?? "…" }]);
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
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "max-w-[85%] rounded-2xl border border-border bg-secondary px-3 py-2 text-sm"
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Estou olhando suas finanças…
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
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}
