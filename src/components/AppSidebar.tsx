import {
  LayoutDashboard,
  Receipt,
  Target,
  CreditCard,
  FileText,
  TrendingUp,
  Heart,
  Calculator,
  Settings,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';

const items = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Lançamentos', url: '/lancamentos', icon: Receipt },
  { title: 'Metas', url: '/metas', icon: Target },
  { title: 'Dívidas', url: '/dividas', icon: CreditCard },
  { title: 'Contas Fixas', url: '/contas-fixas', icon: FileText },
  { title: 'Investimentos', url: '/investimentos', icon: TrendingUp },
  { title: 'Emoções', url: '/emocoes', icon: Heart },
  { title: 'Simulador', url: '/simulador', icon: Calculator },
  { title: 'Configurações', url: '/configuracoes', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      <div className="h-16 flex items-center px-4 border-b border-border">
        {!collapsed && (
          <h1 className="text-sm font-semibold text-foreground tracking-tight truncate">
            Consciência Financeira
          </h1>
        )}
      </div>
      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      activeClassName="bg-accent text-foreground font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
