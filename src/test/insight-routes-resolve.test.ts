import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAppRoute } from "@/lib/navigation/resolveRoute";

// Todo link de insight/alerta/prioridade gerado pelo servidor ou pelo app precisa abrir uma tela que existe
// (ou ser redirecionado para ela), nunca cair em erro.
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : /\.(ts|tsx|sql)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
const sources = [
  ...files("supabase/functions/_shared/proactive"),
  ...files("src/lib/nino"),
  ...files("supabase/migrations"),
];
const found = new Set<string>();
for (const f of sources) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/['"`](\/app\/[a-z0-9_\-/]*)(?=['"`?$]|\$\{)/gi)) if (m[1] !== "/app/") found.add(m[1]);
}

describe("rotas de insights", () => {
  it("encontrou rotas para validar", () => {
    expect(found.size).toBeGreaterThan(15);
  });
  it.each([...found].sort())("%s abre uma tela que existe", (route) => {
    // Prefixo de rota com id (termina em "/"): valida com um id de exemplo.
    const concrete = route.endsWith("/") ? `${route}00000000-0000-0000-0000-000000000000` : route;
    expect(resolveAppRoute(concrete)).not.toBeNull();
  });
});
