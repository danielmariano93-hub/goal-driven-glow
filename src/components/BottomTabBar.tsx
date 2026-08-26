import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { House, ListBullets, Target, DotsThree, ChatCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAssessor } from "@/context/AssessorContext";
import { MOBILE_TABS, activeMobileTabId } from "@/lib/navigation/appNavigationRegistry";

/** Ícone do bottom tab por id do registry (Phosphor é exclusivo desta barra). */
const TAB_ICONS: Record<string, typeof House> = {
  home: House,
  lancamentos: ListBullets,
  metas: Target,
  mais: DotsThree,
};

const routePreloaders: Record<string, () => Promise<unknown>> = {
  "/app": () => import("@/pages/Index"),
  "/app/lancamentos": () => import("@/pages/Lancamentos"),
  "/app/metas": () => import("@/pages/Metas"),
  "/app/mais": () => import("@/pages/MaisMenu"),
};

function preloadRoute(path: string) {
  void routePreloaders[path]?.().catch(() => undefined);
}

export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openAssessor } = useAssessor();
  const activeId = activeMobileTabId(location.pathname);

  useEffect(() => {
    const preload = () =>
      MOBILE_TABS.filter((tab) => tab.path !== location.pathname).forEach((tab) => preloadRoute(tab.path));
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) {
      const id = ric(preload, { timeout: 1800 });
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(preload, 900);
    return () => window.clearTimeout(id);
  }, [location.pathname]);

  const renderTab = (tabId: string) => {
    const tab = MOBILE_TABS.find((entry) => entry.id === tabId);
    if (!tab) return null;
    const Icon = TAB_ICONS[tab.id] ?? DotsThree;
    const active = activeId === tab.id;
    return (
      <Button
        key={tab.path}
        onPointerDown={() => preloadRoute(tab.path)}
        onPointerEnter={() => preloadRoute(tab.path)}
        onClick={() => navigate(tab.path)}
        variant="ghost"
        className={`h-14 flex-col gap-0.5 rounded-xl px-1 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}
        aria-current={active ? "page" : undefined}
      >
        <Icon size={20} weight={active ? "fill" : "regular"} />
        <span className="text-xs font-medium leading-4">{tab.label}</span>
      </Button>
    );
  };

  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl md:hidden">
      <div className="mx-auto grid h-[64px] max-w-lg grid-cols-5 items-center px-2">
        {renderTab("home")}
        {renderTab("lancamentos")}
        <Button type="button" variant="ghost" onClick={() => openAssessor("fab")} className="relative h-16 flex-col gap-0.5 rounded-xl px-1 text-primary" aria-label="Falar com o Nino">
          <span className="-mt-4 grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-brand"><ChatCircle size={22} weight="duotone" /></span>
          <span className="text-xs font-semibold leading-4">Nino</span>
        </Button>
        {renderTab("metas")}
        {renderTab("mais")}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
