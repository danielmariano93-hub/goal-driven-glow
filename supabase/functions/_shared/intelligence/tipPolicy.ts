// tipPolicy — política única de seleção das "Dicas do Nino".
// Módulo puro: sem I/O, testável no vitest e reutilizável no Deno.
//
// Responsabilidades:
//  - derivar family + dedup_key determinísticos para cada dica candidata;
//  - aplicar cooldown por dedup_key ("Agora não"), por kind ("não útil")
//    e por família (diversidade obrigatória);
//  - escolher a dica de maior prioridade elegível.

export type TipFamily =
  | "categorizacao"
  | "metas"
  | "evolucao"
  | "recorrencias"
  | "gastos"
  | "emocoes"
  | "habitos"
  | "geral";

export type TipCandidate = {
  type: string;
  title: string;
  body: string;
  cta_label: string;
  cta_route: string;
  model: string;
};

export type LedgerRow = {
  kind: string;
  family?: string | null;
  dedup_key?: string | null;
  created_at: string;
  feedback?: string | null;
  status?: string | null;
};

export type TipPolicyConfig = {
  /** "Agora não" silencia aquele dedup_key por N dias. */
  dismissCooldownDays: number;
  /** "não útil" silencia o kind inteiro por N dias. */
  notUsefulCooldownDays: number;
  /** diversidade: mesma família no máximo 1x a cada N horas. */
  familyCooldownHours: number;
  /** intervalo mínimo entre duas dicas quaisquer geradas. */
  minGapMinutes: number;
};

export const DEFAULT_TIP_POLICY: TipPolicyConfig = {
  dismissCooldownDays: 7,
  notUsefulCooldownDays: 30,
  familyCooldownHours: 72,
  minGapMinutes: 30,
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

const UUID_RX = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Prioridade base por tipo. Categorização é deliberadamente baixa para não
 *  monopolizar a Home (era short-circuit incondicional antes). */
const BASE_PRIORITY: Record<string, number> = {
  onboarding: 300,
  alert: 240,
  opportunity: 170,
  celebration: 150,
  habit: 120,
  categorize_transaction: 80,
};

export function familyForTip(candidate: Pick<TipCandidate, "type" | "cta_route">): TipFamily {
  if (candidate.type === "categorize_transaction") return "categorizacao";
  const route = candidate.cta_route ?? "";
  if (route.startsWith("/app/metas")) return "metas";
  if (route.startsWith("/app/recorrencias")) return "recorrencias";
  if (route.startsWith("/app/relatorios")) return "evolucao";
  if (route.startsWith("/app/emocoes")) return "emocoes";
  if (route.startsWith("/app/cartoes")) return "gastos";
  if (route.startsWith("/app/lancamentos")) return candidate.type === "habit" ? "habitos" : "gastos";
  return "geral";
}

export function slugify(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Chave estável por assunto — nunca inclui valores monetários voláteis. */
export function dedupKeyForTip(candidate: TipCandidate): string {
  if (candidate.type === "categorize_transaction") {
    const match = UUID_RX.exec(candidate.cta_route ?? "");
    return `categorize:${match ? match[1] : slugify(candidate.title)}`;
  }
  return `${candidate.type}:${slugify(candidate.title)}`;
}

export function priorityForTip(candidate: TipCandidate): number {
  return BASE_PRIORITY[candidate.type] ?? 100;
}

export type TipDecision = {
  candidate: TipCandidate;
  family: TipFamily;
  dedup_key: string;
  score: number;
  eligible: boolean;
  reason: string;
};

function ms(value: string): number {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Avalia todas as candidatas contra o histórico unificado. */
export function evaluateTips(
  candidates: TipCandidate[],
  ledger: LedgerRow[],
  opts: { now?: Date; config?: Partial<TipPolicyConfig> } = {},
): TipDecision[] {
  const now = (opts.now ?? new Date()).getTime();
  const cfg = { ...DEFAULT_TIP_POLICY, ...(opts.config ?? {}) };

  const dismissedUntil = new Map<string, number>();
  const notUsefulUntil = new Map<string, number>();
  const familyLast = new Map<string, number>();
  const resolvedKeys = new Set<string>();

  for (const row of ledger) {
    const at = ms(row.created_at);
    const key = row.dedup_key ?? "";
    if (row.feedback === "not_useful") {
      notUsefulUntil.set(row.kind, Math.max(notUsefulUntil.get(row.kind) ?? 0, at + cfg.notUsefulCooldownDays * DAY));
    }
    if (key && (row.feedback === "dismissed" || row.status === "dismissed")) {
      dismissedUntil.set(key, Math.max(dismissedUntil.get(key) ?? 0, at + cfg.dismissCooldownDays * DAY));
    }
    if (key && row.status === "resolved") resolvedKeys.add(key);
    const fam = row.family ?? "geral";
    familyLast.set(fam, Math.max(familyLast.get(fam) ?? 0, at));
  }

  return candidates.map((candidate) => {
    const family = familyForTip(candidate);
    const dedup_key = dedupKeyForTip(candidate);
    let eligible = true;
    let reason = "eligible";
    let score = priorityForTip(candidate);

    if (resolvedKeys.has(dedup_key)) {
      eligible = false;
      reason = "already_resolved";
    } else if ((dismissedUntil.get(dedup_key) ?? 0) > now) {
      eligible = false;
      reason = "dismiss_cooldown";
    } else if ((notUsefulUntil.get(candidate.type) ?? 0) > now) {
      eligible = false;
      reason = "not_useful_cooldown";
    } else {
      const last = familyLast.get(family) ?? 0;
      const elapsed = now - last;
      if (last > 0 && elapsed < cfg.familyCooldownHours * HOUR) {
        eligible = false;
        reason = "family_diversity_cooldown";
      } else if (last > 0) {
        // recência suave: famílias inéditas há mais tempo sobem no ranking.
        score += Math.min(60, Math.floor(elapsed / (7 * DAY)) * 20);
      } else {
        score += 40;
      }
    }

    return { candidate, family, dedup_key, score, eligible, reason };
  });
}

export type TipSelection = {
  chosen: TipDecision | null;
  evaluated: TipDecision[];
  relaxed: boolean;
};

/** Escolhe a melhor dica. Se nada for elegível, relaxa apenas a regra de
 *  diversidade (nunca os cooldowns de feedback do usuário). */
export function selectTip(
  candidates: TipCandidate[],
  ledger: LedgerRow[],
  opts: { now?: Date; config?: Partial<TipPolicyConfig> } = {},
): TipSelection {
  const evaluated = evaluateTips(candidates, ledger, opts);
  const eligible = evaluated.filter((item) => item.eligible).sort((a, b) => b.score - a.score);
  if (eligible.length > 0) {
    return { chosen: eligible[0], evaluated, relaxed: false };
  }
  const relaxed = evaluated
    .filter((item) => item.reason === "family_diversity_cooldown")
    .sort((a, b) => b.score - a.score);
  return { chosen: relaxed[0] ?? null, evaluated, relaxed: relaxed.length > 0 };
}

/** Respeita a janela mínima entre gerações — impede "dispensou → gerou outra". */
export function canGenerateNow(
  lastGeneratedAt: string | null | undefined,
  opts: { now?: Date; config?: Partial<TipPolicyConfig> } = {},
): boolean {
  if (!lastGeneratedAt) return true;
  const cfg = { ...DEFAULT_TIP_POLICY, ...(opts.config ?? {}) };
  const now = (opts.now ?? new Date()).getTime();
  return now - ms(lastGeneratedAt) >= cfg.minGapMinutes * 60_000;
}
