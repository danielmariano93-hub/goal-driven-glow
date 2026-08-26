// Contratos de read model e invariantes de campo obrigatório.
// CASO G do plano: snapshot v2 NUNCA pode ser servido como v3.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertRequiredFields, assertSnapshotContract, READ_MODEL_CONTRACTS } from "@/lib/db/snapshotContract";
import {
  dataContractViolations,
  resetDataContractViolations,
  resolveRequiredLabel,
} from "@/lib/observability/dataContract";

beforeEach(() => {
  resetDataContractViolations();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("contrato de snapshot", () => {
  it("aceita o contrato esperado", () => {
    const res = assertSnapshotContract({ contract_version: "home_snapshot.v3" }, READ_MODEL_CONTRACTS.homeSnapshot, "home");
    expect(res.ok).toBe(true);
  });

  it("rejeita v2 quando o consumidor espera v3 e registra violação", () => {
    const res = assertSnapshotContract({ contract_version: "home_snapshot.v2" }, READ_MODEL_CONTRACTS.homeSnapshot, "home");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("contract_mismatch");
    expect(dataContractViolations().snapshot_contract_mismatch).toBe(1);
  });

  it("payload sem contrato nunca é fresco", () => {
    const res = assertSnapshotContract({ contract_version: null }, READ_MODEL_CONTRACTS.homeSnapshot, "home");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("missing_contract");
  });

  it("payload vazio degrada sem violação de contrato", () => {
    const res = assertSnapshotContract(null, READ_MODEL_CONTRACTS.homeSnapshot, "home");
    expect(res.ok).toBe(false);
    expect(dataContractViolations().snapshot_contract_mismatch).toBeUndefined();
  });

  it("campo obrigatório ausente é observável", () => {
    expect(assertRequiredFields({ a: 1, b: null }, ["a", "b"], "performance")).toBe(false);
    expect(dataContractViolations().read_model_missing_required_field).toBe(1);
    expect(assertRequiredFields({ a: 1, b: 2 }, ["a", "b"], "performance")).toBe(true);
  });
});

describe("invariante de rótulo obrigatório", () => {
  it("CASO A/B — id válido com nome resolvido exibe o nome", () => {
    const label = resolveRequiredLabel({
      kind: "category_name_missing", surface: "CategoryGoalCard",
      id: "cat-global", name: "Alimentação", fallback: "Categoria",
    });
    expect(label).toBe("Alimentação");
    expect(dataContractViolations().category_name_missing).toBeUndefined();
  });

  it("CASO C — id presente sem nome usa fallback neutro E registra violação", () => {
    const label = resolveRequiredLabel({
      kind: "category_name_missing", surface: "CategoryGoalCard",
      id: "cat-fantasma", name: null, fallback: "Categoria",
    });
    expect(label).toBe("Categoria");
    expect(dataContractViolations().category_name_missing).toBe(1);
  });

  it("sem id não há violação — não existe categoria para nomear", () => {
    resolveRequiredLabel({ kind: "category_name_missing", surface: "x", id: null, name: null, fallback: "Categoria" });
    expect(dataContractViolations().category_name_missing).toBeUndefined();
  });
});
