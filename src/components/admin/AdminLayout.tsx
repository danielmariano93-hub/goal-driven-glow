import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, TrendingUp, Wallet, Bot, MessageCircle,
  Activity, Package, ShieldCheck, Settings, LogOut, Menu, Sparkles, Play,
  PanelLeftClose, PanelLeftOpen, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { can, roleLabel, type PlatformAction } from "@/lib/admin/permissions";
import { AdminErrorBoundary } from "@/components/admin/AdminErrorBoundary";
import { currentAdminTitle, useAdminDocumentTitle } from "@/components/admin/useAdminDocumentTitle";
import { SessionInactivityGuard } from "@/components/auth/SessionInactivityGuard";

type Item = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  action?: PlatformAction;
  end?: boolean;
};

type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Visão",
    items: [
      { to: "/admin", label: "Visão Geral", icon: LayoutDashboard, action: "overview.read", end: true },
    ],
  },
  {
    title: "Usuários & Engajamento",
    items: [
      { to: "/admin/usuarios", label: "Usuários", icon: Users, action: "users.read" },
      { to: "/admin/engajamento", label: "Engajamento", icon: TrendingUp, action: "overview.read" },
    ],
  },
  {
    title: "Assistente & Mensageria",
    items: [
      { to: "/admin/agente", label: "Assistente", icon: Bot, action: "agent.read" },
      { to: "/admin/ia", label: "IA & Inteligência", icon: Sparkles, action: "agent.read" },
      { to: "/admin/mensagens", label: "Mensagens", icon: MessageCircle, action: "agent.read" },
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle, action: "whatsapp.read" },
      { to: "/admin/agente/simulador", label: "Simulador", icon: Play, action: "agent.read" },
    ],
  },
  {
    title: "Operação & Sistema",
    items: [
      { to: "/admin/operacao", label: "Operação", icon: Activity, action: "ops.read" },
      { to: "/admin/financeiro", label: "Financeiro", icon: Wallet, action: "company_finance.read" },
      { to: "/admin/produto", label: "Produto", icon: Package, action: "product.read" },
      { to: "/admin/seguranca", label: "Segurança", icon: ShieldCheck, action: "security.read" },
      { to: "/admin/configuracoes", label: "Configurações", icon: Settings, action: "settings.read" },
    ],
  },
];

const COLLAPSED_KEY = "admin.sidebar.collapsed";

export function AdminLayout() {
  const { user, platformRole, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useAdminDocumentTitle();

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    }
  }, [collapsed]);

  useEffect(() => {
    // Close mobile drawer on route change
    setMobileOpen(false);
  }, [location.pathname]);

  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.action || can(platformRole, i.action)),
  })).filter((g) => g.items.length > 0);

  const currentTitle = currentAdminTitle(location.pathname);

  const linkClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
      active
        ? "bg-gradient-brand text-white shadow-brand"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    } ${collapsed ? "md:justify-center md:px-2" : ""}`;

  const SidebarBody = (
    <>
      <div className={`flex items-center gap-2.5 px-5 h-16 border-b border-border ${collapsed ? "md:justify-center md:px-2" : ""}`}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
          <ShieldCheck size={18} strokeWidth={2.4} />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-display text-sm font-bold tracking-tight leading-none truncate">
              MeuNino
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mt-1">
              Centro de Comando
            </p>
          </div>
        )}
      </div>
      <nav
        className="flex-1 overflow-y-auto py-4 px-3 space-y-5"
        aria-label="Navegação administrativa"
      >
        {groups.map((g) => (
          <div key={g.title}>
            {!collapsed && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {g.title}
              </p>
            )}
            <div className="space-y-1">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => linkClass(isActive)}
                    aria-label={it.label}
                    title={collapsed ? it.label : undefined}
                  >
                    <Icon size={16} strokeWidth={1.9} className="shrink-0" />
                    {!collapsed && <span className="truncate">{it.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3 space-y-1">
        {!collapsed && (
          <div className="px-3 py-2">
            <p className="text-xs font-medium truncate" title={user?.email ?? undefined}>{user?.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {roleLabel(platformRole)}
            </p>
          </div>
        )}
        <button
          onClick={() => signOut().then(() => navigate("/"))}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 ${collapsed ? "md:justify-center md:px-2" : ""}`}
          aria-label="Sair"
          title={collapsed ? "Sair" : undefined}
        >
          <LogOut size={16} strokeWidth={1.7} className="shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
        {!collapsed && (
          <p className="text-[10px] text-muted-foreground text-center pt-2">Admin · Beta</p>
        )}
      </div>
    </>
  );

  return (
    <SessionInactivityGuard>
    <div className="min-h-dvh bg-background flex">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 h-dvh sticky top-0 border-r border-border bg-card transition-[width] duration-200 ${collapsed ? "w-16" : "w-64"}`}
      >
        {SidebarBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 flex flex-col w-72 bg-card border-r border-border md:hidden">
            <div className="flex items-center justify-end p-2 md:hidden">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Fechar menu"
              >
                <X size={16} />
              </button>
            </div>
            {SidebarBody}
          </aside>
        </>
      )}

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 backdrop-blur px-4 h-14 md:h-16 md:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-border md:hidden focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Abrir menu"
          >
            <Menu size={18} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="hidden md:grid h-9 w-9 place-items-center rounded-xl border border-border hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold truncate">{currentTitle}</p>
          </div>
          <p className="hidden md:block text-[11px] text-muted-foreground">
            {user?.email} · {roleLabel(platformRole)}
          </p>
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 md:px-8 py-6 md:py-8">
          <AdminErrorBoundary>
            <Outlet />
          </AdminErrorBoundary>
        </div>
      </main>
    </div>
    </SessionInactivityGuard>
  );
}
