import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAssessor } from "@/context/AssessorContext";

/**
 * Rota `/app/assessor`: alvo canônico dos deep-links vindos do WhatsApp
 * (fallback de mídia) e de notificações.
 *
 * NÃO renderiza um segundo `AssessorPanel` — apenas dispara `openAssessor`
 * no contexto global. Quando o usuário fechar o painel, navegamos com
 * `replace` para `/app`, mantendo o histórico limpo. Guardamos um ref
 * `hasOpenedRef` para evitar a navegação disparar antes de o painel
 * abrir de fato (a primeira execução do effect roda com isOpen=false).
 */
export default function AssessorPage() {
  const { openAssessor, isOpen } = useAssessor();
  const [params] = useSearchParams();
  const source = params.get("source") === "whatsapp_media" ? "whatsapp_media" : "deep_link";
  const nav = useNavigate();
  const location = useLocation();
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    openAssessor(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOpen) {
      hasOpenedRef.current = true;
      return;
    }
    if (hasOpenedRef.current && location.pathname === "/app/assessor") {
      nav("/app", { replace: true });
    }
  }, [isOpen, location.pathname, nav]);

  return null;
}
