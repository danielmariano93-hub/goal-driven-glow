/**
 * Eventos de uso da tela do Ticket (handoff: ticket_tab_view, chart_select, simulation_change, drilldown_open,
 * opportunity_action). Regras: nenhum valor em reais, saldo, nome de estabelecimento ou descrição sai daqui; só
 * identificadores de tela e de ação. Sem provedor externo, ficam num buffer em memória e vão para o `dataLayer`
 * quando ele existir (mesmo padrão de `ninoEditorial`). Clique não é economia realizada.
 */
export type TicketEvent = "ticket_tab_view" | "chart_select" | "simulation_change" | "drilldown_open" | "opportunity_action";
export type TicketEventPayload = { tab?: string; chart?: string; target?: string; action?: string; source?: string; opportunity?: string };

type Recorded = TicketEventPayload & { event: TicketEvent; at: string };
const buffer: Recorded[] = [];

export function trackTicket(event: TicketEvent, payload: TicketEventPayload = {}) {
  const record: Recorded = { event, at: new Date().toISOString(), ...payload };
  buffer.push(record);
  if (buffer.length > 200) buffer.splice(0, buffer.length - 200);
  try {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    if (Array.isArray(layer)) layer.push(record);
  } catch {
    /* analytics nunca pode quebrar a tela */
  }
}

export function readTicketEvents(): Recorded[] { return [...buffer]; }
export function resetTicketEvents() { buffer.length = 0; }
