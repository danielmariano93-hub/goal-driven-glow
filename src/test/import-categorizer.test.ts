import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = {
  candidates: [
    { id: "transport", name: "Transporte", slug: "transporte" },
    { id: "food", name: "Alimentação", slug: "alimentacao" },
  ],
  aliases: [],
  history: [],
  preferences: [{ merchant_key: "padaria do ze", category_id: "food", evidence_count: 4 }],
  globalKnowledge: [],
  thresholds: { AUTO: 0.85, SUGGEST: 0.6, per_source: { rule: 0.75, history: 0.85, alias: 0.98, llm: 0.75 } },
};

vi.mock("../../supabase/functions/_shared/categorization/engine", async (orig) => {
  const real = await (orig() as Promise<Record<string, unknown>>);
  return { ...real, loadCategorizationContext: vi.fn(async () => JSON.parse(JSON.stringify(ctx))) };
});
vi.mock("../../supabase/functions/_shared/categorization/personalHistory", () => ({
  derivePersonalPreferencesFromHistory: vi.fn(async () => []),
}));

import { buildImportCategorizer } from "../../supabase/functions/_shared/categorization/importCategorizer";

describe("categorização de itens de importação (mesma camada do Nino)", () => {
  let categorize: Awaited<ReturnType<typeof buildImportCategorizer>>;
  beforeEach(async () => {
    categorize = await buildImportCategorizer({}, "u1", [
      { type: "expense", movement_kind: "transaction", description: "Uber *trip" },
      { type: "income", movement_kind: "refund", description: "Estorno de compra débito Uber *trip Help.uber.com" },
      { type: "expense", movement_kind: "transaction", description: "Padaria do Ze" },
    ]);
  });

  it("marca canônica conhecida (Uber) sai categorizada, sem 'Sem categoria'", () => {
    expect(categorize({ type: "expense", movement_kind: "transaction", description: "Uber *trip" })?.category_id).toBe("transport");
  });

  it("estorno herda a categoria do gasto original (Uber → Transporte)", () => {
    expect(categorize({ type: "income", movement_kind: "refund", description: "Estorno de compra débito Uber *trip Help.uber.com" })?.category_id).toBe("transport");
  });

  it("preferência pessoal do usuário vale", () => {
    const pick = categorize({ type: "expense", movement_kind: "transaction", description: "Padaria do Ze" });
    expect(pick?.category_id).toBe("food");
  });

  it("movimento patrimonial nunca recebe categoria de consumo", () => {
    for (const kind of ["card_payment", "investment_redemption", "external_transfer_out", "internal_transfer", "loan_proceeds"]) {
      expect(categorize({ type: "expense", movement_kind: kind, description: "Uber *trip" })).toBeNull();
    }
  });

  it("desconhecido continua para revisão (sem chute)", () => {
    expect(categorize({ type: "expense", movement_kind: "transaction", description: "Loja Zxqv 123" })).toBeNull();
  });
});

import { readFileSync } from "node:fs";
describe("integração do lote com o categorizador", () => {
  it("stageBatch usa o categorizador central e a importação de PDF trata estorno como gasto original", () => {
    const stage = readFileSync("supabase/functions/_shared/import/stage.ts", "utf8");
    expect(stage).toContain("buildImportCategorizer");
    expect(stage).toContain("picked?.category_id ??");
    const ingest = readFileSync("supabase/functions/assistant-ingest-document/index.ts", "utf8");
    expect(ingest).toContain("isRefundLine");
  });
});

import { classifyWithContext } from "../../supabase/functions/_shared/categorization/engine";
describe("descrições reais do extrato (Itaú via Open Finance) que vinham em branco", () => {
  const cats = ["Transporte", "Alimentação", "Lazer", "Mercado", "Assinaturas"].map((name, i) => ({ id: `c${i}`, name, slug: name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") }));
  const idOf = (name: string) => cats.find((c) => c.name === name)!.id;
  const run = (description: string) => classifyWithContext(
    { type: "expense", description, movement_kind: "transaction" },
    { candidates: cats, aliases: [], history: [], preferences: [], globalKnowledge: [], thresholds: ctx.thresholds },
  );
  const cases: Array<[string, string]> = [
    ["Compra débito 99 Tecnologia*99* Pop 02o", "Transporte"],
    ["Compra débito 99 Tecnologia*99* 99*", "Transporte"],
    ["Compra débito Web Visa Dl 99 99 0510", "Transporte"],
    ["Pix QR Code pago no WhatsApp CINEMARK BRASIL", "Lazer"],
    ["Compra débito Kee*don Girardi Pizz", "Alimentação"],
    ["Compra débito Wesk Comercio De Doces", "Alimentação"],
    ["Compra débito 99 Food 12/10", "Alimentação"],
  ];
  for (const [description, expected] of cases) {
    it(`${description} → ${expected} (aplicado automaticamente)`, () => {
      const r = run(description);
      expect(r.category_id).toBe(idOf(expected));
      expect(r.action).toBe("auto_apply");
    });
  }
});
