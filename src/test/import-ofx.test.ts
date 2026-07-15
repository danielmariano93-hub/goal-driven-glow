import { describe, it, expect } from "vitest";
import { parseOfx } from "@/lib/import/ofx";

describe("parseOfx", () => {
  it("extrai transações e FITID", () => {
    const ofx = `
<OFX>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260201120000
<TRNAMT>-89.90
<FITID>TX001
<MEMO>Mercado
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260205
<TRNAMT>5000.00
<FITID>TX002
<NAME>Salario
</STMTTRN>
</OFX>`;
    const r = parseOfx(ofx);
    expect(r).toHaveLength(2);
    expect(r[0].fitid).toBe("TX001");
    expect(r[0].amount).toBeCloseTo(-89.9);
    expect(r[0].occurred_at).toBe("2026-02-01");
    expect(r[0].description).toBe("Mercado");
    expect(r[1].fitid).toBe("TX002");
    expect(r[1].external_id).toBe("ofx:TX002");
  });

  it("retorna array vazio para OFX sem transações", () => {
    expect(parseOfx("<OFX></OFX>")).toEqual([]);
  });
});
