// CanonicalReadFallback (`nino_analytical.v3`)
//
// Degradação de EXECUÇÃO de um contrato já entendido — nunca reinterpretação.
//
// Causa-raiz: quando o IR não achava motor para a combinação pedida, o turno
// virava texto genérico ("me diga o período") mesmo existindo motor canônico
// capaz de responder o mesmo pedido num corte mais simples.
//
// Regras que este módulo não negocia:
// - o parser/roteador legado NUNCA é chamado aqui: a intenção já está entendida;
// - filtro pedido (categoria/cartão/conta/estabelecimento) jamais é descartado;
// - período pedido jamais é trocado;
// - se nada mapear, não há degradação: a resposta honesta explica QUAL parte não
//   é suportada.
import type { FinancialQueryIRv2, FinancialQueryV2 } from "./FinancialQueryIR.ts";
import { mappingForQuery, ontologySignature } from "./IRCapabilityAdapter.ts";

export type CanonicalDegradation = {
  version: "nino_analytical.v3";
  ir: FinancialQueryIRv2;
  /** Descrição auditável de cada degradação aplicada. */
  changes: string[];
};

function mapped(q: FinancialQueryV2, ir: FinancialQueryIRv2): boolean {
  return !!mappingForQuery(q, ir);
}

/** Alternativas de execução, da mais fiel para a mais simples. */
function candidatesFor(q: FinancialQueryV2): Array<{ query: FinancialQueryV2; change: string }> {
  const out: Array<{ query: FinancialQueryV2; change: string }> = [];
  const flow = q.metric === "expense_amount" || q.metric === "income_amount";

  // 1. Mesma dimensão, operação simples de valor.
  if ((q.group_by?.length ?? 0) > 0 && q.operation !== "breakdown") {
    out.push({
      query: { ...q, operation: "breakdown" },
      change: `${ontologySignature(q)} → breakdown na mesma dimensão`,
    });
  }
  // 2. Sem dimensão: total do recorte pedido, filtros preservados.
  if (flow) {
    out.push({
      query: { ...q, operation: "sum", group_by: [], limit: null },
      change: `${ontologySignature(q)} → total do recorte (sem dimensão)`,
    });
  } else {
    out.push({
      query: { ...q, operation: "value", group_by: [], limit: null },
      change: `${ontologySignature(q)} → leitura de valor`,
    });
  }
  return out;
}

/**
 * Degrada as queries sem motor para o motor canônico mais próximo do MESMO
 * pedido. `null` quando nem uma alternativa mapeia.
 */
export function degradeForCanonicalRead(ir: FinancialQueryIRv2 | null): CanonicalDegradation | null {
  if (!ir || ir.intent === "unsupported" || !ir.queries.length) return null;

  const changes: string[] = [];
  const queries: FinancialQueryV2[] = [];
  for (const q of ir.queries) {
    if (mapped(q, ir)) { queries.push(q); continue; }
    const candidate = candidatesFor(q).find((c) => mapped(c.query, ir));
    if (!candidate) return null;
    queries.push(candidate.query);
    changes.push(candidate.change);
  }
  if (!changes.length) return null;

  return {
    version: "nino_analytical.v3",
    ir: {
      ...ir,
      queries,
      // Alvo de completude segue o formato mais simples que passou a rodar.
      completeness_targets: (ir.completeness_targets ?? []).map((t) => {
        const q = queries.find((query) => query.id === t.query_id);
        if (!q) return t;
        const claim = q.operation === "breakdown" || q.operation === "rank" ? "rank" : "money";
        return { ...t, claim };
      }),
      assumptions: [...new Set([...ir.assumptions, ...changes])],
    },
    changes,
  };
}

/** Aviso curto e honesto que abre a resposta degradada. Sem número. */
export const CANONICAL_DEGRADED_NOTE =
  "Esse corte exato eu ainda não fecho com número confiável. O que eu consigo te afirmar com segurança é:";
