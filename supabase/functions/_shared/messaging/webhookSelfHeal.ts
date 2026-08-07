// Decisão pura de autorreparo do webhook WAHA.
//
// Regras (fail-closed):
//  - nunca agir em estado transitório (STARTING, SCAN_QR_CODE, STOPPING…);
//  - nunca agir sem sessão existente/autenticada;
//  - no máximo 1 mutação por janela de cooldown;
//  - reparar só quando a validação canônica aponta divergência real.

export const SELF_HEAL_COOLDOWN_MS = 15 * 60_000;
export const SELF_HEAL_MAX_ATTEMPTS_PER_WINDOW = 1;

export const TRANSIENT_SESSION_STATES = [
  "STARTING", "SCAN_QR_CODE", "STOPPING", "RESTARTING", "PAIRING",
];

export type SelfHealInput = {
  configured: boolean;
  authOk: boolean;
  sessionExists: boolean;
  sessionStatus: string | null;
  webhookCode: string;
  lastRepairAt: string | null;
  attemptsInWindow?: number;
  nowMs?: number;
  cooldownMs?: number;
};

export type SelfHealDecision = {
  shouldRepair: boolean;
  reason:
    | "webhook_ok"
    | "not_configured"
    | "unauthorized"
    | "session_missing"
    | "transient_state"
    | "cooldown_active"
    | "max_attempts"
    | "repair_needed";
};

export function decideSelfHeal(input: SelfHealInput): SelfHealDecision {
  const now = input.nowMs ?? Date.now();
  const cooldown = input.cooldownMs ?? SELF_HEAL_COOLDOWN_MS;

  if (input.webhookCode === "ok") return { shouldRepair: false, reason: "webhook_ok" };
  if (!input.configured) return { shouldRepair: false, reason: "not_configured" };
  if (!input.authOk) return { shouldRepair: false, reason: "unauthorized" };
  if (!input.sessionExists) return { shouldRepair: false, reason: "session_missing" };

  const status = String(input.sessionStatus ?? "").toUpperCase();
  if (!status || TRANSIENT_SESSION_STATES.includes(status)) {
    return { shouldRepair: false, reason: "transient_state" };
  }

  if (input.lastRepairAt) {
    const last = Date.parse(input.lastRepairAt);
    if (Number.isFinite(last) && now - last < cooldown) {
      return { shouldRepair: false, reason: "cooldown_active" };
    }
  }
  if ((input.attemptsInWindow ?? 0) >= SELF_HEAL_MAX_ATTEMPTS_PER_WINDOW) {
    return { shouldRepair: false, reason: "max_attempts" };
  }

  return { shouldRepair: true, reason: "repair_needed" };
}

/** Resultado do reparo: só é `webhook_repaired` quando a REVALIDAÇÃO passa.
 *  PUT 2xx com pós-validação divergente é `webhook_repair_failed`. */
export function classifyRepairOutcome(args: {
  mutationOk: boolean;
  revalidatedWebhookCode: string | null;
  revalidatedSessionStatus: string | null;
}): { outcome: "webhook_repaired" | "webhook_repair_failed"; healthy: boolean } {
  const healthy = args.revalidatedWebhookCode === "ok"
    && String(args.revalidatedSessionStatus ?? "").toUpperCase() === "WORKING";
  if (!args.mutationOk || !healthy) return { outcome: "webhook_repair_failed", healthy: false };
  return { outcome: "webhook_repaired", healthy: true };
}
