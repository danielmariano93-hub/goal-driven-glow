import { describe, expect, it } from "vitest";
import { adminErrorMessage, withDateRange, withPeriod } from "./adminRpc";

const range = { from: "2026-07-01", to: "2026-07-30" };

describe("admin RPC contracts", () => {
  it("uses only _from and _to for RPCs without timezone argument", () => {
    expect(withDateRange(range)).toEqual({
      _from: "2026-07-01",
      _to: "2026-07-30",
    });
  });

  it("uses the canonical timezone only for RPCs that declare _tz", () => {
    expect(withPeriod(range)).toEqual({
      _from: "2026-07-01",
      _to: "2026-07-30",
      _tz: "America/Sao_Paulo",
    });
  });

  it("preserves extra RPC arguments", () => {
    expect(withPeriod(range, { _limit: 200 })).toMatchObject({
      _limit: 200,
      _tz: "America/Sao_Paulo",
    });
  });

  it("exposes useful PostgREST diagnostics", () => {
    expect(adminErrorMessage(
      { message: "Function not found", details: "signature mismatch", code: "PGRST202" },
      "fallback",
    )).toContain("PGRST202");
  });
});
