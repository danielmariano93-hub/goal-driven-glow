// Indicador "Tela pronta": tempo entre a pessoa abrir uma tela e ela estar utilizável (conteúdo desenhado e consultas iniciais
// respondidas, sem spinner). Este arquivo só tem a parte pura (testável); o medidor está em components/perf/ScreenPerfTracker.

export type PerfDevice = "ios" | "android" | "desktop" | "desconhecido";

export interface ScreenPerfEvent {
  route: string;
  nav_kind: "cold" | "soft";
  ready_ms: number;
  timed_out: boolean;
  ttfb_ms?: number;
  fcp_ms?: number;
  lcp_ms?: number;
  device: PerfDevice;
  standalone: boolean;
  conn?: string;
  build?: string;
}

/** Tempo máximo esperado por uma tela; passou disso, registra como "não terminou" (spinner preso, rede morta). */
export const READY_TIMEOUT_MS = 20_000;
/** A tela só conta como pronta depois deste tempo SEM nada carregando (evita "pronta" entre duas consultas em cadeia). */
export const QUIET_WINDOW_MS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const LONG_TOKEN = /^[0-9a-z_-]{20,}$/i;

/**
 * Caminho → "tela" (sem ids, sem query, sem dados pessoais): /app/metas/abc-123… → /app/metas/:id.
 * Só telas do app; o painel administrativo e as páginas públicas não entram na medição.
 */
export function normalizeRoute(pathname: string): string | null {
  const clean = String(pathname ?? "").split("?")[0]!.split("#")[0]!.replace(/\/+$/, "") || "/";
  if (clean !== "/app" && !clean.startsWith("/app/")) return null;
  const parts = clean.split("/").map((seg) => (UUID.test(seg) || NUMERIC.test(seg) || LONG_TOKEN.test(seg) ? ":id" : seg.toLowerCase()));
  const route = parts.join("/");
  return /^\/[a-z0-9/:_-]*$/.test(route) && route.length <= 80 ? route : null;
}

export function classifyDevice(userAgent: string, maxTouchPoints = 0): PerfDevice {
  const ua = String(userAgent ?? "");
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (ua) return "desktop";
  return "desconhecido";
}

export function buildScreenEvent(input: {
  route: string;
  first: boolean;
  startedAt: number;
  readyAt: number;
  timedOut: boolean;
  device: PerfDevice;
  standalone: boolean;
  conn?: string | null;
  build?: string | null;
  ttfb?: number | null;
  fcp?: number | null;
  lcp?: number | null;
}): ScreenPerfEvent {
  const ready = Math.max(0, Math.round(input.readyAt - input.startedAt));
  const ev: ScreenPerfEvent = {
    route: input.route,
    nav_kind: input.first ? "cold" : "soft",
    ready_ms: Math.min(READY_TIMEOUT_MS, ready),
    timed_out: input.timedOut,
    device: input.device,
    standalone: input.standalone,
  };
  if (input.conn) ev.conn = String(input.conn).slice(0, 12);
  if (input.build) ev.build = String(input.build).slice(0, 12);
  if (input.first) {
    const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
    const ttfb = num(input.ttfb), fcp = num(input.fcp), lcp = num(input.lcp);
    if (ttfb !== undefined) ev.ttfb_ms = ttfb;
    if (fcp !== undefined) ev.fcp_ms = fcp;
    if (lcp !== undefined) ev.lcp_ms = lcp;
  }
  return ev;
}

/** Faixas usadas no painel: "rápida" até 2 s numa tela já aberta no app, 3 s na primeira abertura (que baixa o app). */
export function isFastScreen(ev: Pick<ScreenPerfEvent, "ready_ms" | "nav_kind" | "timed_out">): boolean {
  return !ev.timed_out && ev.ready_ms <= (ev.nav_kind === "cold" ? 3000 : 2000);
}
