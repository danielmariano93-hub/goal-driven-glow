import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/admin": "Visão geral",
  "/admin/visao-geral": "Visão geral",
  "/admin/clientes": "Clientes",
  "/admin/produto": "Produto",
  "/admin/operacoes": "Operações",
  "/admin/comunicacoes": "Comunicações",
  "/admin/administracao": "Administração",
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
