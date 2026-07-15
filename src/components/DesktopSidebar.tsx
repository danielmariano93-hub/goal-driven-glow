import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  List,
  Calculator,
  Target,
  CreditCard,
  Heart,
  User,
  Wallet,
  PiggyBank,
  Tag,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const navGroups = [
  {
    label: 'Principal',
    items: [
      { path: '/app', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { path: '/app/lancamentos', label: 'Lançamentos', icon: List },
      { path: '/app/planejamento', label: 'Antes de gastar', icon: Calculator },
      { path: '/app/metas', label: 'Metas', icon: Target },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { path: '/app/contas', label: 'Contas', icon: Wallet },
      { path: '/app/categorias', label: 'Categorias', icon: Tag },
      { path: '/app/investimentos', label: 'Investimentos', icon: PiggyBank },
      { path: '/app/dividas', label: 'Dívidas', icon: CreditCard },
      { path: '/app/emocoes', label: 'Emocional', icon: Heart },
      { path: '/app/perfil', label: 'Perfil', icon: User },
    ],
  },
];

export function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, isAdmin } = useAuth();

  const isActive = (path: string, exact?: boolean) =>
    exact ? location.pathname === path : location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-border bg-card">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
          <Wallet size={18} strokeWidth={2.4} />
        </span>
        <span className="font-display text-base font-bold tracking-tight">
          NoControle<span className="text-gradient-brand">.ia</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6" aria-label="Navegação principal">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.16em] px-2 mb-2">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map(item => {
                const active = isActive(item.path, item.exact);
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      active
                        ? 'bg-gradient-brand text-white shadow-brand'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon size={16} strokeWidth={active ? 2.3 : 1.7} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3 space-y-1">
        {isAdmin && (
          <button
            onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <ShieldCheck size={16} strokeWidth={1.7} />
            <span>Admin</span>
          </button>
        )}
        <button
          onClick={() => signOut().then(() => navigate('/'))}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <LogOut size={16} strokeWidth={1.7} />
          <span>Sair</span>
        </button>
        <p className="text-[10px] text-muted-foreground text-center pt-2">Feito no Brasil · v0.1</p>
      </div>
    </aside>
  );
}
