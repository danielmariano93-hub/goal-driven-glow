import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, Loader2, Check, Ban, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AssessorAttachButton, getIngestionStatus, ingestDocument, resumeIngestion, type PreparedAttachment, type IngestResult } from "./AssessorAttachButton";
import { ReviewSheet } from "./ReviewSheet";
import { SpendingReportCard, type SpendingReport } from "./SpendingReportCard";
import { useAuth } from "@/context/AuthContext";

type Pending = {
  id: string;
  kind: string;
  summary_text: string;
  payload: Record<string, unknown>;
  expires_at: string;
};

type DocDraft = IngestResult;

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; pending?: Pending | null; doc?: DocDraft | null; report?: SpendingReport | null };

const SUGGESTIONS = [
  "Como está meu mês?",
  "Ver minhas metas",
  "O que posso melhorar?",
  "Registrar um gasto",
];

export function AssessorPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const storageKey = user ? `nc:assessor:conv:${user.id}` : "nc:assessor:conv";
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<PreparedAttachment | null>(null);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(() => {
    return null;
  });
  const endRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const viewport = useVisualViewport();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Recupera a conversa persistida e os documentos recentes. O processamento ocorre
  // no servidor; fechar o painel não perde o trabalho nem o botão de revisão.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      setLoadingHistory(true);
      let savedConversation: string | null = null;
      try { savedConversation = localStorage.getItem(storageKey); } catch { /* ignore */ }
      let conversation = savedConversation;
      if (conversation) {
        const { data } = await supabase.from("conversations").select("id").eq("id", conversation).maybeSingle();
        if (!data) conversation = null;
      }
      if (!conversation) {
        const { data } = await supabase
          .from("conversations")
          .select("id")
          .eq("source", "app")
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        conversation = data?.id ?? null;
      }
      if (cancelled) return;
      setConvId(conversation);

      let history: Msg[] = [];
      if (conversation) {
        const { data } = await supabase
          .from("conversation_messages")
          .select("id, direction, body_masked, created_at")
          .eq("conversation_id", conversation)
          .order("created_at", { ascending: false })
          .limit(50);
        history = (data ?? []).reverse().map((message) => ({
          role: message.direction === "inbound" ? "user" as const : "assistant" as const,
          content: message.body_masked,
        }));
      }

      // Ao abrir o assessor, apenas recupere rascunhos úteis e jobs realmente
      // recentes. Nunca retome automaticamente documentos antigos ou falhos.
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: documents } = await supabase
        .from("document_imports")
        .select("id, status, document_kind, error, created_at, updated_at")
        .in("status", ["uploaded", "processing", "needs_review", "partial"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5);
      if (cancelled) return;
      setMessages(history);
      setLoadingHistory(false);

      for (const doc of documents ?? []) {
        try {
          let result: IngestResult;
          if (doc.status === "needs_review" || doc.status === "partial") {
            const { count } = await supabase
              .from("extracted_items")
              .select("id", { count: "exact", head: true })
              .eq("document_id", doc.id)
              .in("status", ["needs_review", "duplicate_suspect"]);
            result = { document_id: doc.id, status: doc.status, document_kind: doc.document_kind, items_count: count ?? 0 };
          } else {
            // Status somente leitura. Retomada exige ação explícita do usuário.
            result = await getIngestionStatus(doc.id);
          }
          if (cancelled) return;
          onExtracted(result);
        } catch {
          // Não transforme falha de leitura em nova tentativa automática.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey, user]);

  // O job continua no servidor mesmo com o painel fechado. Enquanto ele estiver
  // aberto, acompanhe os documentos ativos sem bloquear o campo de mensagem.
  const activeDocumentKey = [...new Set(messages.flatMap((message) =>
      message.role === "assistant" && message.doc && ["uploaded", "processing"].includes(message.doc.status)
        ? [message.doc.document_id]
        : []
    ))].sort().join(",");

  useEffect(() => {
    const activeIds = activeDocumentKey ? activeDocumentKey.split(",") : [];
    if (activeIds.length === 0) return;
    let cancelled = false;
    let polls = 0;
    const maxPolls = 24; // até 2 minutos; depois o usuário pode atualizar manualmente.
    const tick = async () => {
      if (cancelled || polls >= maxPolls) return;
      polls += 1;
      const results = await Promise.all(activeIds.map((id) => getIngestionStatus(id).catch(() => null)));
      if (cancelled) return;
      results.forEach((result) => { if (result) onExtracted(result); });
      const stillActive = results.some((result) => result && ["uploaded", "processing"].includes(result.status));
      if (!stillActive || polls >= maxPolls) window.clearInterval(timer);
    };
    const timer = window.setInterval(() => { void tick(); }, 5000);
    void tick();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeDocumentKey]);

  function onExtracted(info: DocDraft) {
    let content = "";
    if ((info.status === "needs_review" || info.status === "partial") && (info.items_count ?? 0) > 0) {
      const prefix = info.status === "partial" ? "Consegui ler parte do documento e " : "";
      content = `${prefix}Encontrei ${info.items_count} lançamento(s) nesse documento. Toque em "Revisar" para conferir antes de registrar.`;
    } else if (info.document_kind === "illegible") {
      content = "Não consegui ler bem esse documento. Se for PDF, confira se ele não tem senha; se for imagem, envie uma versão mais nítida.";
    } else if (info.document_kind === "non_financial") {
      content = "Esse arquivo não parece ser um documento financeiro. Tente um extrato, fatura, recibo ou lista de compras.";
    } else if (info.status === "failed") {
      content = info.user_message ?? "Não consegui concluir a leitura. O arquivo ficou grande demais para processar de uma vez; tente novamente por partes.";
    } else if (info.status === "processing" || info.status === "uploaded") {
      content = (info.items_count ?? 0) > 0
        ? `Já encontrei ${info.items_count} lançamento(s). Continuo lendo o restante e salvo tudo para revisão.`
        : info.status === "uploaded"
          ? "Arquivo recebido. Estou preparando a leitura…"
          : "Estou extraindo os lançamentos por partes. Pode fechar esta tela: a revisão fica salva aqui.";
    } else {
      content = "Não achei nenhum lançamento nesse documento.";
    }
    setMessages((current) => {
      const withoutSameDocument = current.filter((message) => message.role !== "assistant" || message.doc?.document_id !== info.document_id);
      return [...withoutSameDocument, { role: "assistant", content, doc: info }];
    });
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (convId) {
      try { localStorage.setItem(storageKey, convId); } catch { /* ignore */ }
    }
  }, [convId, storageKey]);

  async function callAgent(payload: Record<string, unknown>): Promise<{ reply: string; pending: Pending | null; executed: any; conversation_id: string; report?: SpendingReport | null } | null> {
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
    if ((!clean && !attachment) || sending || loadingHistory) return;
    const currentAttachment = attachment;
    const userContent = currentAttachment
      ? `${clean || "Analise estes lançamentos."}\n📎 ${currentAttachment.name}`
      : clean;
    setMessages((m) => [...m, { role: "user", content: userContent }]);
    setInput("");
    setSending(true);
    try {
      if (currentAttachment) {
        const result = await ingestDocument(currentAttachment.file, convId, clean, (progress) => {
          if (!progress.documentId) return;
          const content = progress.stage === "uploading"
            ? "Arquivo recebido. Estou preparando a leitura…"
            : "Estou analisando seu documento. Pode fechar esta tela: continuo trabalhando e deixo a revisão salva aqui.";
          onExtracted({ document_id: progress.documentId, status: progress.stage === "uploading" ? "uploaded" : "processing" });
          setMessages((current) => current.map((message) =>
            message.role === "assistant" && message.doc?.document_id === progress.documentId
              ? { ...message, content }
              : message
          ));
        });
        onExtracted(result);
        URL.revokeObjectURL(currentAttachment.url);
        setAttachment(null);
        // Upload aceito: o servidor trabalha em segundo plano e o usuário já pode
        // continuar conversando ou fechar o painel.
      } else {
        const res = await callAgent({ text: clean });
        setMessages((m) => [...m, { role: "assistant", content: res?.reply ?? "…", pending: res?.pending ?? null, report: res?.report ?? null }]);
        if (res?.executed) refetchAll();
      }
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

  async function retryDocument(documentId: string) {
    if (sending) return;
    setSending(true);
    onExtracted({ document_id: documentId, status: "processing" });
    try {
      const result = await resumeIngestion(documentId);
      onExtracted(result);
    } catch (error) {
      toast.error("Não consegui retomar a leitura", { description: (error as Error).message });
      const status = await getIngestionStatus(documentId).catch(() => null);
      if (status) onExtracted(status);
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
    <div
      className="fixed inset-x-0 z-[100] flex flex-col overflow-hidden bg-background overscroll-none md:inset-0 md:items-end md:justify-end md:bg-black/40"
      style={{ top: viewport.top, height: viewport.height }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-card md:m-4 md:h-[85vh] md:max-h-[720px] md:w-[420px] md:rounded-2xl md:shadow-brand"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-display text-base font-bold">Seu assessor</p>
            <p className="text-[11px] text-muted-foreground">Converse como no WhatsApp</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary" aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
          {!loadingHistory && messages.length === 0 && (
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
                {m.role === "assistant" && (m.doc?.status === "processing" || m.doc?.status === "uploaded") && (
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                )}
                {m.content}
              </div>
              {m.role === "assistant" && m.pending && (
                <ConfirmationCard pending={m.pending} onConfirm={() => decide(m.pending!, "confirm", i)} onCancel={() => decide(m.pending!, "cancel", i)} disabled={sending} />
              )}
              {m.role === "assistant" && m.doc && (m.doc.status === "needs_review" || m.doc.status === "partial") && (m.doc.items_count ?? 0) > 0 && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setReviewDocId(m.doc!.document_id);
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-background px-3 py-2 text-sm font-medium text-primary shadow-sm hover:bg-primary/5"
                >
                  <FileText size={14} /> Revisar {m.doc.items_count} lançamento(s)
                </button>
              )}
              {m.role === "assistant" && m.doc?.status === "failed" && (
                <button
                  onClick={() => retryDocument(m.doc!.document_id)}
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-background px-3 py-2 text-sm font-medium text-primary shadow-sm hover:bg-primary/5 disabled:opacity-50"
                >
                  <Loader2 className={sending ? "h-3.5 w-3.5 animate-spin" : "hidden"} /> Tentar por partes
                </button>
              )}
              {m.role === "assistant" && m.report && <SpendingReportCard report={m.report} />}
            </div>
          ))}
          {loadingHistory && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando sua conversa…
              </div>
            </div>
          )}
          {sending && !messages.some((message) => message.role === "assistant" && (message.doc?.status === "processing" || message.doc?.status === "uploaded")) && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Um instante…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {attachment && (
          <div className="mx-3 mb-2 flex min-w-0 shrink-0 items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-2">
            {attachment.mimeType === "application/pdf"
              ? <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileText size={22} /></div>
              : <img src={attachment.url} alt="Imagem anexada" className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{attachment.name}</p>
              <p className="text-[11px] text-muted-foreground">Adicione uma orientação e toque em enviar. Nada será salvo sem sua revisão.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(attachment.url);
                setAttachment(null);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-secondary"
              aria-label="Remover imagem"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex w-full min-w-0 shrink-0 items-center gap-2 border-t border-border bg-card p-3"
        >
          <AssessorAttachButton
            onSelected={(next) => {
              if (attachment) URL.revokeObjectURL(attachment.url);
              setAttachment(next);
            }}
            disabled={sending || loadingHistory}
          />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escreva uma mensagem ou anexe um documento…"
            className="input-base min-w-0 flex-1 text-base"
            disabled={sending || loadingHistory}
            onFocus={() => window.setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 120)}
          />
          <button
            type="submit"
            disabled={sending || loadingHistory || (!input.trim() && !attachment)}
            className="btn-brand inline-flex h-10 w-10 shrink-0 items-center justify-center p-0 disabled:opacity-50"
            aria-label="Enviar"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
      {reviewDocId && <ReviewSheet documentId={reviewDocId} onClose={() => setReviewDocId(null)} />}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}

function useVisualViewport() {
  const initial = () => ({
    height: typeof window === "undefined" ? "100dvh" : `${window.visualViewport?.height ?? window.innerHeight}px`,
    top: typeof window === "undefined" ? "0px" : `${window.visualViewport?.offsetTop ?? 0}px`,
  });
  const [viewport, setViewport] = useState(initial);
  useEffect(() => {
    const visual = window.visualViewport;
    const update = () => setViewport({
      height: `${visual?.height ?? window.innerHeight}px`,
      top: `${visual?.offsetTop ?? 0}px`,
    });
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return viewport;
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
