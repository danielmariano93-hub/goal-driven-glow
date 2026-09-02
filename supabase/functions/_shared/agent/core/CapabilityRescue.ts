// CapabilityRescue (`nino_semantic_ir.v3`)
//
// Causa-raiz: a LLM às vezes escreve "não tenho acesso a isso" mesmo quando o IR
// mapeou motor canônico E a execução trouxe evidência. Negar capacidade que o
// registry tem é mentira sobre o produto. Aqui a negação falsa é detectada e
// substituída pelo texto determinístico da evidência.
import { capabilityByTool } from "./CapabilityRegistry.ts";

const DENIAL_RX = [
  /n[ãa]o\s+(?:tenho|possuo)\s+(?:acesso|permiss[ãa]o|como)/i,
  /n[ãa]o\s+consigo\s+(?:acessar|ver|consultar|calcular)/i,
  /n[ãa]o\s+tenho\s+(?:essa|as)\s+informa[çc][õo]es/i,
  /(?:infelizmente|no momento)[^.]{0,40}n[ãa]o\s+(?:posso|consigo)/i,
  /fora\s+d[ao]\s+minha\s+capacidade/i,
];

export type CapabilityRescueResult = {
  version: "nino_capability_rescue.v1";
  rescued: boolean;
  reason: string | null;
  engines: string[];
  text: string;
};

export function isFalseDenial(text: string): boolean {
  const t = String(text ?? "");
  return DENIAL_RX.some((rx) => rx.test(t));
}

/**
 * `engines` são as tools que realmente rodaram com sucesso neste turno.
 * Só há resgate quando existe capacidade registrada E evidência determinística
 * disponível — sem isso, a negação pode ser verdadeira e é preservada.
 */
export function rescueCapabilityDenial(args: {
  reply: string;
  engines: string[];
  deterministic_text: string | null;
}): CapabilityRescueResult {
  const engines = [...new Set((args.engines ?? []).filter(Boolean))];
  const known = engines.filter((tool) => capabilityByTool(tool) !== null);
  const base: CapabilityRescueResult = {
    version: "nino_capability_rescue.v1",
    rescued: false,
    reason: null,
    engines: known,
    text: args.reply,
  };
  if (!isFalseDenial(args.reply)) return base;
  if (!known.length) return { ...base, reason: "no_registered_capability" };
  const deterministic = String(args.deterministic_text ?? "").trim();
  if (!deterministic) return { ...base, reason: "no_deterministic_text" };
  return {
    ...base,
    rescued: true,
    reason: "false_capability_denial",
    text: deterministic,
  };
}
