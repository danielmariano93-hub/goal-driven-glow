import { APP_NAVIGATION } from "@/lib/navigation/appNavigationRegistry";

/** Resposta de `admin_perf_screens` (indicador "Tela pronta"). Tempos em milissegundos; p75 = 3 em cada 4 aberturas levam até isso. */
export interface ScreenPerfReport {
  days: number;
  overall: { n: number; p50: number | null; p75: number | null; p95: number | null; fast_pct: number | null; timed_out: number; users: number };
  soft: { n: number; p75: number | null };
  cold: { n: number; p75: number | null; ttfb_p75: number | null; fcp_p75: number | null; lcp_p75: number | null };
  screens: Array<{ route: string; n: number; p50: number; p75: number; p95: number; fast_pct: number; timed_out: number }>;
  daily: Array<{ day: string; n: number; p50: number; p75: number }>;
  devices: Array<{ device: string; standalone: boolean; n: number; p75: number }>;
  builds: Array<{ build: string; n: number; p75: number; last_seen: string }>;
}

export type PerfTone = "bom" | "atencao" | "ruim" | "sem_dados";

/** Faixa do p75 de uma tela já aberta no app: até 2 s bom, até 4 s atenção, acima ruim. */
export function perfTone(p75: number | null | undefined): PerfTone {
  if (p75 == null) return "sem_dados";
  return p75 <= 2000 ? "bom" : p75 <= 4000 ? "atencao" : "ruim";
}

export const TONE_TEXT: Record<PerfTone, string> = { bom: "Boa", atencao: "Atenção", ruim: "Lenta", sem_dados: "Sem dados" };

/** Nome da tela para quem lê o painel: usa o nome do menu; senão mostra o caminho. */
export function screenLabel(route: string): string {
  const exact = APP_NAVIGATION.find((e) => e.path === route);
  if (exact) return exact.label;
  const withoutId = route.replace(/\/:id$/, "");
  const parent = APP_NAVIGATION.find((e) => e.path === withoutId);
  if (parent && withoutId !== route) return `${parent.label} (detalhe)`;
  return route;
}

export const DEVICE_LABEL: Record<string, string> = { ios: "iPhone/iPad", android: "Android", desktop: "Computador", desconhecido: "Outro" };

/** Variação do p75 do último dia contra a média dos anteriores (positivo = ficou mais lento). null sem base. */
export function trendPct(daily: ScreenPerfReport["daily"]): number | null {
  if (daily.length < 3) return null;
  const last = daily[daily.length - 1]!;
  const prev = daily.slice(0, -1);
  const base = prev.reduce((a, d) => a + d.p75, 0) / prev.length;
  return base > 0 ? ((last.p75 - base) / base) * 100 : null;
}
