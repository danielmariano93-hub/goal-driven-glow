import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Texto que o usuário lê na tela de Hábitos: sem jargão interno e sem concordância quebrada.
const FILES = [
  "src/lib/engine/behaviorObservedV3.ts",
  "src/components/habits/DimensionPanel.tsx",
  "src/lib/engine/behaviorEvolution.ts",
];
const BANNED: Array<[RegExp, string]> = [
  [/ciclos? de meta/i, "use “período(s) de meta”"],
  [/confiança (alta|média|baixa)/i, "use “leitura firme/razoável/inicial”"],
  [/os indicadores mostram/i, "use “os números mostram”"],
  [/o Nino (só )?(vê|enxerga|observa)/i, "fale em primeira pessoa: “eu só vejo…”"],
  [/saldo devedor|Seus ativos|em ativos/i, "use palavras do dia a dia"],
  [/Seu dinheiro cobrem/, "concordância: “cobre”"],
];

describe("clareza do texto de Hábitos", () => {
  for (const file of FILES) {
    it(`${file} não usa jargão nem frases confusas`, () => {
      const src = readFileSync(file, "utf8");
      for (const [re, hint] of BANNED) expect(src, `${file}: ${hint}`).not.toMatch(re);
    });
  }
});

// Plural verbal montado colando sufixo gera palavras que não existem (“terminouaram”, “foiram”, “mediuram”).
describe("sem plural verbal por concatenação", () => {
  const SRC = [
    "src/lib/engine/behaviorObservedV3.ts", "src/lib/engine/behaviorObserved.ts", "src/lib/engine/behaviorEvolution.ts",
    "src/components/habits/DimensionPanel.tsx", "src/components/habits/HabitsWheel.tsx", "src/components/contacts/QuickAddPeople.tsx",
  ];
  for (const file of SRC) {
    it(`${file}`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/(terminou|foi|mediu)\$\{[^}]*\? "" : "(aram|ram)"\}/);
    });
  }
});
