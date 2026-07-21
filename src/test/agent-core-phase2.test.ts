// Fase 2 — Agent Core pure-logic tests.
// Mirrors the pattern used elsewhere in the project: pure helpers are
// duplicated here (identical to the Deno-side implementation) so vitest
// can exercise them without pulling Supabase/Deno-only modules.
import { describe, it, expect } from "vitest";

// --------- mirrors of ResponseValidator ------------------------------------
const FRIENDLY = "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";
const MAX_REPLY_LEN = 4000;
type ValidationContext = {
  hasDraft?: boolean;
  expectedKind?: "receipt" | "draft" | "question" | "info" | "cancelled" | "expired";
  toolCallErrors?: number;
};
const DRAFT_LANGUAGE_RX = /\b(rascunho|proposta)\b.*\b(confirmar|confirma|registrar|registro|criar|criei|salvar)\b|\b(posso|vou|quer que eu)\s+(criar|crie|registrar|registre|salvar|salve)\b/i;
function validate(raw: string, ctx: ValidationContext = {}) {
  const reasons: string[] = [];
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) { reasons.push("empty_reply"); return { action: "fallback_deterministic", body: FRIENDLY, reasons }; }
  if (/^\s*[\[{]/.test(trimmed) && trimmed.length > 40) {
    try { JSON.parse(trimmed); reasons.push("json_leak"); } catch { reasons.push("malformed_json_leak"); }
    return { action: "regenerate", body: trimmed.slice(0, MAX_REPLY_LEN), reasons };
  }
  if (ctx.expectedKind === "receipt" && ctx.hasDraft === false) {
    reasons.push("receipt_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY, reasons };
  }
  if (ctx.hasDraft === false && DRAFT_LANGUAGE_RX.test(trimmed)) {
    reasons.push("draft_language_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY, reasons };
  }
  if ((ctx.toolCallErrors ?? 0) >= 2) {
    reasons.push("too_many_tool_errors");
    return { action: "fallback_deterministic", body: FRIENDLY, reasons };
  }
  const body = trimmed.length > MAX_REPLY_LEN ? trimmed.slice(0, MAX_REPLY_LEN) : trimmed;
  return { action: "accept", body, reasons };
}

// --------- mirrors of ErrorRecovery ----------------------------------------
function classifyError(e: unknown) {
  const s = String((e as any)?.message ?? e ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/timeout|abort|fetch failed|econnreset|econnrefused|gateway_5\d\d|429|rate limit/.test(s)) return "transient";
  if (/invalid|missing|schema|required|malformed|bad_json/.test(s)) return "validation";
  if (/forbidden|unauthorized|not allowed|permission|rls/.test(s)) return "permission";
  if (/not_found|no rows|does not exist/.test(s)) return "not_found";
  return "unknown";
}
const isRetryable = (e: unknown) => classifyError(e) === "transient";

// --------- mirrors of ToolRuntime (dedupKey + withTimeout) -----------------
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as any).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}
const dedupKey = (n: string, a: unknown) => n + ":" + stableStringify(a);
function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tool_timeout_${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// --------- mirrors of ActionPlanner.dedupePlan -----------------------------
type Step = { tool_name: string; args: Record<string, unknown> };
function dedupePlan(steps: Step[]): Step[] {
  const seen = new Set<string>(); const out: Step[] = [];
  for (const s of steps) {
    const k = dedupKey(s.tool_name, s.args);
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

// --------- mirrors of Observability ----------------------------------------
function estimateCost(model: string, tokensIn: number, tokensOut: number) {
  const per1K_in = model.includes("gpt-5") ? 0.005 : model.includes("gemini") ? 0.0005 : 0.001;
  const per1K_out = per1K_in * 3;
  return +(tokensIn / 1000 * per1K_in + tokensOut / 1000 * per1K_out).toFixed(6);
}

// ===========================================================================
describe("Fase 2 — ResponseValidator.validate", () => {
  it("accepts a normal reply", () => {
    const r = validate("Registrei R$ 42,90 no almoço. ✅");
    expect(r.action).toBe("accept"); expect(r.reasons).toEqual([]);
  });
  it("empty → deterministic fallback", () => {
    const r = validate("   ");
    expect(r.action).toBe("fallback_deterministic");
    expect(r.body).toContain("problema");
  });
  it("JSON leak → regenerate", () => {
    const r = validate('{"amount": 42, "description": "almoço no restaurante do centro"}');
    expect(r.action).toBe("regenerate");
    expect(r.reasons).toContain("json_leak");
  });
  it("receipt without draft → fallback", () => {
    const r = validate("✅ Registrado", { expectedKind: "receipt", hasDraft: false });
    expect(r.action).toBe("fallback_deterministic");
  });
  it("draft language without persisted draft → fallback", () => {
    const r = validate("Posso criar um rascunho de R$ 11,89 para você confirmar?", { expectedKind: "info", hasDraft: false });
    expect(r.action).toBe("fallback_deterministic");
    expect(r.reasons).toContain("draft_language_without_draft");
  });
  it("too many tool errors → fallback", () => {
    const r = validate("Feito!", { toolCallErrors: 3 });
    expect(r.action).toBe("fallback_deterministic");
  });
  it("truncates over-length replies", () => {
    const long = "a".repeat(5000);
    const r = validate(long);
    expect(r.body.length).toBe(4000);
  });
});

describe("Fase 2 — ErrorRecovery.classifyError", () => {
  it("classifies known families", () => {
    expect(classifyError(new Error("fetch failed"))).toBe("transient");
    expect(classifyError(new Error("429 rate limit"))).toBe("transient");
    expect(classifyError(new Error("invalid schema"))).toBe("validation");
    expect(classifyError(new Error("forbidden by RLS"))).toBe("permission");
    expect(classifyError(new Error("no rows found"))).toBe("not_found");
    expect(classifyError(new Error("weird thing"))).toBe("unknown");
  });
  it("retryable ↔ transient", () => {
    expect(isRetryable(new Error("timeout"))).toBe(true);
    expect(isRetryable(new Error("invalid"))).toBe(false);
  });
});

describe("Fase 2 — ToolRuntime helpers", () => {
  it("dedupKey is stable across arg-key order", () => {
    expect(dedupKey("t", { a: 1, b: 2 })).toBe(dedupKey("t", { b: 2, a: 1 }));
    expect(dedupKey("t", { a: 1 })).not.toBe(dedupKey("t", { a: 2 }));
  });
  it("withTimeout rejects if slow", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/tool_timeout/);
  });
  it("withTimeout resolves if fast", async () => {
    await expect(withTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
  });
});

describe("Fase 2 — ActionPlanner.dedupePlan", () => {
  it("drops duplicate steps by (tool, args) signature", () => {
    const steps: Step[] = [
      { tool_name: "list_recent_transactions", args: { limit: 5 } },
      { tool_name: "list_recent_transactions", args: { limit: 5 } },
      { tool_name: "list_recent_transactions", args: { limit: 10 } },
    ];
    expect(dedupePlan(steps)).toHaveLength(2);
  });
});

describe("Fase 2 — Observability.estimateCost", () => {
  it("orders of magnitude are plausible", () => {
    const gpt = estimateCost("openai/gpt-5-mini", 1000, 500);
    const gem = estimateCost("google/gemini-2.5-flash", 1000, 500);
    expect(gpt).toBeGreaterThan(gem);
    expect(gem).toBeGreaterThan(0);
  });
  it("scales with tokens", () => {
    const a = estimateCost("google/gemini-2.5-flash", 100, 100);
    const b = estimateCost("google/gemini-2.5-flash", 1000, 1000);
    expect(b).toBeGreaterThan(a);
  });
});
