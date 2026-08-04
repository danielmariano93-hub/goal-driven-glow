// Validação runtime dos contratos da inteligência unificada do Nino.
// Itens inválidos são descartados individualmente — nunca derrubam a seção inteira.
import { z } from "zod";

const actionSchema = z
  .object({ label: z.string().nullish(), route: z.string().nullish() })
  .partial()
  .nullable()
  .catch(null);

export const ninoItemSchema = z
  .object({
    id: z.string().nullable().catch(null),
    kind: z.string().catch("recommendation"),
    temporal_role: z.string().nullish(),
    status: z.string().nullish(),
    priority: z.number().nullish(),
    severity: z.string().catch("info"),
    title: z.string().min(1),
    summary: z.string().nullish().transform((v) => v ?? ""),
    explanation: z.string().nullish().transform((v) => v ?? ""),
    evidence: z.record(z.unknown()).nullable().catch(null),
    primary_action: actionSchema,
    secondary_action: actionSchema,
    source: z.string().nullish(),
    period: z.object({ start: z.string().nullable(), end: z.string().nullable() }).nullish(),
    valid_from: z.string().nullish(),
    valid_until: z.string().nullish(),
    confidence: z.number().nullish(),
    data_quality: z.string().nullish(),
    report_id: z.string().nullish(),
    dedup_key: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    acted_at: z.string().nullish(),
    dismissed_at: z.string().nullish(),
  })
  .passthrough();

export type NinoItemParsed = z.infer<typeof ninoItemSchema>;

/** Filtra e normaliza uma lista de itens; retorna também quantos foram descartados. */
export function parseItems(input: unknown): { items: NinoItemParsed[]; invalid: number } {
  if (!Array.isArray(input)) return { items: [], invalid: 0 };
  const items: NinoItemParsed[] = [];
  let invalid = 0;
  for (const raw of input) {
    const parsed = ninoItemSchema.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
    else invalid += 1;
  }
  return { items, invalid };
}

const dataQualitySchema = z
  .object({
    status: z.string().catch("ok"),
    uncategorized_count: z.number().catch(0),
    reason: z.string().nullish(),
  })
  .passthrough();

export const ninoContextSchema = z
  .object({
    ok: z.boolean().catch(true),
    as_of: z.string().nullish(),
    continuity_topic: z.string().nullable().catch(null),
    last_seen_at: z.string().nullable().catch(null),
    new_since_last_visit: z.number().catch(0),
    data_quality: dataQualitySchema.nullish(),
    error: z.string().nullish(),
  })
  .passthrough();

export type NinoContextEnvelope = z.infer<typeof ninoContextSchema>;

export const SECTION_KEYS = ["now", "changes", "learnings", "prepare", "history", "achievements"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type ParsedNinoContext = NinoContextEnvelope & {
  sections: Record<SectionKey, NinoItemParsed[]>;
  invalidItems: number;
};

export class NinoContractError extends Error {
  readonly kind = "contract" as const;
  constructor(message: string) {
    super(message);
    this.name = "NinoContractError";
  }
}

/** Parse tolerante do contrato completo do contexto do Nino. */
export function parseNinoContext(raw: unknown): ParsedNinoContext {
  if (!raw || typeof raw !== "object") throw new NinoContractError("Resposta vazia da inteligência do Nino.");
  const envelope = ninoContextSchema.safeParse(raw);
  if (!envelope.success) throw new NinoContractError("Formato inesperado na resposta da inteligência.");
  const record = raw as Record<string, unknown>;
  const sections = {} as Record<SectionKey, NinoItemParsed[]>;
  let invalidItems = 0;
  for (const key of SECTION_KEYS) {
    const parsed = parseItems(record[key]);
    sections[key] = parsed.items;
    invalidItems += parsed.invalid;
  }
  return { ...envelope.data, sections, invalidItems };
}

export const refreshResultSchema = z
  .object({
    ok: z.boolean().catch(true),
    at: z.string().nullish(),
    items: z.number().nullish(),
    counts: z
      .object({
        created: z.number().nullish(),
        updated: z.number().nullish(),
        superseded: z.number().nullish(),
        expired: z.number().nullish(),
        active_total: z.number().nullish(),
      })
      .partial()
      .nullish(),
    error: z.string().nullish(),
  })
  .passthrough();

export type RefreshResult = z.infer<typeof refreshResultSchema>;
