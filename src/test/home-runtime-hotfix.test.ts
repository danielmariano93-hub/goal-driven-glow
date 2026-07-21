import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("Home runtime hotfix", () => {
  it("autentica o Pulso com o mesmo fluxo robusto das demais Edge Functions", () => {
    const source = read("supabase/functions/pulse-compute/index.ts");
    expect(source).toContain("sbAuth.auth.getUser()");
    expect(source).not.toContain("SUPABASE_ANON_KEY");
    expect(source).not.toContain("getClaims(");
  });

  it("consulta recorrências pelo schema real", () => {
    const source = read("supabase/functions/pulse-compute/index.ts");
    expect(source).toContain('select("id,status,amount")');
    expect(source).toContain('.eq("status", "active")');
    expect(source).not.toContain('select("id,active,amount")');
  });

  it("não bloqueia a troca explícita de dica por 60 segundos", () => {
    const server = read("supabase/functions/insights-generate/index.ts");
    const client = read("src/components/home/AssistantTipCard.tsx");
    expect(server).not.toContain("retry_after_seconds: 60");
    expect(client).not.toContain("< 60_000");
    expect(client).not.toContain('await refetch()');
  });

  it("remove o alerta indevido de saldo de dívida", () => {
    const source = read("src/pages/Index.tsx");
    expect(source).not.toContain("Falta informar o saldo da dívida");
    expect(source).toContain("apply_safe_category_suggestions");
  });
});
