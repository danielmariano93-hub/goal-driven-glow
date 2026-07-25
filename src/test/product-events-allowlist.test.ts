import { describe, it, expect } from "vitest";

// Simula o comportamento da allowlist definida em
// supabase/migrations/20260724133602_*.sql (tabela product_event_types)
// + a migration aditiva 20260725050000_product_events_allowlist_user_registered.sql.
// Não toca no banco: valida o contrato canônico.

const CANONICAL_ALLOWLIST = new Set([
  "financial_entry_created",
  "financial_entry_edited",
  "financial_entry_categorized",
  "goal_created",
  "goal_progress_recorded",
  "split_created",
  "split_participant_paid",
  "split_reminder_scheduled",
  "ocr_document_uploaded",
  "ocr_document_confirmed",
  "agent_response_delivered",
  "insight_delivered",
  "forecast_delivered",
  "personalized_response_delivered",
  "goal_progress_explained",
  "split_result_delivered",
  "split_reminder_prepared",
  "whatsapp_message_sent",
  "whatsapp_message_delivered",
  "whatsapp_message_read",
]);

function applyAdditiveMigration(base: Set<string>): Set<string> {
  const next = new Set(base);
  // INSERT ... ON CONFLICT DO NOTHING
  if (!next.has("user_registered")) next.add("user_registered");
  return next;
}

describe("product_events allowlist — additive migration", () => {
  it("preserva os 20 eventos canônicos originais", () => {
    const after = applyAdditiveMigration(CANONICAL_ALLOWLIST);
    for (const name of CANONICAL_ALLOWLIST) {
      expect(after.has(name)).toBe(true);
    }
    expect(after.size).toBe(CANONICAL_ALLOWLIST.size + 1);
  });

  it("aceita user_registered após a migration", () => {
    const before = new Set(CANONICAL_ALLOWLIST);
    expect(before.has("user_registered")).toBe(false);
    const after = applyAdditiveMigration(before);
    expect(after.has("user_registered")).toBe(true);
  });

  it("continua rejeitando eventos fora do contrato", () => {
    const after = applyAdditiveMigration(CANONICAL_ALLOWLIST);
    expect(after.has("foo_bar_baz")).toBe(false);
    expect(after.has("random_event")).toBe(false);
  });

  it("é idempotente: aplicar duas vezes não altera o conjunto", () => {
    const once = applyAdditiveMigration(CANONICAL_ALLOWLIST);
    const twice = applyAdditiveMigration(once);
    expect(twice.size).toBe(once.size);
    expect([...twice].sort()).toEqual([...once].sort());
  });
});
