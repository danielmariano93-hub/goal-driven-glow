import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Nenhuma ação do Nino pode apontar para uma rota que o App.tsx não reconhece.
 * As rotas são lidas diretamente da migration que define nino_diag_select_action.
 */
function latestSelectActionSql(): string {
  const dir = "supabase/migrations";
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const file of files) {
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    if (sql.includes("function public.nino_diag_select_action")) return sql;
  }
  throw new Error("migration de nino_diag_select_action não encontrada");
}

function sqlRoutes(sql: string): string[] {
  const body = sql.slice(sql.indexOf("nino_diag_select_action"));
  const end = body.indexOf("$function$;");
  const scoped = body.slice(0, end > 0 ? end : undefined);
  const routes = new Set<string>();
  // Cada expressão de rota vai de 'route', até ,'explanation' — pode ser um
  // literal simples ou um coalesce com concatenações.
  for (const match of scoped.matchAll(/'route',(.*?),'explanation'/gs)) {
    const expression = match[1];
    for (const branch of expression.split(/,(?![^(]*\))/)) {
      const literals = [...branch.matchAll(/'([^']*)'/g)].map((m) => m[1]).join("");
      const route = literals.startsWith("/app") ? literals : null;
      if (route) routes.add(route);
    }
  }
  return [...routes];
}


function appRoutes(): string[] {
  const app = readFileSync("src/App.tsx", "utf8");
  return [...app.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p === "/app" || !p.startsWith("/"))
    .map((p) => (p === "/app" ? "/app" : `/app/${p}`));
}

function routeExists(route: string, known: string[]): boolean {
  const path = route.split("?")[0].replace(/\/$/, "");
  return known.some((pattern) => {
    const patternSegs = pattern.split("/");
    const pathSegs = path.split("/");
    if (patternSegs.length !== pathSegs.length) return false;
    return patternSegs.every((seg, i) => seg.startsWith(":") || seg === pathSegs[i]);
  });
}

describe("rotas das ações do Nino", () => {
  const known = appRoutes();
  const routes = sqlRoutes(latestSelectActionSql());

  it("extrai todas as rotas geradas pela função", () => {
    expect(routes.length).toBeGreaterThanOrEqual(9);
  });

  it("toda rota gerada existe no roteador", () => {
    for (const route of routes) {
      expect(routeExists(route, known), `rota inexistente: ${route}`).toBe(true);
    }
  });

  it("recalibrar meta usa deep link válido e nunca /app/metas/{uuid}", () => {
    const goalRoute = routes.find((r) => r.includes("goal="));
    expect(goalRoute).toBeTruthy();
    expect(goalRoute).toContain("action=recalibrate");
    expect(routes.some((r) => /^\/app\/metas\/[^?]/.test(r))).toBe(false);
  });

  it("revisar cartão usa query e não rota dinâmica", () => {
    expect(routes.some((r) => r.startsWith("/app/cartoes?card="))).toBe(true);
    expect(routes.some((r) => /^\/app\/cartoes\/[^?]/.test(r))).toBe(false);
  });
});
