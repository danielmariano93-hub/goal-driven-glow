import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, List, Calculator, Target, MoreHorizontal } from 'lucide-react';

const tabs = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/lancamentos', label: 'Lançamentos', icon: List },
  { path: '/planejamento', label: 'Planejamento', icon: Calculator },
  { path: '/metas', label: 'Metas', icon: Target },
  { path: '/mais', label: 'Mais', icon: MoreHorizontal },
];

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/mais') {
      return ['/mais', '/dividas', '/emocoes', '/relatorios', '/perfil'].includes(location.pathname);
    }
    return location.pathname === path;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/80 backdrop-blur-xl border-t border-border">
      <div className="flex items-center justify-around h-[52px] max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors"
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.2 : 1.5}
                className={active ? 'text-foreground' : 'text-muted-foreground'}
              />
              <span className={`text-[10px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
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
