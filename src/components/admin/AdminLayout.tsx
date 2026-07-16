import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, TrendingUp, Wallet, Bot, MessageCircle,
  Activity, Package, ShieldCheck, Settings, LogOut, Menu,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { can, roleLabel, type PlatformAction } from "@/lib/admin/permissions";

type Item = {
  to: string;
  label: string;
  icon: any;
  action?: PlatformAction;
  end?: boolean;
};

const NAV: Item[] = [
  { to: "/admin", label: "Visão Geral", icon: LayoutDashboard, action: "overview.read", end: true },
  { to: "/admin/usuarios", label: "Usuários", icon: Users, action: "users.read" },
  { to: "/admin/engajamento", label: "Engajamento", icon: TrendingUp, action: "overview.read" },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet, action: "company_finance.read" },
  { to: "/admin/agente", label: "Agente", icon: Bot, action: "agent.read" },
  { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle, action: "whatsapp.read" },
  { to: "/admin/operacao", label: "Operação", icon: Activity, action: "ops.read" },
  { to: "/admin/produto", label: "Produto", icon: Package, action: "product.read" },
  { to: "/admin/seguranca", label: "Segurança", icon: ShieldCheck, action: "security.read" },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings, action: "settings.read" },
];

export function AdminLayout() {
  const { user, platformRole, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV.filter((n) => !n.action || can(platformRole, n.action));

  const linkClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
      active
        ? "bg-gradient-brand text-white shadow-brand"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    }`;

  const SidebarBody = (
    <>
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
          <ShieldCheck size={18} strokeWidth={2.4} />
        </span>
        <div>
          <p className="font-display text-sm font-bold tracking-tight leading-none">
            NoControle<span className="text-gradient-brand">.ia</span>
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mt-1">
            Centro de Comando
          </p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-1" aria-label="Navegação administrativa">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => linkClass(isActive)}
            >
              <Icon size={16} strokeWidth={1.9} />
              <span>{it.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-border p-3 space-y-1">
        <div className="px-3 py-2">
          <p className="text-xs font-medium truncate">{user?.email}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {roleLabel(platformRole)}
          </p>
        </div>
        <button
          onClick={() => signOut().then(() => navigate("/"))}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <LogOut size={16} strokeWidth={1.7} />
          <span>Sair</span>
        </button>
        <p className="text-[10px] text-muted-foreground text-center pt-2">Admin · Beta</p>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 border-r border-border bg-card">
        {SidebarBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 flex flex-col w-72 bg-card border-r border-border md:hidden">
            {SidebarBody}
          </aside>
        </>
      )}

      <main className="flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between border-b border-border bg-card px-4 h-14">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-border"
            aria-label="Abrir menu"
          >
            <Menu size={18} />
          </button>
          <p className="font-display font-bold text-sm">
            NoControle<span className="text-gradient-brand">.ia</span> Admin
          </p>
          <div className="w-9" />
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 md:px-8 py-6 md:py-8">
          <AdminErrorBoundary>
            <Outlet />
          </AdminErrorBoundary>
        </div>
      </main>
    </div>
  );
}
