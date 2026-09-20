import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

function surfaceForPath(pathname: string): string {
  if (pathname === "/app" || pathname === "/app/") return "home";
  if (pathname.startsWith("/app/lancamentos")) return "movements";
  if (pathname.startsWith("/app/planejamento")) return "planning";
  if (pathname.startsWith("/app/relatorios")) return "reports";
  if (pathname.startsWith("/app/metas")) return "goals";
  if (pathname.startsWith("/app/investimentos")) return "investments";
  if (pathname.startsWith("/app/dividas")) return "debts";
  if (pathname.startsWith("/app/nino") || pathname.startsWith("/app/assessor")) return "nino";
  if (pathname.startsWith("/app/emocoes")) return "emotions";
  return "other";
}

/**
 * First-party, authenticated usage signal for behavioral awareness.
 * We only record app surfaces, never content, query strings or free text.
 * A short client-side debounce avoids counting rerenders as extra attention.
 */
export function BehavioralUsageTracker() {
  const { user } = useAuth();
  const location = useLocation();
  const lastKey = useRef<string>("");
  const surface = useMemo(() => surfaceForPath(location.pathname), [location.pathname]);

  useEffect(() => {
    if (!user || !location.pathname.startsWith("/app")) return;
    const bucket = Math.floor(Date.now() / (5 * 60_000));
    const key = `${user.id}:${surface}:${bucket}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    void (supabase.rpc as any)("behavioral_record_app_activity", { p_surface: surface }).then(({ error }: any) => {
      if (error) console.warn("[behavior:usage]", error.message ?? error);
    });
  }, [user?.id, surface, location.pathname]);

  return null;
}
