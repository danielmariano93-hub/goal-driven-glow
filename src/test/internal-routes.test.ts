import { describe, expect, it } from "vitest";
import { findBrokenRoutes, isKnownRoute, registeredRoutes } from "../../scripts/check-internal-routes.mjs";
import { isKnownAppPath, resolveAppRoute } from "@/lib/navigation/resolveRoute";
import { safeRoute } from "@/lib/nino/intelligence";
import { readFileSync } from "node:fs";

describe("links internos: nenhum caminho aponta para tela que não existe", () => {
  it("todo caminho /app e /admin citado no código existe em App.tsx", () => {
    expect(findBrokenRoutes().broken).toEqual([]);
  });
  it("o conjunto de rotas do registro de navegação cobre as de App.tsx", () => {
    const routes = registeredRoutes(readFileSync("src/App.tsx", "utf8")).filter((r) => r.startsWith("/app"));
    const missing = routes.filter((r) => !isKnownAppPath(r.replace(/:[A-Za-z]+/g, "x")));
    expect(missing).toEqual([]);
    expect(isKnownRoute("/app/dividas", registeredRoutes(readFileSync("src/App.tsx", "utf8")))).toBe(true);
  });
});

describe("resolveAppRoute: links antigos levam ao lugar certo", () => {
  it("apelidos e '/app/mais/<tela>'", () => {
    expect(resolveAppRoute("/app/mais/dividas")).toBe("/app/dividas");
    expect(resolveAppRoute("/app/mais/metas?goal=1")).toBe("/app/metas?goal=1");
    expect(resolveAppRoute("/app/alertas")).toBe("/app/nino");
  });
  it("caminho válido passa intacto, com query", () => {
    expect(resolveAppRoute("/app/dividas?debt=1&action=pagar")).toBe("/app/dividas?debt=1&action=pagar");
    expect(resolveAppRoute("/app/alertas/diagnosis%3Asituation%3Aabc")).toBe("/app/alertas/diagnosis%3Asituation%3Aabc");
    expect(resolveAppRoute("/app/lancamentos/123?edit=1")).toBe("/app/lancamentos/123?edit=1");
  });
  it("sub-caminho inexistente cai no pai existente; sem aproveitamento devolve null", () => {
    expect(resolveAppRoute("/app/dividas/123/parcelas")).toBe("/app/dividas");
    expect(resolveAppRoute("/app/tela-que-nunca-existiu")).toBeNull();
    expect(resolveAppRoute("/login")).toBeNull();
  });
  it("safeRoute corrige antes de virar link quebrado", () => {
    expect(safeRoute({ route: "/app/mais/dividas" } as never)).toBe("/app/dividas");
    expect(safeRoute({ route: "/app/nada-aqui" } as never)).toBe("/app/nino");
    expect(safeRoute({ route: "/app/metas" } as never)).toBe("/app/metas");
  });
});

describe("aba Emocional virou Mapa Financeiro", () => {
  it("link antigo /app/emocoes leva ao Mapa e mantém a query", () => {
    expect(resolveAppRoute("/app/emocoes")).toBe("/app/mapa");
    expect(resolveAppRoute("/app/emocoes?action=checkin")).toBe("/app/mapa?action=checkin");
    expect(resolveAppRoute("/app/mapa")).toBe("/app/mapa");
  });
});
