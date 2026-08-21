// PONTE DE COMPATIBILIDADE — a implementação canônica vive no núcleo
// (`src/lib/engine/recurringSchedule.ts`) para ser espelhada nas Edge Functions
// pelo `scripts/sync-finance-core.mjs`. App e servidor calculam a MESMA data.
export type { Frequency, RecurringRule } from "@/lib/engine/recurringSchedule";
export { nextOccurrences, nextOccurrenceFor } from "@/lib/engine/recurringSchedule";
