import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/admin": "Cockpit",
  "/admin/cockpit": "Cockpit",
  "/admin/clientes": "Clientes",
  "/admin/crescimento": "Crescimento",
  "/admin/operacao/saude": "Saúde",
  "/admin/operacao/whatsapp": "WhatsApp",
  "/admin/operacao/assistente": "Assessor",
  "/admin/operacao/comunicacao-proativa": "Comunicação",
  "/admin/governanca/seguranca": "Segurança",
  "/admin/governanca/auditoria": "Auditoria",
};


export function currentAdminTitle(pathname: string): string {
  return TITLES[pathname] ?? "Admin";
}

export function useAdminDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = currentAdminTitle(pathname);
    document.title = `Admin · ${t} · MeuNino`;
  }, [pathname]);
}
