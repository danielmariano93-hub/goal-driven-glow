import { describe, expect, it } from "vitest";
import { hasEditorialAlternative, pickNextEditorialItem } from "@/lib/nino/homeEditorial";

const item = (id: string, subject: string, priority: number, headline: string) => ({
  id,
  subject,
  priority,
  semanticType: "goal",
  headline,
});

describe("rotação editorial da Home", () => {
  it("respeita o ranking canônico ao trocar (não é aleatório)", () => {
    const pool = [item("a", "goal:1", 1, "Meta pede ritmo"), item("c", "debt:9", 5, "Dívida vence"), item("b", "cash:2", 2, "Caixa aperta")];
    const next = pickNextEditorialItem({ pool, current: pool[0] });
    expect(next?.id).toBe("b");
  });

  it("nunca repete o item atual nem assunto equivalente já exibido", () => {
    const pool = [item("a", "goal:1", 1, "Meta pede ritmo"), item("b", "goal:1", 2, "Meta pede aporte")];
    expect(pickNextEditorialItem({ pool, current: pool[0] })).toBeNull();
    expect(hasEditorialAlternative({ pool, current: pool[0] })).toBe(false);
  });

  it("não devolve item já exibido em outro slot", () => {
    const pool = [item("a", "goal:1", 1, "Meta"), item("b", "cash:2", 2, "Caixa")];
    const next = pickNextEditorialItem({ pool, current: pool[0], displayed: [pool[1]] });
    expect(next).toBeNull();
  });

  it("prefere item não visto na sessão antes de reciclar", () => {
    const pool = [item("a", "goal:1", 1, "Meta"), item("b", "cash:2", 2, "Caixa"), item("c", "debt:3", 3, "Dívida")];
    const next = pickNextEditorialItem({ pool, current: pool[0], seenIds: ["b"] });
    expect(next?.id).toBe("c");
  });

  it("recicla quando o pool inteiro já foi visto, em vez de travar", () => {
    const pool = [item("a", "goal:1", 1, "Meta"), item("b", "cash:2", 2, "Caixa")];
    const next = pickNextEditorialItem({ pool, current: pool[0], seenIds: ["a", "b"] });
    expect(next?.id).toBe("b");
  });
});
