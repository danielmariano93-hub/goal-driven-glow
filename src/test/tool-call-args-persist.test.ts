import { describe, expect, it } from "vitest";
import { boundedArgs, persistV2ToolCalls } from "../../supabase/functions/_shared/agent/core/V2EvidencePersistence";

describe("argumentos das ferramentas gravados para diagnóstico", () => {
  it("argumentos pequenos ficam inteiros (caso real: valor '10,80' que não virou número)", () => {
    const args = { type: "expense", amount: "10,80", description: "Autopass" };
    expect(boundedArgs(args)).toEqual(args);
  });
  it("argumento enorme vira só as chaves; valor que não é objeto vira vazio", () => {
    const big = { text: "x".repeat(5000), amount: 1 };
    expect(boundedArgs(big)).toEqual({ args_truncated: true, keys: ["text", "amount"] });
    expect(boundedArgs(null)).toEqual({});
    expect(boundedArgs("texto")).toEqual({});
  });
  it("referência circular não derruba o turno", () => {
    const a: any = {}; a.self = a;
    expect(boundedArgs(a)).toEqual({ args_unserializable: true });
  });
  it("a falha é gravada com argumentos e motivo (ok=false, error=needs_amount)", async () => {
    let inserted: any[] = [];
    const sb: any = { from: () => ({ insert: (rows: any[]) => { inserted = rows; return { select: () => Promise.resolve({ data: rows.map((_, i) => ({ id: `id${i}`, step_index: i })), error: null }) }; } }) };
    await persistV2ToolCalls(sb, "run1", [{ tool_name: "create_transaction_draft", args: boundedArgs({ amount: "10,80" }), ok: false, error: "needs_amount" }]);
    expect(inserted[0]).toMatchObject({ run_id: "run1", tool_name: "create_transaction_draft", args: { amount: "10,80" }, ok: false, error: "needs_amount" });
  });
});
