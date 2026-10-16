// Roda da vida financeira: 8 áreas, cada uma com UM estado (nunca uma nota, nunca uma média).
// A cor de uma área é a do indicador mais preocupante dela; sem dado fica cinza; medidas em teste e descritivas não pintam a roda.
import type { MapaIndicator, MapaPillarId, MapaStatus } from "@/lib/engine/mapaContracts";

export type WheelState = MapaStatus | "informativo";

export interface WheelSegment {
  id: MapaPillarId;
  /** Rótulo curto (cabe na roda). */
  short: string;
  /** Rótulo por extenso (legenda). */
  label: string;
  layer: "saude" | "habitos" | "bem_estar";
}

/** Ordem horário a partir do topo: saúde (4), hábitos (3), bem-estar. */
export const WHEEL_SEGMENTS: readonly WheelSegment[] = [
  { id: "equilibrio", short: "Equilíbrio", label: "Equilíbrio", layer: "saude" },
  { id: "seguranca", short: "Segurança", label: "Segurança", layer: "saude" },
  { id: "dividas", short: "Dívidas", label: "Dívidas", layer: "saude" },
  { id: "futuro", short: "Futuro", label: "Construção de futuro", layer: "saude" },
  { id: "execucao", short: "Execução", label: "Execução", layer: "habitos" },
  { id: "planejamento", short: "Plano", label: "Planejamento", layer: "habitos" },
  { id: "acompanhamento", short: "Noção", label: "Acompanhamento", layer: "habitos" },
  { id: "bem_estar", short: "Bem-estar", label: "Bem-estar percebido", layer: "bem_estar" },
];

const SEVERITY: Record<string, number> = { ok: 0, atencao: 1, critico: 2 };

/**
 * Estado de uma área: o pior entre os indicadores que JULGAM (têm sentido favorável e não são exploratórios).
 * Só há indicadores descritivos/em teste com dado ⇒ "informativo". Nenhum com dado ⇒ "sem_dados".
 */
export function pillarState(indicators: MapaIndicator[]): WheelState {
  const withData = indicators.filter((i) => i.status !== "sem_dados");
  if (!withData.length) return "sem_dados";
  const judging = withData.filter((i) => i.direction !== "neutral" && !i.reasons.includes("exploratorio"));
  if (!judging.length) return "informativo";
  return judging.reduce<MapaStatus>((worst, i) => (SEVERITY[i.status] > SEVERITY[worst] ? i.status : worst), "ok");
}

export function wheelStates(indicators: MapaIndicator[]): Record<MapaPillarId, WheelState> {
  const out = {} as Record<MapaPillarId, WheelState>;
  for (const seg of WHEEL_SEGMENTS) {
    out[seg.id] = seg.id === "bem_estar" ? "informativo" : pillarState(indicators.filter((i) => i.pillar === seg.id));
  }
  return out;
}

export const WHEEL_STATE_LABEL: Record<WheelState, string> = {
  ok: "tudo certo", atencao: "atenção", critico: "precisa de cuidado", sem_dados: "sem dados", informativo: "só informativo",
};

/** Caminho SVG de uma fatia de anel (ângulos em graus, 0 = topo, horário). */
export function wedgePath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as const;
  };
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)} A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}
