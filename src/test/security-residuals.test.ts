import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("resíduos da auditoria de segurança", () => {
  it("o processador de exclusão de conta só roda com service role ou segredo de cron", () => {
    const src = read("supabase/functions/account-deletion-processor/index.ts");
    expect(src).toContain("safeEqual(bearer, SERVICE_ROLE)");
    expect(src).toContain("matchesAnySecret(cron, CRON_SECRETS)");
    expect(src).toContain('{ error: "unauthorized" }, 401');
  });

  it("chamadas internas comparam a service role em tempo constante", () => {
    expect(read("supabase/functions/artifact-render/index.ts")).not.toContain("auth !== `Bearer ${SERVICE_ROLE}`");
    const ingest = read("supabase/functions/assistant-ingest-document/index.ts");
    expect(ingest).not.toMatch(/!== SERVICE_ROLE\)/);
    expect(ingest).toContain("safeEqual(auth.replace");
  });

  it("remove a tabela de diagnóstico esquecida", () => {
    expect(read("supabase/migrations/20261027280000_security_residuals.sql")).toContain("drop table if exists public.wave1_pre_snapshot");
  });
});
