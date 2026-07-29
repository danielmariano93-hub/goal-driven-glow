// Regressão: notificação bancária terminando em "Conta corrente" (sem nome do
// banco) deve registrar direto quando o usuário tem uma única conta ativa, em
// vez de o Nino perguntar "Em qual conta eu registro?".
import { describe, it, expect } from "vitest";
import { extractSpans } from "@/lib/agent/extract";
import { resolveEntity } from "@/lib/agent/resolvers";

const NOTIFICACAO = [
  "Compra aprovada",
  "Valor R$ 5,40",
  "Estabelecimento Autopass S.A. - ATM Tmob",
  "Data 29/07/2026 11:31",
  "Conta corrente",
].join("\n");

describe("FastLog — conta genérica/única", () => {
  it("extrai método 'account' com hint vazio na notificação bancária", () => {
    const spans = extractSpans(NOTIFICACAO);
    expect(spans.amount).toBe(5.4);
    expect(spans.payment_method).toBe("account");
    expect(spans.account_hint ?? "").toBe("");
  });

  it("hint vazio resolve para a conta única do usuário", () => {
    const r = resolveEntity("", [{ id: "a1", name: "Conta Corrente" }]);
    expect(r.kind).toBe("single");
    if (r.kind === "single") expect(r.match.id).toBe("a1");
  });

  it("hint vazio com múltiplas contas fica ambíguo (aí sim perguntamos)", () => {
    const r = resolveEntity("", [
      { id: "a1", name: "Conta Corrente" },
      { id: "a2", name: "Nubank" },
    ]);
    expect(r.kind).toBe("multiple");
  });

  it("hint com nome do banco continua resolvendo por nome", () => {
    const spans = extractSpans(NOTIFICACAO.replace("Conta corrente", "Conta Corrente Itaú"));
    expect(spans.payment_method).toBe("account");
    const r = resolveEntity(spans.account_hint ?? "", [
      { id: "a1", name: "Conta Corrente" },
      { id: "a2", name: "Itaú" },
    ]);
    expect(r.kind).toBe("single");
    if (r.kind === "single") expect(r.match.id).toBe("a2");
  });
});
