// Regressões da auditoria de segurança de 02/10/2026.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { safeEqual, matchesAnySecret } from "../../supabase/functions/_shared/security/secrets";

const FUNCTIONS = join(__dirname, "../../supabase/functions");

describe("comparação de segredos em tempo constante", () => {
  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual(null, "x")).toBe(false);
  });
  it("matchesAnySecret ignora segredo vazio e aceita qualquer configurado", () => {
    expect(matchesAnySecret("s2", ["s1", "s2"])).toBe(true);
    expect(matchesAnySecret("", [""])).toBe(false);
    expect(matchesAnySecret("x", [])).toBe(false);
  });
  it("nenhuma edge function compara segredo de cron/internal com ===", () => {
    const offenders: string[] = [];
    for (const dir of readdirSync(FUNCTIONS)) {
      const file = join(FUNCTIONS, dir, "index.ts");
      if (!existsSync(file)) continue;
      const src = readFileSync(file, "utf8");
      if (/(?:===|!==)\s*(?:CRON_SECRET|INTERNAL_SECRET)\b/.test(src) || /\bCRON_SECRETS?\.includes\(/.test(src) || /\bsecrets\.includes\(provided\)/.test(src)) offenders.push(dir);
    }
    expect(offenders).toEqual([]);
  });
});

describe("migração de exposição de RPCs", () => {
  const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261002120000_security_harden_rpc_exposure.sql"), "utf8");
  it("anon só mantém resolve_short_link e novas funções não nascem públicas", () => {
    expect(sql).toMatch(/revoke execute on function %s from anon/);
    expect(sql).toMatch(/proname = 'resolve_short_link'/);
    expect(sql).toMatch(/alter default privileges in schema public revoke execute on functions from anon/);
  });
  it("simulador do admin exige permissão de plataforma", () => {
    expect(sql).toMatch(/agent_sim_enqueue/);
    expect(sql).toMatch(/has_platform_permission/);
  });
});
