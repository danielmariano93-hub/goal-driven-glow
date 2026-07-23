import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/admin": "Visão Geral",
  "/admin/usuarios": "Usuários",
  "/admin/engajamento": "Engajamento",
  "/admin/financeiro": "Financeiro",
  "/admin/agente": "Assistente",
  "/admin/agente/simulador": "Simulador do assistente",
  "/admin/mensagens": "Mensagens",
  "/admin/ia": "IA & Inteligência",
  "/admin/whatsapp": "WhatsApp",
  "/admin/operacao": "Operação",
  "/admin/produto": "Produto",
  "/admin/seguranca": "Segurança",
  "/admin/configuracoes": "Configurações",
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
