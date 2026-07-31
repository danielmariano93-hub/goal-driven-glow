import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("jornadas completas de produto", () => {
  it("unifica plano e aprendizado do Nino em uma só experiência", () => {
    const app = read("src/App.tsx");
    const menu = read("src/pages/MaisMenu.tsx");
    const hub = read("src/pages/NinoHub.tsx");
    expect(app).toContain('path="assessor/acompanhamento" element={<NinoHub />}');
    expect(app).toContain('path="nino-contexto" element={<NinoContextoV2 />}');
    expect(menu).toContain("Meu Nino");
    expect(menu).not.toContain('label: "O que o Nino aprendeu"');
    expect(hub).toContain("AssessorAcompanhamentoV2");
    expect(hub).not.toContain("O que aprendeu");
    expect(hub).toContain("/app/nino-contexto");
  });

  it("oferece detalhe, edição, baixa e reversão na fatura", () => {
    const cards = read("src/pages/Cartoes.tsx");
    expect(cards).toContain("Ver e editar fatura");
    expect(cards).toContain("update_credit_card_statement_item");
    expect(cards).toContain("reverse_credit_card_statement_payment");
    expect(cards).toContain("Registrar pagamento desta fatura");
  });

  it("reverte pagamento de forma atômica e auditável", () => {
    const sql = read("supabase/migrations/20260731213000_statement_detail_edit_and_payment_reversal.sql");
    expect(sql).toContain("credit_card_payment_reversals");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("payment_snapshot");
    expect(sql).toContain("DELETE FROM public.transactions");
    expect(sql).toContain("GRANT EXECUTE");
    expect(sql).toContain("auth.uid()");
  });

  it("expõe no admin modelos, conhecimento e régua visual do rolê", () => {
    const app = read("src/App.tsx");
    const communications = read("src/pages/admin/ComunicacaoProativa.tsx");
    const ai = read("src/pages/admin/NinoIA.tsx");
    expect(app).toContain('path="nino-ia"');
    expect(communications).toContain("SplitReminderJourney");
    expect(communications).toContain("Jornadas");
    expect(ai).toContain("Modelos");
    expect(ai).toContain("Conhecimento");
  });
});
