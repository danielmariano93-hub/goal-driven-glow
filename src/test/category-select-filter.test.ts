import { describe, it, expect } from "vitest";
import { filterCategoryOptions } from "@/components/CategorySelect";
import { resolveVisibleCategories } from "@/lib/db/finance";

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
  const global = mk({ id: "g1", user_id: null, name: "Mercado", slug: "mercado" });
  const personal = mk({ id: "p1", name: "Cafezinho", slug: "cafezinho-u1abcd" });
  const other = mk({ id: "p2", name: "Salário", type: "income", slug: "salario-u1abcd" });
  const archived = mk({ id: "arc", name: "Antigo", slug: "antigo", archived_at: now });

  it("mostra globais + pessoais ativas do tipo pedido", () => {
    const { active } = filterCategoryOptions([global, personal, other, archived], "expense", null, "u1");
    expect(active.map((c) => c.id).sort()).toEqual(["g1", "p1"]);
  });

  it("filtra por tipo receita", () => {
    const { active } = filterCategoryOptions([global, personal, other], "income", null, "u1");
    expect(active.map((c) => c.id)).toEqual(["p2"]);
  });

  it("preserva categoria arquivada quando é o valor atual (historico)", () => {
    const r = filterCategoryOptions([global, personal, archived], "expense", "arc", "u1");
    expect(r.selectedArchived?.id).toBe("arc");
    expect(r.active.find((c) => c.id === "arc")).toBeUndefined();
  });

  it("não devolve arquivada quando não é o valor atual", () => {
    const r = filterCategoryOptions([global, personal, archived], "expense", null, "u1");
    expect(r.selectedArchived).toBeNull();
  });
});

describe("resolveVisibleCategories — clone-on-edit override", () => {
  it("oculta a global quando o usuário tem pessoal ativa com mesmo slug", () => {
    const globalMercado = mk({ id: "g-mercado", user_id: null, name: "Mercado", slug: "mercado" });
    const override = mk({ id: "p-mercado", user_id: "u1", name: "Mercado (meu)", slug: "mercado" });
    const visible = resolveVisibleCategories([globalMercado, override], "u1");
    expect(visible.map((c) => c.id)).toEqual(["p-mercado"]);
  });

  it("mantém a global se o override foi arquivado", () => {
    const globalMercado = mk({ id: "g-mercado", user_id: null, slug: "mercado" });
    const overrideArch = mk({ id: "p-mercado", user_id: "u1", slug: "mercado", archived_at: now });
    const visible = resolveVisibleCategories([globalMercado, overrideArch], "u1");
    expect(visible.map((c) => c.id).sort()).toEqual(["g-mercado", "p-mercado"]);
  });

  it("override de um usuário não afeta outro", () => {
    const globalMercado = mk({ id: "g-mercado", user_id: null, slug: "mercado" });
    const overrideU1 = mk({ id: "p-mercado-u1", user_id: "u1", slug: "mercado" });
    const visibleU2 = resolveVisibleCategories([globalMercado, overrideU1], "u2");
    expect(visibleU2.map((c) => c.id).sort()).toEqual(["g-mercado", "p-mercado-u1"]);
  });

  it("no filtro do seletor, o override aparece no lugar da global", () => {
    const globalMercado = mk({ id: "g-mercado", user_id: null, name: "Mercado", slug: "mercado" });
    const override = mk({ id: "p-mercado", user_id: "u1", name: "Mercado (meu)", slug: "mercado" });
    const { active } = filterCategoryOptions([globalMercado, override], "expense", null, "u1");
    expect(active.map((c) => c.id)).toEqual(["p-mercado"]);
  });
});
