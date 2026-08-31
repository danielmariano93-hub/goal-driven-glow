// EvidenceReconciliation (`nino_evidence.v1`) — a LLM não escolhe evidência.
//
// Causa-raiz que este módulo fecha: num único turno duas ferramentas
// responderam perguntas diferentes (uma julho × junho global, outra o recorte
// pedido) e o modelo escolheu o headline errado — R$ 36 mil de um período que
// ninguém pediu. Aqui a evidência divergente é REJEITADA de forma
// determinística antes de sustentar qualquer número na resposta.
// deno-lint-ignore-file no-explicit-any
import type { AnalysisScope } from "./ScopeResolver.ts";

export type EvidenceRejection = {
  tool_name: string;
  reason: "scope_global_under_scoped_intent" | "period_mismatch";
  detail: string;
};

export type ReconciliationReport = {
  kept: any[];
  rejected: Array<{ call: any } & EvidenceRejection>;
  /** Valores em reais que SÓ existem em evidência rejeitada. */
  poisoned_values: number[];
};

function periodOf(result: any): { from: string; to: string } | null {
  const p = result?.evidence?.current_period ?? result?.period ?? result?.current_period ?? null;
  const from = String(p?.from ?? "").slice(0, 10);
  const to = String(p?.to ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { from, to } : null;
}

function scopeOf(result: any): string {
  return String(result?.scope ?? result?.aggregate?.scope ?? "");
}

/** Todos os valores monetários presentes num resultado (varredura rasa e profunda). */
export function moneyValues(value: unknown, depth = 0): number[] {
  if (depth > 6) return [];
  if (typeof value === "number") return Number.isFinite(value) ? [Math.abs(Math.round(value * 100) / 100)] : [];
  if (Array.isArray(value)) return value.flatMap((v) => moneyValues(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((v) => moneyValues(v, depth + 1));
  }
  return [];
}

const CLOSE = 0.5;
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= CLOSE;
}

export function reconcileEvidence(args: {
  toolCalls: any[];
  scope: AnalysisScope | null;
  period: { from: string; to: string } | null;
}): ReconciliationReport {
  const calls = (args.toolCalls ?? []).filter((c) => c && c.ok !== false);
  const kept: any[] = [];
  const rejected: Array<{ call: any } & EvidenceRejection> = [];
  const scopeLocked = Boolean(args.scope?.locked) && (args.scope?.entity_ids?.length ?? 0) > 0;

  for (const call of calls) {
    const result = (call as any).result;
    const tool_name = String((call as any).tool_name ?? "");
    const s = scopeOf(result);

    // Gate de escopo herdado: o usuário falava de categorias concretas e a
    // ferramenta devolveu agregado global — evidência inutilizável.
    if (scopeLocked && s === "overall") {
      rejected.push({
        call, tool_name, reason: "scope_global_under_scoped_intent",
        detail: `escopo travado em ${args.scope!.entity_ids.length} categoria(s), resultado global`,
      });
      continue;
    }

    // Gate de conflito de período: evidência de outro recorte não sustenta a
    // resposta deste turno.
    const p = periodOf(result);
    if (args.period && p && (p.from !== args.period.from || p.to !== args.period.to)) {
      rejected.push({
        call, tool_name, reason: "period_mismatch",
        detail: `evidência ${p.from}..${p.to} contra período do turno ${args.period.from}..${args.period.to}`,
      });
      continue;
    }

    kept.push(call);
  }

  const keptValues = kept.flatMap((c) => moneyValues((c as any).result));
  const poisoned = new Set<number>();
  for (const r of rejected) {
    for (const v of moneyValues((r.call as any).result)) {
      if (v >= 100 && !keptValues.some((k) => near(k, v))) poisoned.add(v);
    }
  }

  return { kept, rejected, poisoned_values: [...poisoned] };
}

/** Valores em reais citados no texto (formato pt-BR). */
export function citedValues(text: string): number[] {
  const out: number[] = [];
  const rx = /R\$\s*([\d.]+(?:,\d{2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(String(text ?? ""))) !== null) {
    const n = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n)) out.push(Math.abs(Math.round(n * 100) / 100));
  }
  return out;
}

/**
 * A resposta está contaminada quando cita um valor que só existe em evidência
 * rejeitada. Nesse caso é PROIBIDO entregar o texto.
 */
export function replyUsesRejectedEvidence(reply: string, report: ReconciliationReport): boolean {
  if (!report.poisoned_values.length) return false;
  const cited = citedValues(reply);
  return cited.some((v) => report.poisoned_values.some((p) => near(p, v)));
}

export const EVIDENCE_CONFLICT_REPLY =
  "Eu tinha duas leituras diferentes aqui e nenhuma delas responde exatamente o que você perguntou — "
  + "não vou te entregar um número de outro recorte como se fosse o seu. "
  + "Me confirme as categorias e o período que você quer comparar que eu refaço a conta na sua base.";
