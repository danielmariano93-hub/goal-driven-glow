import { NavLink, useLocation } from "react-router-dom";
import { BarChart3, CalendarCheck, ListChecks, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/h/hoje", label: "Hoje", Icon: CalendarCheck },
  { to: "/h/habitos", label: "Hábitos", Icon: ListChecks },
  { to: "/h/progresso", label: "Progresso", Icon: BarChart3 },
  { to: "/h/mais", label: "Mais", Icon: MoreHorizontal },
] as const;

/** Barra de abas do lado Hábitos. */
export function HabitsTabBar() {
  return (
    <nav aria-label="Navegação de Hábitos" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl">
      <div className="mx-auto grid h-[64px] max-w-lg grid-cols-4 items-center px-2">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[12px] font-medium transition-colors", isActive ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
            <span className="leading-4">{label}</span>
          </NavLink>
        ))}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

/** Casca do lado Hábitos: fundo e tipografia do Nino (`data-surface="home"`) e barra de abas própria. */
export function HabitsShell({ children }: { children: React.ReactNode }) {
  // O fluxo de criar hábito ocupa a tela toda: a barra de abas só volta na escolha inicial (a tela renderiza a sua).
  const hideNav = useLocation().pathname.startsWith("/h/novo");
  return (
    <div data-surface="home" className="min-h-screen bg-background text-foreground" style={{ background: "var(--home-bg)" }}>
      <div className={hideNav ? "mx-auto w-full max-w-[720px]" : "mx-auto w-full max-w-[720px] pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"}>{children}</div>
      {hideNav ? null : <HabitsTabBar />}
    </div>
  );
}
