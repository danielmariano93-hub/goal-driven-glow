import { describe, it, expect } from "vitest";
import { normalizeBrPhone, maskBrPhone } from "@/lib/phone";

describe("normalizeBrPhone", () => {
  it("accepts +55 with mobile 11 digits", () => {
    expect(normalizeBrPhone("+55 11 91234-5678")).toBe("+5511912345678");
  });
  it("accepts local with 0 trunk prefix", () => {
    expect(normalizeBrPhone("011 91234-5678")).toBe("+5511912345678");
  });
  it("expands 10-digit mobile to 9-prefix", () => {
    expect(normalizeBrPhone("11 91234-5678")).toBe("+5511912345678");
  });
  it("keeps landline 10 digits (no 9 prefix injected for 2-5)", () => {
    expect(normalizeBrPhone("11 3123-4567")).toBe("+551131234567");
  });
  it("rejects too-short numbers", () => {
    expect(normalizeBrPhone("12345")).toBeNull();
  });
  it("rejects empty", () => {
    expect(normalizeBrPhone("")).toBeNull();
  });
  it("masks phone showing only last 4", () => {
    expect(maskBrPhone("+5511912345678")).toBe("+55 (**) *****-5678");
  });
});
