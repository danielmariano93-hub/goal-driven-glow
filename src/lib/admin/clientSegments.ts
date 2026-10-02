// Segmentação acionável de clientes: em vez de uma tabela de "status", cada segmento
// diz o que está acontecendo e o que fazer.

export type ClientLifecycle = "new" | "activated" | "active" | "dormant" | "deleted";

export type ClientRow = {
  pseudo_id: string;
  registered_at: string;
  onboarding_completed_at: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
  total_events: number;
  significant_actions: number;
  has_financial_data: boolean;
  lifecycle_status: ClientLifecycle;
};

export type SegmentKey = "at_risk" | "dormant" | "stuck_start" | "no_data" | "engaged";

export const SEGMENTS: Record<SegmentKey, { label: string; hint: string; tone: "danger" | "warning" | "success" | "info" }> = {
  at_risk: { label: "Em risco de sumir", hint: "Estavam ativos e ficaram mais de 7 dias sem usar. Vale um contato ou lembrete.", tone: "danger" },
  dormant: { label: "Dormentes", hint: "Sem uso recente. Reativar com uma mensagem útil (ex.: resumo do mês).", tone: "warning" },
  stuck_start: { label: "Parados no início", hint: "Cadastraram há mais de 2 dias e não concluíram o onboarding ou a primeira ação.", tone: "warning" },
  no_data: { label: "Sem dados financeiros", hint: "Sem lançamentos há mais de 3 dias: o Nino ainda não tem o que analisar.", tone: "info" },
  engaged: { label: "Engajados", hint: "Uso frequente. Bons candidatos a feedback e a novas funcionalidades.", tone: "success" },
};

const DAY = 86_400_000;
const ageDays = (iso: string | null, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);

/** Segmentos em que o cliente se encaixa (pode ser mais de um). */
export function segmentsOf(client: ClientRow, now: number = Date.now()): SegmentKey[] {
  const out: SegmentKey[] = [];
  const idle = ageDays(client.last_event_at, now);
  const since = ageDays(client.registered_at, now) ?? 0;
  if (client.lifecycle_status === "deleted") return out;
  if (client.lifecycle_status === "dormant") out.push("dormant");
  else if (idle != null && idle > 7 && (client.lifecycle_status === "active" || client.lifecycle_status === "activated")) out.push("at_risk");
  if (since > 2 && (!client.onboarding_completed_at || client.significant_actions === 0) && client.lifecycle_status !== "active") out.push("stuck_start");
  if (!client.has_financial_data && since > 3) out.push("no_data");
  if (client.lifecycle_status === "active" && client.significant_actions >= 5 && (idle ?? 99) <= 7) out.push("engaged");
  return out;
}

export function segmentCounts(clients: ClientRow[], now: number = Date.now()): Record<SegmentKey, number> {
  const counts: Record<SegmentKey, number> = { at_risk: 0, dormant: 0, stuck_start: 0, no_data: 0, engaged: 0 };
  for (const c of clients) for (const s of segmentsOf(c, now)) counts[s] += 1;
  return counts;
}

/** Frase curta e concreta sobre o cliente, para o topo do cartão. */
export function clientNarrative(client: ClientRow, now: number = Date.now()): string {
  const idle = ageDays(client.last_event_at, now);
  const since = ageDays(client.registered_at, now) ?? 0;
  if (client.lifecycle_status === "deleted") return "Conta em exclusão.";
  if (!client.first_event_at) return since > 2 ? `Cadastrou há ${since} dias e nunca usou.` : "Acabou de chegar.";
  if (idle == null) return "Sem atividade registrada.";
  if (idle === 0) return "Usou hoje.";
  if (idle === 1) return "Usou ontem.";
  return `Última atividade há ${idle} dias.`;
}

/** Próxima ação sugerida, ou null se não há nada a fazer. */
export function clientNextAction(client: ClientRow, now: number = Date.now()): string | null {
  const segs = segmentsOf(client, now);
  if (segs.includes("at_risk")) return "Enviar um lembrete útil antes que vire dormente.";
  if (segs.includes("dormant")) return "Reativar com o resumo do mês.";
  if (segs.includes("stuck_start")) return "Ajudar a concluir o onboarding e a primeira ação.";
  if (segs.includes("no_data")) return "Convidar a registrar o primeiro gasto ou importar a fatura.";
  return null;
}
