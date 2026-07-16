import { describe, it, expect } from "vitest";
import { mapWahaValidate } from "@/lib/admin/statusMapper";

describe("mapWahaValidate", () => {
  it("maps known codes with sanitized labels (no urls/secrets/env names)", () => {
    const codes = [
      "ok", "unreachable", "unauthorized", "session_missing",
      "webhook_missing", "webhook_mismatch", "not_configured", "status_error",
    ] as const;
    const forbidden = /(https?:\/\/|WAHA|X-Api-Key|Bearer|sk_|token|secret)/i;
    for (const c of codes) {
      const v = mapWahaValidate(c);
      expect(v.label).toBeTruthy();
      expect(v.label).not.toMatch(forbidden);
      if (v.impact) expect(v.impact).not.toMatch(forbidden);
    }
  });

  it("falls back safely for unknown codes", () => {
    const v = mapWahaValidate("something_unexpected");
    expect(v.label).toBeTruthy();
    expect(v.tone).toBeDefined();
  });
});
