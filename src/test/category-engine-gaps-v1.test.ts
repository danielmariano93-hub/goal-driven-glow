import { describe, expect, it } from "vitest";
import { decideCategoryDeterministic, shouldAutoApply, type CategoryCandidate } from "../../supabase/functions/_shared/categorization/pipeline";
import { normalizedPattern } from "../../supabase/functions/_shared/categorization/normalize";
import { materializePreferencesFromHistory } from "../../supabase/functions/_shared/categorization/personalHistory";

// Categorias globais reais + as pessoais do usuário que tem Dízimo e Beleza.
const GLOBAL: CategoryCandidate[] = [
  "Alimentação", "Assinaturas", "Educação", "Impostos e Taxas", "Lazer", "Mercado", "Moradia", "Outros",
  "Pets", "Presentes", "Saúde", "Serviços", "Transporte", "Vestuário", "Beleza",
].map((name) => ({ id: name, name, user_id: null }));
const WITH_TITHE: CategoryCandidate[] = [
  ...GLOBAL,
  { id: "Dízimo", name: "Dízimo", user_id: "u" },
  { id: "Beleza", name: "Beleza", user_id: "u" },
];

const decide = (description: string, candidates = GLOBAL) =>
  decideCategoryDeterministic({ description, candidates, aliases: [], history: [], preferences: [], globalKnowledge: [] });
const THRESHOLDS = { AUTO: 0.85, SUGGEST: 0.6, per_source: { rule: 0.75, history: 0.85, alias: 0.98, llm: 0.75 } };

describe("datas coladas no extrato não quebram a identidade do favorecido", () => {
  it("o mesmo Pix em meses diferentes vira a mesma chave", () => {
    expect(normalizedPattern("PIX TRANSF VERA LU26/01")).toBe(normalizedPattern("PIX TRANSF VERA LU27/03"));
    expect(normalizedPattern("PIX WHATS PAMELA 04/06")).toBe("pamela");
    expect(normalizedPattern("PIX QRS SHPP BRASIL18/03")).toBe(normalizedPattern("pix qrs shpp brasil27/02"));
  });
});

describe("lançamentos reais que ficaram sem categoria agora se resolvem", () => {
  const auto = [
    ["LOGOALI MERCADO EXPRES", "Lazer"],
    ["AUGUSTA", "Lazer"],
    ["PAY AUGUS 1502", "Lazer"],
    ["MP*BLACKZONE", "Beleza"],
    ["BLACK ZONE JARDIM PAULI", "Beleza"],
    ["LOGOALI MERCADO EXPRESSO", "Lazer"],
    ["Pão de Açúcar", "Mercado"],
    ["MINI EXTRA-0103", "Mercado"],
    ["OXXO VILELA GEON", "Mercado"],
    ["KFC SH SP CENTER 3", "Alimentação"],
    ["EXPRESS GRILL TATUAPE", "Alimentação"],
    ["RESTAURANTE E CHURRASC", "Alimentação"],
    ["G5 DROGARIAS LTDA", "Saúde"],
    ["PANVEL FARMACIAS", "Saúde"],
    ["AUTO POSTO EWAMARO L2", "Transporte"],
    ["CHACRINHA POSTO DE SER", "Transporte"],
    ["CEA AGT 129 ECPC", "Vestuário"],
    ["Wet'n Wild - São Paulo", "Lazer"],
    ["INT /ELETROPAULO 1933971", "Moradia"],
    ["PIX QRS SABESP23/04", "Moradia"],
    ["PAY -TELHA NORTE", "Moradia"],
  ] as const;
  for (const [description, category] of auto) {
    it(`${description} → ${category} (aplica sozinho)`, () => {
      const decision = decide(description);
      expect(decision?.category_id).toBe(category);
      expect(shouldAutoApply(decision, THRESHOLDS)).toBe(true);
    });
  }

  it("igreja vira Dízimo para quem tem a categoria, e nada para quem não tem", () => {
    const withTithe = decide("PIX TRANSF IGREJA 04/03", WITH_TITHE);
    expect(withTithe?.category_id).toBe("Dízimo");
    expect(shouldAutoApply(withTithe, THRESHOLDS)).toBe(true);
    expect(decide("PIX TRANSF IGREJA 04/03")).toBeNull();
  });

  it("sinais fracos viram sugestão, não aplicação automática", () => {
    for (const description of ["LIFEDRINKS", "MP*BARDAESQUINAR BAR", "SUCOS COPA LIMA L", "JINGSHIMASSAGENS", "ADEGA"]) {
      const decision = decide(description, WITH_TITHE);
      expect(decision, description).not.toBeNull();
      expect(shouldAutoApply(decision, THRESHOLDS), description).toBe(false);
    }
  });

  it("falsos positivos conhecidos não acontecem", () => {
    expect(decide("RIO PRAIA COMERCIO E S")?.category_id ?? null).not.toBe("Saúde");
    expect(decide("MERCADO LIVRE")?.category_id ?? null).not.toBe("Mercado");
    expect(decide("PIX WHATS PAMELA 04/06")).toBeNull();
  });
});

describe("histórico da pessoa vira preferência (só o que ELA decidiu)", () => {
  const row = (description: string, category_id: string, category_source = "user") =>
    ({ description, category_id, category_source, type: "expense" as const });

  it("mesmo favorecido 2+ vezes na mesma categoria vira preferência", () => {
    const prefs = materializePreferencesFromHistory([
      row("PIX TRANSF IGREJA 04/01", "Dízimo"),
      row("PIX TRANSF IGREJA 02/02", "Dízimo"),
      row("PIX TRANSF IGREJA 01/03", "Dízimo", "legacy"),
    ]);
    expect(prefs).toEqual([{ merchant_key: "igreja", category_id: "Dízimo", evidence_count: 3, transaction_type: "expense" }]);
  });

  it("uma vez só, histórico dividido ou categoria dada por regra não viram verdade", () => {
    expect(materializePreferencesFromHistory([row("PADARIA X", "Alimentação")])).toEqual([]);
    expect(materializePreferencesFromHistory([
      row("LOJA Y", "Lazer"), row("LOJA Y", "Mercado"), row("LOJA Y", "Lazer"),
    ])).toEqual([]);
    expect(materializePreferencesFromHistory([
      row("LOJA Z", "Lazer", "rule"), row("LOJA Z", "Lazer", "llm"), row("LOJA Z", "Lazer", "global"),
    ])).toEqual([]);
  });
});

import { counterpartyDisplayName, parseCounterpartyGroups } from "@/lib/categories/counterparties";

describe("organizar por favorecido", () => {
  it("nomeia o grupo do jeito que a pessoa reconhece", () => {
    expect(counterpartyDisplayName("pamela", "PIX Pamela", "expense")).toBe("Pix para Pamela");
    expect(counterpartyDisplayName("henriqu", "PIX Henriqu", "income")).toBe("Pix de Henriqu");
    expect(counterpartyDisplayName("logoali mercado expres", "LOGOALI MERCADO EXPRES", "expense")).toBe("Logoali Mercado Expres");
  });

  it("descarta linhas inválidas do banco", () => {
    const groups = parseCounterpartyGroups([
      { counterparty_key: "pamela", label: "PIX Pamela", transaction_type: "expense", transactions: 11, total: "2090.00" },
      { counterparty_key: "", transaction_type: "expense" },
      { counterparty_key: "x", transaction_type: "transfer" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "expense:pamela", total: 2090, direction: "pago" });
  });
});

import { resolveVisibleCategories } from "@/lib/db/finance";

describe("categoria pessoal de mesmo nome sobrepõe a global", () => {
  it("\"Beleza\" pessoal (slug diferente) esconde a \"Beleza\" global", () => {
    const rows = [
      { id: "g", user_id: null, slug: "beleza", name: "Beleza", type: "expense", archived_at: null },
      { id: "p", user_id: "u", slug: "beleza-088920", name: "Beleza", type: "expense", archived_at: null },
      { id: "l", user_id: null, slug: "lazer", name: "Lazer", type: "expense", archived_at: null },
    ] as never;
    expect(resolveVisibleCategories(rows, "u").map((c) => c.id)).toEqual(["p", "l"]);
    expect(resolveVisibleCategories(rows, "outro").map((c) => c.id)).toEqual(["g", "p", "l"]);
  });

  it("\"Augusta\" só é Lazer quando é o estabelecimento, não um nome dentro de outro", () => {
    expect(decide("FARMACIA AUGUSTA")?.category_id).toBe("Saúde");
  });
});
