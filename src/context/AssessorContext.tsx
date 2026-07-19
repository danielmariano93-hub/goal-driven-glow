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
  openAssessor: (source?: AssessorSource) => void;
  closeAssessor: () => void;
};

const AssessorCtx = createContext<Ctx | null>(null);

export function AssessorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<AssessorSource>(null);

  const openAssessor = useCallback((src?: AssessorSource) => {
    setSource(src ?? "fab");
    setIsOpen(true);
  }, []);

  const closeAssessor = useCallback(() => {
    setIsOpen(false);
    setSource(null);
  }, []);

  const value = useMemo(() => ({ isOpen, source, openAssessor, closeAssessor }), [isOpen, source, openAssessor, closeAssessor]);

  return <AssessorCtx.Provider value={value}>{children}</AssessorCtx.Provider>;
}

export function useAssessor(): Ctx {
  const ctx = useContext(AssessorCtx);
  if (!ctx) throw new Error("useAssessor deve ser usado dentro de AssessorProvider");
  return ctx;
}
