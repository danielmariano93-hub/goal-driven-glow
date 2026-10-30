// SelfRepair (`nino_self_repair.v1`)
//
// Uma leitura que não pôde ser executada (sem motor para a combinação, trava de números barrando,
// plano sem execução declarada) ou uma falha transitória do provedor do interpretador não deve virar
// "não consegui" de primeira. O Nino tem UMA segunda tentativa, limitada, em que o interpretador
// recebe o motivo da falha e a lista do que é executável, e reformula a MESMA intenção.
//
// Regras que mantêm a segunda tentativa segura:
//   - no máximo uma tentativa por turno (sem laço);
//   - só vale se a nova execução NÃO tem erro; senão a pessoa recebe o resultado da primeira;
//   - a nova leitura passa pelos mesmos gates (preservação, grounding, cumprimento);
//   - nunca repara escrita, confirmação nem conversa.
import { executableOntologyText } from "./IRCapabilityAdapter.ts";

export const SELF_REPAIR_VERSION = "nino_self_repair.v1";

const REPAIRABLE_ERROR = /^(?:semantic_unsupported|semantic_gate_blocked|semantic_plan_invalid|executed_ir_missing)/;
const REPAIRABLE_ERROR_ANY = /unsupported_required_query|executed_ir_missing|semantic_gate_blocked/;

/** Falha de leitura que vale uma segunda tentativa (nunca escrita, conversa ou confirmação). */
export function isRepairableFailure(execution: {
  contract: { domain?: string | null; mode?: string | null };
  error?: string | null;
  reply_kind?: string | null;
}): boolean {
  if (execution.contract.domain !== "financial_read" || execution.contract.mode === "write") return false;
  const error = String(execution.error ?? "");
  if (!error) return false;
  return REPAIRABLE_ERROR.test(error) || REPAIRABLE_ERROR_ANY.test(error);
}

function reasonLabel(error: string): string {
  if (/unsupported_required_query/.test(error)) return "essa combinação de filtros e agrupamentos não tem motor";
  if (/gate_blocked|executed_ir_missing/.test(error)) return "o resultado não confirmou o que foi pedido";
  if (/plan_invalid/.test(error)) return "o plano não ficou consistente";
  return "a leitura não pôde ser executada";
}

/** Dica entregue ao interpretador na segunda tentativa (campo `repair_hint` do contexto). */
export function selfRepairHint(error: string): string {
  return [
    `A primeira leitura desta mensagem falhou: ${reasonLabel(error)} (${String(error).slice(0, 80)}).`,
    "Releia a mensagem original e reformule a MESMA intenção usando só combinações executáveis, por exemplo:",
    executableOntologyText(),
    "Se a pergunta pedir algo fora disso, devolva kind=conversation com uma resposta honesta que diga o que não dá para fazer e o que dá; nunca invente dado nem troque o assunto.",
  ].join("\n");
}

/**
 * Saída do interpretador rejeitada pelo validador (`contract_invalid:<campo>`): repetir o mesmo pedido a
 * temperatura 0 devolve a mesma saída. A nova tentativa diz qual campo falhou. null se não for este caso.
 */
export function contractRepairHint(error: string | null | undefined): string | null {
  const m = /contract_invalid:([\w.:\-]{1,100})/.exec(String(error ?? ""));
  if (!m) return null;
  return [
    `Sua saída anterior foi rejeitada pelo validador do esquema: ${m[1]}.`,
    "Emita de novo o JSON completo do esquema corrigindo exatamente isso: campos que não se aplicam à escolha feita ficam null; uma base de comparação por período usa baseline_period e baseline_months=null; uma média usa baseline_months e baseline_period=null.",
  ].join("\n");
}

/** Falha transitória do provedor do interpretador (vale uma nova tentativa idêntica). */
export function isTransientInterpreterFailure(error: string | null | undefined): boolean {
  return /structured_call_gateway_4\d\d|structured_call_gateway_5\d\d|semantic_tiers_unavailable|rate.?limit|429|timeout|temporarily/i
    .test(String(error ?? ""));
}
