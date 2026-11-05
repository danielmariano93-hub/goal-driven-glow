import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// O job semanal roda sem usuário logado: precisa exigir o segredo interno, ler só contas liberadas e gravar com persist.
describe("mapa-weekly (job semanal)", () => {
  const src = readFileSync("supabase/functions/mapa-weekly/index.ts", "utf8");
  it("exige x-cron-secret e rejeita método que não seja POST", () => {
    expect(src).toContain('req.headers.get("x-cron-secret")');
    expect(src).toContain("matchesAnySecret(secret, CRON_SECRETS)");
    expect(src).toContain('"method_not_allowed"');
    expect(src.indexOf("matchesAnySecret")).toBeLessThan(src.indexOf("createClient("));
  });
  it("lê só contas liberadas (linha em mapa_access ou rollout geral) e grava a leitura", () => {
    // A regra mora em `mapaUserIds`/`selectMapaUsers` (testada em mapa-runtime-server.test.ts): linha da conta vence; sem rollout,
    // só quem tem linha ligada; com rollout, contas reais menos as desligadas.
    expect(src).toContain("mapaUserIds(sb)");
    expect(readFileSync("supabase/functions/_shared/mapa/runtime.ts", "utf8")).toContain('.from("mapa_access").select("user_id,enabled")');
    expect(src).toContain("{ persist: true }");
  });
  it("está sem verificação de JWT (cron) e agendado na segunda 09:45 UTC com o segredo do vault", () => {
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(/\[functions\.mapa-weekly\][^[]*verify_jwt = false/);
    const sql = readFileSync("supabase/migrations/20261016180000_mapa_weekly_cron.sql", "utf8");
    expect(sql).toContain("'45 9 * * 1'");
    expect(sql).toContain("vault.decrypted_secrets");
    expect(sql).toContain("revoke all on function public.mapa_weekly_tick() from public, anon, authenticated");
  });
});
