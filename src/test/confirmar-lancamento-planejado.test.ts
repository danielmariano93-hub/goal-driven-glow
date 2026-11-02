// Lançamento planejado (ex.: aluguel do dia 30) precisa ter caminho de confirmação no app.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261102140000_confirmar_lancamento_planejado.sql", "utf8");
const page = readFileSync("src/pages/LancamentoDetalhe.tsx", "utf8");

describe("confirmar lançamento planejado", () => {
  it("a função só confirma o que é do dono, está planejado e na versão esperada", () => {
    expect(migration).toContain("WHERE id = p_id AND user_id = auth.uid()");
    expect(migration).toContain("target.version <> p_expected_version");
    expect(migration).toContain("target.status::text <> 'planned'");
    expect(migration).toContain("SET status = 'confirmed'");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.transaction_confirm_planned(uuid, integer, date, numeric) FROM PUBLIC, anon;");
  });

  it("a tela de detalhe oferece 'Confirmar lançamento' para lançamento planejado e não para transferência", () => {
    expect(page).toContain('tx.status === "planned" && !isTransfer');
    expect(page).toContain("Confirmar lançamento");
    expect(page).toContain('supabase.rpc("transaction_confirm_planned"');
    expect(page).toContain("p_expected_version: tx.version");
  });
});
