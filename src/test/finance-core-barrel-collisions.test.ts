// O índice de `supabase/functions/_shared/finance-core/index.ts` faz `export *` de todos os módulos. Dois módulos que
// exportam o mesmo nome quebram a checagem de tipos das Edge Functions (TS2308), que só roda no CI (`deno check`).
// Este teste pega o mesmo problema localmente.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/functions/_shared/finance-core";

describe("finance-core: nomes exportados são únicos no índice", () => {
  it("nenhum nome é exportado por dois módulos reexportados", () => {
    const index = readFileSync(`${DIR}/index.ts`, "utf8");
    const modules = [...index.matchAll(/export \* from "\.\/(\w+)\.ts"/g)].map((m) => m[1]);
    expect(modules.length).toBeGreaterThan(10);
    // Nomes reexportados de forma explícita (`export { x } from`) já estão desambiguados no índice.
    const resolved = new Set<string>();
    for (const m of index.matchAll(/export (?:type )?\{([^}]*)\} from/g)) for (const n of m[1].split(",")) resolved.add(n.trim());
    const owners = new Map<string, string[]>();
    for (const mod of modules) {
      if (!readdirSync(DIR).includes(`${mod}.ts`)) continue;
      const src = readFileSync(`${DIR}/${mod}.ts`, "utf8");
      for (const m of src.matchAll(/^export (?:declare )?(?:async )?(?:const|let|function\*?|class|enum|interface|type)\s+(\w+)/gm)) {
        owners.set(m[1], [...(owners.get(m[1]) ?? []), mod]);
      }
    }
    const clashes = [...owners].filter(([name, mods]) => mods.length > 1 && !resolved.has(name)).map(([name, mods]) => `${name}: ${mods.join(", ")}`);
    expect(clashes).toEqual([]);
  });
});
