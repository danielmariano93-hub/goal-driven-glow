import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AssessorPanel } from "@/components/assessor/AssessorPanel";

/**
 * Página dedicada ao Assessor. Serve como destino canônico de deep-links
 * (ex.: `/app/assessor?source=whatsapp_media`) para que qualquer canal —
 * WhatsApp, notificação, e-mail — abra diretamente o assistente sem
 * depender do FAB. O AppLayout já monta o `AssessorFab` globalmente; aqui
 * apenas garantimos que o painel abra e que o retorno vá para a home do app.
 */
export default function AssessorPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const source = params.get("source");

  useEffect(() => {
    if (source) {
      try { sessionStorage.setItem("nc:assessor:source", source); } catch { /* ignore */ }
    }
  }, [source]);

  return <AssessorPanel onClose={() => nav("/app", { replace: true })} />;
}
