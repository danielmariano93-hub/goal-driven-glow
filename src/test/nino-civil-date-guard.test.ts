import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe("data civil do Nino", () => {
  it("não deriva hoje/mês diretamente do relógio UTC em código de produção", () => {
    const offenders = ["src", "supabase/functions"]
      .flatMap(sourceFiles)
      .filter((path) => !path.includes("/test/") && !path.endsWith("ninoClock.ts"))
      .filter((path) => {
        const source = readFileSync(path, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        return /new Date\(\)\)?\s*\.toISOString\(\)\.slice\(0,\s*(?:7|10)\)/.test(source);
      });

    expect(offenders).toEqual([]);
  });
});
