// Acknowledgement (`nino_brain.v2`) — aviso de espera contextual e calibrado.
//
// Antes o WhatsApp mandava sempre a mesma frase em 4s fixos. Aqui o atraso vem
// da latência REAL observada nos turnos recentes do usuário (p75) e o texto
// descreve o que o Nino está fazendo de fato. Nunca prometemos resultado:
// apenas informamos o que está em curso.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AckPlan = {
  /** Quando enviar o aviso. */
  delay_ms: number;
  /** Texto do aviso, ligado ao que está sendo feito. */
  message: string;
  /** p75 observado (ms) — null quando não há histórico. */
  observed_p75_ms: number | null;
};

const MIN_DELAY_MS = 3_000;
const MAX_DELAY_MS = 9_000;

/** Frase por natureza do pedido — determinística, sem jargão técnico. */
export function ackMessageFor(text: string): string {
  const t = String(text ?? "").toLowerCase();
  if (/\b(gr[aá]fico|visualiza|em barras|em pizza|em linha)\b/.test(t)) {
    return "Só um instante — estou montando o gráfico com seus números 📊";
  }
  if (/\b(importa|extrato|planilha|pdf|fatura|print|comprovante|foto)\b/.test(t)) {
    return "Recebi — estou lendo os lançamentos um por um antes de te mostrar 🧾";
  }
  if (/\b(previs[aã]o|fecha|fechamento|proje|vai sobrar|vou fechar)\b/.test(t)) {
    return "Só um instante — estou projetando o fechamento do seu mês 🔎";
  }
  if (/\b(compar|evolu|tend[eê]ncia|m[eê]s passado|antes)\b/.test(t)) {
    return "Só um instante — estou comparando os dois períodos 🔎";
  }
  if (/\b(quanto|gastei|onde|categoria|estabelecimento|saldo)\b/.test(t)) {
    return "Só um instante — estou somando seus lançamentos do período 🔎";
  }
  return "Só um instante — já estou com isso 👀";
}

function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

/**
 * Calibra o aviso pela latência real: se os turnos recentes do usuário levam
 * ~7s, avisar em 4s é ruído; se levam 2s, nem precisa avisar tão cedo.
 * O aviso é agendado em ~60% do p75, dentro de 3s..9s.
 */
export async function planAcknowledgement(
  sb: SupabaseClient,
  args: { user_id: string; text: string },
): Promise<AckPlan> {
  const message = ackMessageFor(args.text);
  let observed: number | null = null;
  try {
    const { data } = await sb.from("agent_runs")
      .select("latency_ms")
      .eq("user_id", args.user_id)
      .not("latency_ms", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    observed = percentile((data ?? []).map((r: any) => Number(r.latency_ms)), 0.75);
  } catch { /* sem histórico: usa o default */ }

  const target = observed ? Math.round(observed * 0.6) : 4_000;
  const delay_ms = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, target));
  return { delay_ms, message, observed_p75_ms: observed };
}
