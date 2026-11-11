// habit_kinds.v1 — comunicações do lado Hábitos (lembrete do gatilho e resumo do dia).
//
// Têm escopo PRÓPRIO na política de envio: não consomem a cota dos alertas financeiros (nem o contrário), não dependem do
// consentimento de "insight financeiro" (a pessoa liga/desliga em Hábitos), e repetem por chave (um lembrete por horário
// do dia), não por tipo. O teto geral de WhatsApp e o horário de silêncio continuam valendo para elas.
export const HABIT_KINDS = new Set<string>(["hb_cue_reminder", "hb_daily_recap", "hb_automaticity_due", "hb_streak_milestone", "hb_weekly_review"]);

export const isHabitKind = (kind: string): boolean => HABIT_KINDS.has(kind);

export type HabitQuota = { maxPerDay: number; maxPerWeek: number };

/** Teto duro da política (por contagem): 3 por dia. O limite pessoal `max_nudges_per_day` (padrão 2) é aplicado ao gerar. */
export const DEFAULT_HABIT_QUOTA: HabitQuota = { maxPerDay: 3, maxPerWeek: 21 };

export type CommScope = "habit" | "care" | "financial";
