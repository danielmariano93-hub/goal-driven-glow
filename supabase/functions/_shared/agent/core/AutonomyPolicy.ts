// AutonomyPolicy (`nino_agent.v1`) — o que o Nino executa sozinho.
//
// Regra do produto: leitura e análise são livres; escrita de baixo risco e
// totalmente especificada pode ser executada direto (fast path); escrita de
// risco médio/alto SEMPRE passa por rascunho + confirmação explícita.
// Nada aqui toca o banco: é decisão pura, auditável e testável.

import { riskOfTool, capabilityByTool, type RiskLevel } from "./CapabilityRegistry.ts";

export type AutonomyMode = "auto_execute" | "draft_then_confirm" | "refuse";

export type AutonomyDecision = {
  mode: AutonomyMode;
  risk: RiskLevel;
  reason: string;
  /** Pergunta de confirmação quando `draft_then_confirm`. */
  confirm_hint: string | null;
};

export type AutonomyInput = {
  tool: string;
  /** Todos os campos obrigatórios estão preenchidos e resolvidos? */
  complete: boolean;
  /** Usuário já disse explicitamente "registra/confirma" neste turno. */
  user_explicit: boolean;
  /** Turno veio de um gatilho proativo (o usuário não pediu nada). */
  proactive?: boolean;
  /** Valor envolvido, quando houver. */
  amount?: number | null;
};

/** Acima disso, mesmo escrita "simples" pede confirmação explícita. */
export const HIGH_VALUE_BRL = 1000;

export function decideAutonomy(input: AutonomyInput): AutonomyDecision {
  const tool = String(input.tool ?? "").trim();
  const entry = capabilityByTool(tool);
  const risk = riskOfTool(tool);

  if (!entry) {
    return { mode: "refuse", risk: "read_only", reason: "capability_unknown", confirm_hint: null };
  }
  if (!entry.writes) {
    return { mode: "auto_execute", risk, reason: "read_only", confirm_hint: null };
  }
  if (input.proactive) {
    return {
      mode: "draft_then_confirm", risk, reason: "proactive_write_requires_confirmation",
      confirm_hint: "Quer que eu registre isso por você?",
    };
  }
  if (!input.complete) {
    return { mode: "draft_then_confirm", risk, reason: "incomplete_slots", confirm_hint: null };
  }
  const amount = Number(input.amount ?? 0);
  if (Number.isFinite(amount) && Math.abs(amount) >= HIGH_VALUE_BRL) {
    return {
      mode: "draft_then_confirm", risk, reason: "high_value",
      confirm_hint: "Confirma que eu registro esse valor?",
    };
  }
  if (risk === "high" || risk === "medium") {
    return {
      mode: "draft_then_confirm", risk, reason: `risk_${risk}`,
      confirm_hint: risk === "high" ? "Isso altera algo já registrado. Confirma?" : "Fecho assim?",
    };
  }
  if (input.user_explicit) {
    return { mode: "auto_execute", risk, reason: "low_risk_explicit_request", confirm_hint: null };
  }
  return { mode: "draft_then_confirm", risk, reason: "low_risk_without_explicit_request", confirm_hint: "Fecho assim?" };
}
