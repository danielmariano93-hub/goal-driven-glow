import { describe, expect, it } from "vitest";
import { buildAttention, pctDelta, formatMs, errorLabel, type CommandCenterData } from "../lib/admin/commandCenter";

const base = (over: Partial<CommandCenterData["totals"]> = {}, rest: Partial<CommandCenterData> = {}): CommandCenterData => ({
  window_days: 7, generated_at: "2026-10-02T10:00:00Z", cost_note: "",
  totals: { turns: 100, turns_prev: 90, users: 5, users_prev: 5, err_rate: 0.02, err_rate_prev: 0.02, p50: 2000, p95: 6000, p50_prev: 2000, p95_prev: 6000, tin: 1, tout: 1, tok_prev: 1, cost: 0.1, cost_prev: 0.1, llm_share: 0.5, fallback_rate: 0.01, ...over },
  daily: [], by_path: [], by_model: [], by_channel: [], top_errors: [],
  messaging: { total: 50, sent: 50, delivered: 50, failed: 0, stuck_queue: 0, daily: [], fail_reasons: [] },
  ...rest,
});

describe("central de comando: o que exige ação", () => {
  it("quando está tudo bem, não inventa alerta", () => {
    expect(buildAttention(base())).toEqual([]);
  });
  it("taxa de falha alta vira alerta crítico com a maior causa", () => {
    const items = buildAttention(base({ err_rate: 0.3 }, { top_errors: [{ reason: "semantic_unsupported", n: 12, last_at: "", sample: null }] }));
    expect(items[0]).toMatchObject({ key: "error_rate", severity: "critical" });
    expect(items[0].detail).toContain("fora do que o Nino consegue consultar");
  });
  it("amostra pequena não dispara alarme de taxa", () => {
    expect(buildAttention(base({ turns: 8, err_rate: 0.5 }))).toEqual([]);
  });
  it("latência alta e fila travada ordenam do mais grave ao menos grave", () => {
    const items = buildAttention(base({ p95: 25_000 }, { messaging: { total: 50, sent: 49, delivered: 49, failed: 1, stuck_queue: 2, daily: [], fail_reasons: [{ reason: "timeout", n: 1 }] } }));
    expect(items.map((i) => i.severity)).toEqual(["critical", "critical", "warning"]);
    expect(items.some((i) => i.key === "stuck_queue")).toBe(true);
  });
  it("modelo com falha concentrada aponta para a rota de modelos", () => {
    const items = buildAttention(base({}, { by_model: [{ model_family: "gpt-oss 120b", turns: 50, p50: 1, p95: 1, tokens: 1, cost_usd: 0, error_rate: 0.3 }] }));
    expect(items.find((i) => i.key === "model_error")?.to).toBe("/admin/nino-ia?aba=modelos");
  });
  it("formatadores", () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(1, 0)).toBeNull();
    expect(formatMs(4464)).toBe("4,5 s");
    expect(errorLabel("algo_novo")).toBe("algo novo");
  });
});
