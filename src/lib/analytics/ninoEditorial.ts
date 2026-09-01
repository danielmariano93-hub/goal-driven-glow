/**
 * Instrumentação do bloco editorial do Nino na Home.
 *
 * Regras: nenhum valor financeiro, nome de meta, saldo ou texto de orientação
 * sai daqui. O payload carrega apenas identificadores e classificação editorial.
 * Sem provedor externo configurado, os eventos ficam num buffer em memória
 * (inspecionável em desenvolvimento) e são espelhados no `dataLayer` quando
 * existir.
 */
export type NinoEditorialEvent =
  | "nino_spotlight_impression"
  | "nino_spotlight_primary_action"
  | "nino_spotlight_secondary_action"
  | "nino_supporting_insight_impression"
  | "nino_supporting_insight_open"
  | "nino_view_all";

export type NinoEditorialPayload = {
  item_id?: string;
  semantic_type?: string;
  priority?: number;
  surface: string;
  action?: string;
};

type Recorded = NinoEditorialPayload & { event: NinoEditorialEvent; at: string };

const buffer: Recorded[] = [];
const onceKeys = new Set<string>();

export function trackNinoEditorial(event: NinoEditorialEvent, payload: NinoEditorialPayload) {
  const record: Recorded = { event, at: new Date().toISOString(), ...payload };
  buffer.push(record);
  if (buffer.length > 200) buffer.splice(0, buffer.length - 200);
  try {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    if (Array.isArray(layer)) layer.push(record);
  } catch {
    /* analytics nunca pode quebrar a Home */
  }
}

/** Impressão conta uma vez por item por sessão. */
export function trackNinoEditorialOnce(event: NinoEditorialEvent, payload: NinoEditorialPayload) {
  const key = `${event}:${payload.item_id ?? "none"}`;
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  trackNinoEditorial(event, payload);
}

export function readNinoEditorialEvents(): Recorded[] {
  return [...buffer];
}

export function resetNinoEditorialEvents() {
  buffer.length = 0;
  onceKeys.clear();
}
