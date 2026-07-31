import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("invoice atomic save and settlement contracts", () => {
  it("confirms review, transactions and statement in one database transaction", () => {
    const sql = read("supabase/migrations/20260731120000_invoice_atomic_save_and_statement_payment.sql");
    const edge = read("supabase/functions/assistant-review-actions/index.ts");
    expect(sql).toContain("confirm_invoice_import_atomic");
    expect(sql).toContain("invoice_items_failed");
    expect(sql).toContain("invoice_statement_failed");
    expect(sql).toContain("invoice_atomic_confirmed");
    expect(edge).toContain('rpc("confirm_invoice_import_atomic"');
    expect(edge).not.toContain('rpc("finalize_invoice_statement"');
  });

  it("settles cash and card liability without creating consumption again", () => {
    const sql = read("supabase/migrations/20260731120000_invoice_atomic_save_and_statement_payment.sql");
    expect(sql).toContain("settle_credit_card_statement");
    expect(sql).toContain("'card_payment'");
    expect(sql).toContain("credit_card_payment_allocations");
    expect(sql).toContain("p_idempotency_key");
  });

  it("makes MCP payment explicit and idempotent", () => {
    const server = read("src/lib/mcp/index.ts");
    const tool = read("src/lib/mcp/tools/settle-card-statement.ts");
    expect(server).toContain("settleCardStatement");
    expect(tool).toContain("confirmed_by_user");
    expect(tool).toContain("idempotency_key");
    expect(tool).toContain('rpc("settle_credit_card_statement"');
  });
});
