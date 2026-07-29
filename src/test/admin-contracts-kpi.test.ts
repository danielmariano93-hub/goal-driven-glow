import { describe, it, expect } from "vitest";
import { buildArgs, unsupportedArgs, ADMIN_RPC_ARGS } from "@/lib/admin/rpcContracts";
import { kpiMeta, kpiProvenance, hasEnoughSample, allKpiKeys } from "@/lib/admin/kpiRegistry";

describe("contratos de RPC administrativa", () => {
  it("remove argumentos que a função não declara (regressão do cockpit)", () => {
    const args = buildArgs("admin_v2_cockpit", {
      _from: "2026-07-01",
      _to: "2026-07-29",
      _tz: "America/Sao_Paulo",
    });
    expect(args).toEqual({ _from: "2026-07-01", _to: "2026-07-29" });
    expect(unsupportedArgs("admin_v2_cockpit", { _tz: "x" })).toEqual(["_tz"]);
  });

  it("preserva _tz em funções que o declaram", () => {
    const args = buildArgs("admin_v2_daily_evolution", {
      _from: "a",
      _to: "b",
      _tz: "America/Sao_Paulo",
    });
    expect(args._tz).toBe("America/Sao_Paulo");
  });

  it("descarta valores undefined para o banco aplicar o default", () => {
    expect(buildArgs("admin_v2_proactive_summary", { _days: 7, _channel: undefined })).toEqual({
      _days: 7,
    });
  });

  it("não filtra RPCs desconhecidas", () => {
    expect(buildArgs("rpc_inexistente", { qualquer: 1 })).toEqual({ qualquer: 1 });
  });

  it("toda RPC declarada tem lista de argumentos", () => {
    for (const [fn, args] of Object.entries(ADMIN_RPC_ARGS)) {
      expect(Array.isArray(args), fn).toBe(true);
    }
  });
});

describe("dicionário canônico de indicadores", () => {
  it("todo KPI declara universo, fórmula, período, fonte e exclusões", () => {
    for (const key of allKpiKeys()) {
      const meta = kpiMeta(key)!;
      expect(meta.universe.length).toBeGreaterThan(10);
      expect(meta.formula.length).toBeGreaterThan(10);
      expect(meta.period.length).toBeGreaterThan(3);
      expect(meta.source).toBeTruthy();
      expect(Array.isArray(meta.exclusions)).toBe(true);
    }
  });

  it("indicadores de cliente excluem admins e contas de teste", () => {
    const meta = kpiMeta("total_users")!;
    expect(meta.exclusions.join(" ")).toContain("Administradores");
    expect(meta.exclusions.join(" ")).toContain("teste");
  });

  it("proveniência é texto de negócio, sem nome técnico de tabela", () => {
    const text = kpiProvenance("wvu")!;
    expect(text).toContain("Universo:");
    expect(text).not.toMatch(/select|from |_v_|::/i);
  });

  it("amostra insuficiente derruba o KPI para 'ainda aprendendo'", () => {
    expect(hasEnoughSample("wvu", { sample_size: 1, sufficient_sample: false })).toBe(false);
    expect(hasEnoughSample("wvu", { sample_size: 30, sufficient_sample: true })).toBe(true);
  });
});
