import { useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, List, Target, MoreHorizontal } from "lucide-react";

const tabs = [
  { path: "/app", label: "Início", icon: LayoutDashboard },
  { path: "/app/lancamentos", label: "Movimentos", icon: List },
  { path: "/app/metas", label: "Metas", icon: Target },
  { path: "/app/mais", label: "Mais", icon: MoreHorizontal },
];

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === "/app/mais") {
      return [
        "/app/mais",
        "/app/planejamento",
        "/app/dividas",
        "/app/emocoes",
        "/app/relatorios",
        "/app/perfil",
        "/app/contas",
        "/app/cartoes",
        "/app/categorias",
        "/app/investimentos",
        "/app/recorrencias",
        "/app/desafios",
        "/app/divisao-do-role",
        "/app/cobrancas",
        "/app/importar",
      ].some((p) => location.pathname === p || location.pathname.startsWith(p + "/"));
    }
    if (path === "/app") return location.pathname === "/app";
    return location.pathname === path;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl md:hidden"
      style={{
        background: "rgba(255,255,255,0.92)",
        borderTop: "1px solid var(--home-hairline)",
      }}
    >
      <div className="flex items-center justify-around h-[56px] max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const Icon = tab.icon;
          const color = active ? "var(--home-brand-violet)" : "#827C8B";
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors"
              aria-current={active ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.6} style={{ color }} />
              <span className="text-[10px] font-medium leading-tight" style={{ color }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
