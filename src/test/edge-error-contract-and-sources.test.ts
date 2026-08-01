import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toEdgeFailure, failureDescription } from "@/lib/edge/invoke";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const http = read("supabase/functions/_shared/http.ts");
const doc = read("docs/FINANCIAL_SOURCES.md");

const WIRED = [
  "agent-chat",
  "whatsapp-webhook",
  "assistant-ingest-document",
  "assistant-review-actions",
  "insights-generate",
  "pulse-compute",
  "finance-backfill-runner",
];

describe("E7 — contrato de erro das Edge Functions", () => {
  it("define ok:false, error_code, retryable e request_id", () => {
    expect(http).toContain('export const ERROR_CONTRACT_VERSION = "edge_error.v1"');
    expect(http).toContain("ok: false");
    expect(http).toContain("error_code: errorCode");
    expect(http).toContain("retryable");
    expect(http).toContain("request_id: requestId");
  });

  it("persiste incidente em falhas 5xx e financeiras", () => {
    expect(http).toContain('from("edge_incidents")');
    expect(http).toContain("FINANCIAL_ERROR_CODES");
    expect(http).toContain("status >= 500 || FINANCIAL_ERROR_CODES.has(errorCode)");
  });

  it("as funções financeiras e de mensagem usam o helper", () => {
    for (const fn of WIRED) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src, fn).toContain('from "../_shared/http.ts"');
      expect(src, fn).toContain("fail(");
    }
  });

  it("nenhuma função devolve ok:true carregando erro", () => {
    for (const fn of WIRED) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src.match(/ok:\s*true,\s*error:/), fn).toBeNull();
    }
  });

  it("normaliza falhas legadas e expõe referência de suporte", () => {
    const legacy = toEdgeFailure({ error: "not_found" }, 404);
    expect(legacy.error_code).toBe("not_found");
    expect(legacy.retryable).toBe(false);

    const contract = toEdgeFailure(
      { error_code: "atomic_confirmation_failed", message: "Nada foi salvo.", retryable: false, request_id: "abcd1234-xyz" },
      422,
    );
    expect(contract.message).toBe("Nada foi salvo.");
    expect(failureDescription(contract)).toContain("abcd1234");

    const serverSide = toEdgeFailure({}, 500);
    expect(serverSide.retryable).toBe(true);
  });
});

describe("E8 — classificação das fontes financeiras", () => {
  it("classifica o núcleo de cartão e transações como ativo", () => {
    for (const table of [
      "transactions",
      "credit_card_statements",
      "credit_card_statement_items",
      "credit_card_installments",
      "credit_card_payment_reversals",
      "document_imports",
      "extracted_items",
      "edge_incidents",
    ]) {
      expect(doc, table).toContain(`\`${table}\``);
    }
    expect(doc).toContain("card_exposure.v1");
    expect(doc).toContain("spending_rhythm.v3");
    expect(doc).toContain("edge_error.v1");
  });

  it("marca as fontes aposentadas para impedir uso novo", () => {
    expect(doc).toContain("| `recurring_entries` | substituída");
    expect(doc).toContain("| `import_batches`, `import_rows` | legada");
  });
});
