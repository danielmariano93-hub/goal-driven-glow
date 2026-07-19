import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAssessor } from "@/context/AssessorContext";

/**
 * Rota `/app/assessor`: alvo canônico dos deep-links vindos do WhatsApp
 * (fallback de mídia) e de notificações.
 *
 * NÃO renderiza um segundo `AssessorPanel` — apenas dispara `openAssessor`
 * no contexto global. Quando o usuário fechar o painel, o `AppLayout`
 * navega com `replace` para `/app`, mantendo o histórico limpo.
 */
export default function AssessorPage() {
  const { openAssessor, isOpen } = useAssessor();
  const [params] = useSearchParams();
  const source = params.get("source") === "whatsapp_media" ? "whatsapp_media" : "deep_link";
  const nav = useNavigate();
  const location = useLocation();

  useEffect(() => {
    openAssessor(source);
    // Executa apenas na montagem — abrir/fechar posteriores partem do próprio
    // painel via `closeAssessor`. `source` não muda entre renders da mesma URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se o painel for fechado enquanto o usuário está nesta rota, saímos com
  // `replace` para `/app` — a rota deep-link não deve empilhar histórico.
  useEffect(() => {
    if (!isOpen && location.pathname === "/app/assessor") {
      nav("/app", { replace: true });
    }
  }, [isOpen, location.pathname, nav]);

  return null;
}
