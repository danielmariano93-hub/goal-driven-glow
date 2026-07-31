import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("edição de fatura e régua do rolê", () => {
  it("expõe edição econômica, aprovação e exclusão segura da fatura", () => {
    const page = read("src/pages/Cartoes.tsx");
    expect(page).toContain("p_amount: patch.amount");
    expect(page).toContain("p_occurred_at: patch.occurred_at");
    expect(page).toContain("p_item_kind: patch.item_kind");
    expect(page).toContain('rpc("approve_credit_card_statement"');
    expect(page).toContain('rpc("discard_credit_card_statement"');
    expect(page).toContain("Aprovar fatura");
    expect(page).toContain("Excluir fatura");
  });

  it("mostra somente vencimento e último lembrete no dia seguinte", () => {
    const journey = read("src/components/admin/SplitReminderJourney.tsx");
    expect(journey).toContain('title="No vencimento"');
    expect(journey).toContain('title="1 dia depois"');
    expect(journey).toContain("sem novas cobranças");
    expect(journey).not.toContain("Dias antes");
    expect(journey).not.toContain("Repetir a cada");
    expect(journey).not.toContain("Máximo de cobranças");
  });
});