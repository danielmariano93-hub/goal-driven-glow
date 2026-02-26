import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, List, Calculator, Target, CreditCard, Heart, BarChart3, User, Wallet } from 'lucide-react';

const navGroups = [
  {
    label: 'Principal',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/lancamentos', label: 'Lançamentos', icon: List },
      { path: '/planejamento', label: 'Simulador', icon: Calculator },
      { path: '/metas', label: 'Metas', icon: Target },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { path: '/dividas', label: 'Dívidas', icon: CreditCard },
      { path: '/emocoes', label: 'Emocional', icon: Heart },
      { path: '/relatorios', label: 'Relatórios', icon: BarChart3 },
      { path: '/perfil', label: 'Perfil', icon: User },
    ],
  },
];

export function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 h-screen sticky top-0 border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
          <Wallet size={16} className="text-primary-foreground" />
        </div>
        <span className="text-sm font-bold text-foreground tracking-tight">Ecossistema Financeiro</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-2">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon size={16} strokeWidth={active ? 2.2 : 1.5} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border">
        <p className="text-[10px] text-muted-foreground">v1.0 · Todos os dados locais</p>
      </div>
    </aside>
  );
}
