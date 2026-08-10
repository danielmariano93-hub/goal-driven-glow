import { describe, it, expect } from "vitest";
import {
  BANK_POSTING_SOURCES,
  isBankPostingSource,
  statementLineFingerprint,
} from "@/lib/ledger/statementIdentity";

// `bank_cash_truth.v1` — gates K e L.
describe("identidade de linha e de reupload de extrato", () => {
  const sha = "a".repeat(64);

  it("preserva gêmeos legítimos no MESMO extrato (duas Autopass de 5,40)", () => {
    const a = statementLineFingerprint({ documentSha256: sha, documentId: "doc-1", ordinal: 5, amount: 5.4 });
    const b = statementLineFingerprint({ documentSha256: sha, documentId: "doc-1", ordinal: 21, amount: 5.4 });
    expect(a).not.toBe(b);
  });

  it("reupload do MESMO arquivo com outro document_id mantém a mesma identidade", () => {
    const first = statementLineFingerprint({ documentSha256: sha, documentId: "doc-1", ordinal: 8, amount: 24.47 });
    const reupload = statementLineFingerprint({ documentSha256: sha, documentId: "doc-2", ordinal: 8, amount: 24.47 });
    expect(reupload).toBe(first);
  });

  it("arquivos diferentes nunca colidem", () => {
    const other = statementLineFingerprint({ documentSha256: "b".repeat(64), documentId: "doc-3", ordinal: 8, amount: 24.47 });
    const base = statementLineFingerprint({ documentSha256: sha, documentId: "doc-1", ordinal: 8, amount: 24.47 });
    expect(other).not.toBe(base);
  });

  it("sem hash estável cai para o documento (não perde identidade no import)", () => {
    const pending = statementLineFingerprint({ documentSha256: "pending:doc-1", documentId: "doc-1", ordinal: 2, amount: 10 });
    expect(pending).toBe("stmt:doc:doc-1:2:10.00");
  });

  it("contrato único de data bancária cobre statement/bank/ofx/reconciliation", () => {
    expect([...BANK_POSTING_SOURCES]).toEqual(["statement", "bank", "ofx", "reconciliation"]);
    for (const s of BANK_POSTING_SOURCES) expect(isBankPostingSource(s)).toBe(true);
    expect(isBankPostingSource("inferred")).toBe(false);
    expect(isBankPostingSource(null)).toBe(false);
  });
});
