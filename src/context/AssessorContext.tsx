import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Contexto global do Assessor.
 *
 * Motivação: antes tínhamos DUAS instâncias de `AssessorPanel` — uma pelo
 * `AssessorFab` (aberto pelo botão flutuante) e outra pela rota
 * `/app/assessor` (usada como deep-link vindo do WhatsApp/notificações).
 * Isso duplicava mensagens, quebrava o histórico entre um e outro e
 * confundia o usuário. Aqui centralizamos: o painel é montado uma única
 * vez em `AppLayout` e QUALQUER caller — FAB, rota, notificação — abre
 * essa mesma instância chamando `openAssessor()`.
 */

export type AssessorSource = "fab" | "deep_link" | "whatsapp_media" | "notification" | null;

type Ctx = {
  isOpen: boolean;
  source: AssessorSource;
  /** Pergunta pronta para a pessoa revisar e enviar (ex.: ação de um insight). */
  draft: string | null;
  openAssessor: (source?: AssessorSource, options?: { draft?: string }) => void;
  closeAssessor: () => void;
  clearDraft: () => void;
};

const AssessorCtx = createContext<Ctx | null>(null);

export function AssessorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<AssessorSource>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const openAssessor = useCallback((src?: AssessorSource, options?: { draft?: string }) => {
    setSource(src ?? "fab");
    setDraft(options?.draft?.trim() || null);
    setIsOpen(true);
  }, []);

  const clearDraft = useCallback(() => setDraft(null), []);

  const closeAssessor = useCallback(() => {
    setIsOpen(false);
    setSource(null);
  }, []);

  const value = useMemo(
    () => ({ isOpen, source, draft, openAssessor, closeAssessor, clearDraft }),
    [isOpen, source, draft, openAssessor, closeAssessor, clearDraft],
  );

  return <AssessorCtx.Provider value={value}>{children}</AssessorCtx.Provider>;
}

/** Para componentes que também são renderizados fora do provider (testes, telas isoladas). */
export function useOptionalAssessor(): Ctx | null {
  return useContext(AssessorCtx);
}

export function useAssessor(): Ctx {
  const ctx = useContext(AssessorCtx);
  if (!ctx) throw new Error("useAssessor deve ser usado dentro de AssessorProvider");
  return ctx;
}
