import { describe, it, expect } from "vitest";
import { filterCategoryOptions } from "@/components/CategorySelect";

const now = new Date().toISOString();
const mk = (over: Partial<any> = {}) => ({
  id: over.id ?? crypto.randomUUID(),
  user_id: over.user_id ?? "u1",
  name: over.name ?? "Cat",
  slug: over.slug ?? "cat",
  type: over.type ?? "expense",
  color: null,
  icon: null,
  created_at: now,
  updated_at: now,
  archived_at: over.archived_at ?? null,
}) as any;

describe("filterCategoryOptions", () => {
  const global = mk({ id: "g1", user_id: null, name: "Mercado" });
  const personal = mk({ id: "p1", name: "Cafezinho" });
  const other = mk({ id: "p2", name: "Salário", type: "income" });
  const archived = mk({ id: "arc", name: "Antigo", archived_at: now });

  it("mostra globais + pessoais ativas do tipo pedido", () => {
    const { active } = filterCategoryOptions([global, personal, other, archived], "expense", null);
    expect(active.map((c) => c.id).sort()).toEqual(["g1", "p1"]);
  });

  it("filtra por tipo receita", () => {
    const { active } = filterCategoryOptions([global, personal, other], "income", null);
    expect(active.map((c) => c.id)).toEqual(["p2"]);
  });

  it("preserva categoria arquivada quando é o valor atual (historico)", () => {
    const r = filterCategoryOptions([global, personal, archived], "expense", "arc");
    expect(r.selectedArchived?.id).toBe("arc");
    expect(r.active.find((c) => c.id === "arc")).toBeUndefined();
  });

  it("não devolve arquivada quando não é o valor atual", () => {
    const r = filterCategoryOptions([global, personal, archived], "expense", null);
    expect(r.selectedArchived).toBeNull();
  });
});
