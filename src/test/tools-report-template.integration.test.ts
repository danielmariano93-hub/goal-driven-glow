import { describe, it, expect } from "vitest";
import {
  generate_report_from_template,
} from "../../supabase/functions/_shared/agent/tools";

// Stub minimalista do supabase-js chainable usado pelas tools.
function makeSb(opts: { tpl?: { template_key: string; active: boolean } | null; capture?: any[] }) {
  const capture = opts.capture ?? [];
  const emptyList = () => {
    const p: any = Promise.resolve({ data: [], error: null });
    return new Proxy(p, {
      get(target, prop) {
        if (prop === "then") return target.then.bind(target);
        return () => emptyList();
      },
    });
  };
  return {
    from(table: string) {
      if (table === "financial_report_templates") {
        return {
          select: () => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => ({ data: opts.tpl ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "agent_artifacts") {
        return {
          insert: (payload: any) => {
            capture.push({ table, payload });
            return {
              select: () => ({
                maybeSingle: async () => ({ data: { id: "artifact_stub" }, error: null }),
              }),
            };
          },
        };
      }
      // transactions, categories, etc.: retorno vazio bem-formado
      return {
        select: () => emptyList(),
        insert: () => emptyList(),
      };
    },
  } as any;
}

function makeCtx(sb: any) {
  return { sb, user_id: "user-1", conversation_id: "conv-1" } as any;
}

describe("generate_report_from_template — Zod + validação de estado", () => {
  it("rejeita template_key desconhecido", async () => {
    const sb = makeSb({});
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "does_not_exist" as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unknown_template");
  });

  it("rejeita params inválidos (metric fora do enum)", async () => {
    const sb = makeSb({ tpl: { template_key: "monthly_comparison", active: true } });
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "monthly_comparison",
      params: { metric: "foo" } as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("invalid_template_params");
      expect(r.details).toBeDefined();
    }
  });

  it("rejeita params com chaves extras (additionalProperties=false)", async () => {
    const sb = makeSb({ tpl: { template_key: "spending_trend", active: true } });
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "spending_trend",
      params: { random_key: "x" } as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_template_params");
  });

  it("rejeita params com formato de data inválido", async () => {
    const sb = makeSb({ tpl: { template_key: "spending_trend", active: true } });
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "spending_trend",
      params: { from: "07/01/2026" } as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_template_params");
  });

  it("retorna template_inactive quando o registro está desligado no banco", async () => {
    const sb = makeSb({ tpl: { template_key: "spending_trend", active: false } });
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "spending_trend",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("template_inactive");
  });

  it("retorna template_inactive quando o registro não existe", async () => {
    const sb = makeSb({ tpl: null });
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "monthly_comparison",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("template_inactive");
  });

  it("happy path monthly_comparison: gera artefato compare e persiste id", async () => {
    const capture: any[] = [];
    const sb = makeSb({ tpl: { template_key: "monthly_comparison", active: true }, capture });
    const r = await generate_report_from_template(makeCtx(sb), {
      template_key: "monthly_comparison",
      params: { metric: "income" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.artifact.kind).toBe("compare");
      expect(r.result.artifact_id).toBe("artifact_stub");
    }
    // Insert em agent_artifacts com formula_version presente
    expect(capture.length).toBe(1);
    expect(capture[0].payload.formula_version).toBeTypeOf("string");
  });
});
