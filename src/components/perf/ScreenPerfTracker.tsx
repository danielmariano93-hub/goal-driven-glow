import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  buildScreenEvent, classifyDevice, normalizeRoute, QUIET_WINDOW_MS, READY_TIMEOUT_MS, type ScreenPerfEvent,
} from "@/lib/perf/screenTiming";

/** Algo na tela ainda indica "carregando": spinner solto (não o de botões), marcador explícito ou aria-busy. */
function screenLooksBusy(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector('[data-screen-loading], [aria-busy="true"]')) return true;
  for (const el of Array.from(document.querySelectorAll(".animate-spin"))) {
    if (!el.closest('button, [data-perf-ignore], [role="progressbar"]')) return true;
  }
  return false;
}

/** Há consulta inicial em andamento (sem dado ainda)? Atualizações em segundo plano não contam: a pessoa não as espera. */
function initialQueryInFlight(qc: ReturnType<typeof useQueryClient>): boolean {
  return qc.getQueryCache().findAll({ fetchStatus: "fetching" }).some((q) => q.state.data === undefined);
}

function coldExtras() {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
    return { ttfb: nav?.responseStart, fcp };
  } catch { return { ttfb: undefined, fcp: undefined }; }
}

/**
 * Mede, para cada tela do app, quanto tempo a pessoa espera até ela estar pronta (indicador "Tela pronta") e envia ao banco em lotes.
 * Nunca interfere na tela: qualquer erro é engolido, nada é medido com a aba em segundo plano e nada sai com dados pessoais.
 */
export function ScreenPerfTracker() {
  const location = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queue = useRef<ScreenPerfEvent[]>([]);
  const flushTimer = useRef<number | null>(null);
  // Primeira rota vista pelo roteador = onde o app foi aberto (no BrowserRouter é o endereço da página).
  const firstPath = useRef<string | null>(location.pathname);
  const consumedFirst = useRef(false);
  const lcp = useRef<number | undefined>(undefined);

  // LCP (maior elemento) da primeira abertura
  useEffect(() => {
    try {
      const po = new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) lcp.current = last.startTime;
      });
      po.observe({ type: "largest-contentful-paint", buffered: true });
      return () => po.disconnect();
    } catch { return undefined; }
  }, []);

  const flush = useRef(() => {});
  flush.current = () => {
    if (!userId || queue.current.length === 0) return;
    const batch = queue.current.splice(0, 25);
    try {
      void (supabase.rpc as unknown as (fn: string, args: unknown) => Promise<unknown>)("client_perf_record", { p_events: batch }).then(undefined, () => undefined);
    } catch { /* medição nunca derruba a tela */ }
  };

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush.current(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide); };
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    const route = normalizeRoute(location.pathname);
    if (!route) return undefined;
    // "Primeira abertura" = o app foi aberto direto numa tela do app (conta o download do app). Depois do login conta como tela comum.
    const first = !consumedFirst.current && normalizeRoute(firstPath.current ?? "") !== null;
    consumedFirst.current = true;
    const startedAt = first ? 0 : performance.now();
    let quietSince: number | null = null;
    let done = false;
    let invalid = false;

    const finish = (readyAt: number, timedOut: boolean) => {
      if (done) return;
      done = true;
      if (invalid) return;
      try {
        const ex = first ? coldExtras() : { ttfb: undefined, fcp: undefined };
        const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType;
        const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
        queue.current.push(buildScreenEvent({
          route, first, startedAt, readyAt, timedOut, device: classifyDevice(navigator.userAgent, navigator.maxTouchPoints),
          standalone: Boolean(standalone), conn, build: typeof __APP_BUILD_SHA__ === "string" ? __APP_BUILD_SHA__ : null,
          ttfb: ex.ttfb, fcp: ex.fcp, lcp: first ? lcp.current : undefined,
        }));
        if (flushTimer.current) window.clearTimeout(flushTimer.current);
        flushTimer.current = window.setTimeout(() => flush.current(), 4000);
      } catch { /* ignora */ }
    };

    const onVisibility = () => { if (document.visibilityState === "hidden") invalid = true; };
    document.addEventListener("visibilitychange", onVisibility);

    const tick = () => {
      if (done) return;
      const now = performance.now();
      if (now - startedAt > READY_TIMEOUT_MS) { finish(startedAt + READY_TIMEOUT_MS, true); return; }
      const busy = initialQueryInFlight(qc) || screenLooksBusy();
      if (busy) quietSince = null;
      else if (quietSince === null) quietSince = now;
      else if (now - quietSince >= QUIET_WINDOW_MS) { finish(quietSince, false); return; }
      timer = window.setTimeout(tick, 80);
    };
    // espera o primeiro desenho da tela nova antes de começar a olhar
    let timer = window.setTimeout(() => requestAnimationFrame(tick), 0);
    return () => { done = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [location.pathname, userId, qc]);

  return null;
}
