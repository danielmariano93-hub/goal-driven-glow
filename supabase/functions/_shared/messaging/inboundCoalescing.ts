// inbound_coalescing.v1 — mensagens em rajada viram UM turno.
//
// Quem escreve no WhatsApp costuma quebrar o pensamento em várias mensagens
// ("Nino estou desesperado" / "Como bloqueio meus gastos"). Cada webhook roda
// o agente por conta própria, então antes a pessoa recebia duas respostas, cada
// uma lendo só um pedaço. Agora cada mensagem de texto espera uma janela curta;
// se chegou outra DEPOIS dela, ela vira "seguidora" e some em silêncio, e a
// última da rajada ("líder") responde uma vez, com o texto de todas juntas.
//
// A eleição é determinística (ordem received_at + id): todos os webhooks leem a
// mesma ordem, então exatamente um vira líder, sem lock nem tabela nova.
// deno-lint-ignore-file no-explicit-any

export const DEFAULT_COALESCE_WINDOW_MS = 2500;
/** Teto de mensagens fundidas por turno (proteção contra spam). */
export const MAX_COALESCED_MESSAGES = 6;
const LOOKBACK_MS = 120_000;
export const COALESCED_PREFIX = "coalesced:";

export type InboundRow = {
  id: string;
  body: string | null;
  received_at: string | number | Date | null;
  processed_at: string | null;
  ignored_reason: string | null;
  has_media: boolean | null;
};

export type CoalescePlan =
  | { role: "leader"; text: string; mergedIds: string[] }
  | { role: "follower"; leaderHint: string };

const ts = (v: InboundRow["received_at"]) => {
  const n = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const isText = (r: InboundRow) => !r.has_media && String(r.body ?? "").trim().length > 0;

function sortRows(rows: InboundRow[]): InboundRow[] {
  return [...rows].sort((a, b) => ts(a.received_at) - ts(b.received_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Decide se a mensagem `myId` é seguidora (existe texto mais novo) ou líder
 * (e, nesse caso, quais mensagens anteriores da rajada entram no texto).
 */
export function planCoalescing(rows: InboundRow[], myId: string, windowMs: number): CoalescePlan {
  const sorted = sortRows(rows);
  const idx = sorted.findIndex((r) => r.id === myId);
  if (idx < 0) return { role: "leader", text: "", mergedIds: [] };
  const mine = sorted[idx];

  const newer = sorted.slice(idx + 1).filter(isText);
  if (newer.length > 0 && isText(mine)) {
    return { role: "follower", leaderHint: newer[newer.length - 1].id };
  }

  // Líder: caminha para trás pela rajada.
  const chain: InboundRow[] = [mine];
  const chainIds = new Set<string>([mine.id]);
  for (let i = idx - 1; i >= 0 && chain.length < MAX_COALESCED_MESSAGES; i--) {
    const prev = sorted[i];
    if (!isText(prev)) break;
    const reason = String(prev.ignored_reason ?? "");
    const target = reason.startsWith(COALESCED_PREFIX) ? reason.slice(COALESCED_PREFIX.length) : null;
    const next = chain[0];
    const gap = ts(next.received_at) - ts(prev.received_at);
    // Seguidora já marcada e ligada a esta rajada.
    const markedFollower = target !== null && chainIds.has(target);
    // Seguidora ainda sem marca (corrida de milissegundos): chegou dentro da janela da próxima.
    const unmarkedFollower = prev.processed_at === null && !prev.ignored_reason && gap < windowMs;
    if (!markedFollower && !unmarkedFollower) break;
    chain.unshift(prev);
    chainIds.add(prev.id);
  }
  return {
    role: "leader",
    text: chain.map((r) => String(r.body ?? "").trim()).join("\n"),
    mergedIds: chain.filter((r) => r.id !== mine.id).map((r) => r.id),
  };
}

type Sb = { from: (table: string) => any };

/**
 * Espera a janela e resolve o papel desta mensagem. Em falha de leitura, cai
 * para "líder com o próprio texto" — nunca bloqueia a resposta.
 */
export async function resolveInboundTurn(
  sb: Sb,
  opts: {
    fromPhone: string;
    inboundId: string;
    ownBody: string;
    hasMedia: boolean;
    windowMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<CoalescePlan> {
  const windowMs = opts.windowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  const own: CoalescePlan = { role: "leader", text: opts.ownBody, mergedIds: [] };
  if (windowMs <= 0 || opts.hasMedia || !opts.ownBody.trim()) return own;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  try {
    await sleep(windowMs);
    const since = new Date(now() - LOOKBACK_MS).toISOString();
    const { data, error } = await sb.from("inbound_messages")
      .select("id,body,received_at,processed_at,ignored_reason,has_media")
      .eq("from_phone", opts.fromPhone)
      .gte("received_at", since)
      .order("received_at", { ascending: true })
      .limit(40);
    if (error || !Array.isArray(data)) return own;

    const plan = planCoalescing(data as InboundRow[], opts.inboundId, windowMs);
    if (plan.role === "follower") {
      await sb.from("inbound_messages")
        .update({ processed_at: new Date(now()).toISOString(), ignored_reason: `${COALESCED_PREFIX}${plan.leaderHint}` })
        .eq("id", opts.inboundId)
        .is("processed_at", null);
      return plan;
    }
    return plan.text.trim() ? plan : own;
  } catch {
    return own;
  }
}

export function coalesceWindowFromEnv(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_COALESCE_WINDOW_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? Math.floor(n) : DEFAULT_COALESCE_WINDOW_MS;
}
