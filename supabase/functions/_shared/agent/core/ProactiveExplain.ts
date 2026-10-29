// ProactiveExplain (`nino_proactive_explain.v1`)
//
// O Nino manda avisos, insights e relatórios sozinho e grava, em `outbound_messages`, o texto e os
// fatos que o geraram (`metadata.evidence`). Quando a pessoa responde "me explica melhor", "por que
// você me falou isso?" ou "e o que eu faço?", o assunto é ESSA mensagem — não o último tema da
// memória. Este módulo:
//   1. acha o aviso mais recente, só se ele foi a última coisa que o Nino disse;
//   2. entrega ao interpretador como contexto tipado (sem regra por frase);
//   3. monta o corpo determinístico da explicação a partir dos fatos gravados. O compositor
//      escreve a voz e o próximo passo, e a trava de números só aceita valores presentes no texto
//      do aviso ou nos fatos.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const PROACTIVE_EXPLAIN_VERSION = "nino_proactive_explain.v1";

/** Tipos de saída automática que a pessoa pode querer entender depois. */
export const PROACTIVE_OUTBOUND_KINDS = [
  "proactive", "weekly_report", "monthly_report", "due_reminder", "weekend_recap",
] as const;

const WINDOW_HOURS = 48;
const BODY_LIMIT = 1500;
const FACTS_LIMIT = 3500;

export type RecentProactive = {
  id: string;
  kind: string;
  suggestion_kind: string | null;
  sent_at: string;
  minutes_ago: number;
  title: string;
  body: string;
  facts: unknown;
};

const NOISE_KEY = /(^|_)(ids?|uuid|version|timing|score|scores|window|defer|reconciliation|presentation|principle|principles|behavioral|guards|template|contract|rendered|narrative|canonical|revalidation|metric_key|situation_id|item_id|source_id|goal_id|card_id|debt_id|category_id|account_id|reasons)(_|$)|_id$|formula_version|^source_body$|^final_message$/i;

/** Remove ids e campos internos; mantém só o que ajuda a explicar o aviso. */
export function sanitizeProactiveFacts(value: unknown, depth = 0): unknown {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (depth >= 6) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeProactiveFacts(item, depth + 1)).filter((item) => item != null);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (NOISE_KEY.test(key)) continue;
      const clean = sanitizeProactiveFacts(item, depth + 1);
      if (clean == null || (Array.isArray(clean) && !clean.length)) continue;
      if (typeof clean === "object" && !Array.isArray(clean) && !Object.keys(clean as object).length) continue;
      out[key] = clean;
    }
    return out;
  }
  return null;
}

function trimJson(value: unknown, max: number): unknown {
  try {
    const text = JSON.stringify(value);
    if (text.length <= max) return value;
    // Corta pelos campos de fim de lista até caber: nunca devolve JSON truncado.
    if (Array.isArray(value)) return trimJson(value.slice(0, Math.max(1, value.length - 1)), max);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length <= 1) return value;
      return trimJson(Object.fromEntries(entries.slice(0, entries.length - 1)), max);
    }
    return value;
  } catch {
    return null;
  }
}

function titleFrom(body: string): string {
  const first = String(body ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return first.replace(/^[*_📅💰🎯📊⚠️💛🔎\s]+|[*_]+$/g, "").slice(0, 140);
}

/**
 * O aviso mais recente, SÓ se for a última mensagem que o Nino enviou: se houve conversa depois,
 * "me explica melhor" fala da conversa, não do aviso antigo.
 */
export async function loadRecentProactive(
  sb: SupabaseClient,
  userId: string,
  nowMs: number = Date.now(),
): Promise<RecentProactive | null> {
  const since = new Date(nowMs - WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await sb.from("outbound_messages")
    .select("id,kind,body,metadata,created_at,status")
    .eq("user_id", userId)
    .gte("created_at", since)
    .in("status", ["sent", "accepted", "delivered", "read"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const row: any = data[0];
  if (!(PROACTIVE_OUTBOUND_KINDS as readonly string[]).includes(String(row.kind))) return null;
  const body = String(row.body ?? "").trim();
  if (!body) return null;
  const sentAt = new Date(row.created_at).getTime();
  const metadata = (row.metadata && typeof row.metadata === "object") ? row.metadata : {};
  const facts = trimJson(sanitizeProactiveFacts(metadata.evidence ?? null), FACTS_LIMIT);
  return {
    id: String(row.id),
    kind: String(row.kind),
    suggestion_kind: metadata.suggestion_kind ? String(metadata.suggestion_kind) : null,
    sent_at: new Date(sentAt).toISOString(),
    minutes_ago: Math.max(0, Math.round((nowMs - sentAt) / 60_000)),
    title: titleFrom(body),
    body: body.slice(0, BODY_LIMIT),
    facts,
  };
}

/** Bloco entregue ao interpretador: o aviso é o assunto do seguimento curto. */
export function proactiveContextBlock(recent: RecentProactive | null): Record<string, unknown> | null {
  if (!recent) return null;
  return {
    is_last_nino_message: true,
    kind: recent.kind,
    suggestion_kind: recent.suggestion_kind,
    minutes_ago: recent.minutes_ago,
    title: recent.title,
    text: recent.body.slice(0, 700),
  };
}

const brl = (n: number) => `R$ ${Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const dm = (iso: string) => { const [, mo, d] = String(iso).slice(0, 10).split("-"); return mo && d ? `${d}/${mo}` : String(iso); };

function signalLines(facts: any): string[] {
  const lines: string[] = [];
  const signals = Array.isArray(facts?.signals) ? facts.signals : [];
  for (const signal of signals.slice(0, 6)) {
    if (signal?.label) lines.push(`• ${String(signal.label)}`);
    const items = Array.isArray(signal?.evidence?.items) ? signal.evidence.items : [];
    for (const item of items.slice(0, 8)) {
      if (!item?.name || !Number.isFinite(Number(item.amount))) continue;
      lines.push(`   – ${item.date ? `${dm(item.date)} · ` : ""}${item.name}: ${brl(Number(item.amount))}${item.estimated ? " (estimado)" : ""}`);
    }
  }
  return lines;
}

/**
 * Corpo determinístico: o que foi dito e os fatos que sustentam. Se o compositor falhar ou for
 * barrado pela trava de números, é isto que a pessoa recebe — correto, só menos conversado.
 */
export function explainProactiveBody(recent: RecentProactive): string {
  const sent = new Date(recent.sent_at).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).replace(",", " às");
  const lines = [`Falei isso em ${sent}:`, "", recent.body];
  const support = signalLines(recent.facts);
  if (support.length) lines.push("", "O que sustenta o aviso:", ...support);
  return lines.join("\n").trim();
}

export const NO_RECENT_PROACTIVE_REPLY =
  "Não encontrei um aviso meu recente para explicar. Qual assunto você quer entender melhor?";
