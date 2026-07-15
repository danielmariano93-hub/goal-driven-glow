import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, List, Calculator, Target, MoreHorizontal } from 'lucide-react';

const tabs = [
  { path: '/app', label: 'Início', icon: LayoutDashboard },
  { path: '/app/lancamentos', label: 'Lançamentos', icon: List },
  { path: '/app/planejamento', label: 'Simulador', icon: Calculator },
  { path: '/app/metas', label: 'Metas', icon: Target },
  { path: '/app/mais', label: 'Mais', icon: MoreHorizontal },
];

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/app/mais') {
      return ['/app/mais', '/app/dividas', '/app/emocoes', '/app/relatorios', '/app/perfil'].includes(location.pathname);
    }
    if (path === '/app') {
      return location.pathname === '/app';
    }
    return location.pathname === path;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/85 backdrop-blur-xl border-t border-border md:hidden">
      <div className="flex items-center justify-around h-[56px] max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors"
              aria-current={active ? 'page' : undefined}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.3 : 1.6}
                className={active ? 'text-accent' : 'text-muted-foreground'}
              />
              <span className={`text-[10px] font-medium ${active ? 'text-accent' : 'text-muted-foreground'}`}>
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
