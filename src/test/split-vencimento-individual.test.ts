import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEqualInstallments } from "@/lib/split/installments";

const page = readFileSync("src/pages/DivisaoDoRoleNova.tsx", "utf8");
const sql = readFileSync("supabase/migrations/20261018120000_split_vencimento_individual.sql", "utf8");

describe("Divisão do Rolê: vencimento individual", () => {
  it("cada pessoa pode ter a própria data; vazio herda a data geral", () => {
    expect(page).toContain("due_date?: string");
    expect(page).toContain("due_date:p.due_date||null");
    expect(page).toContain("Vencimento (padrão)");
  });

  it("no parcelado, cada pessoa começa as parcelas na própria data (ou na geral)", () => {
    expect(page).toContain("personDue || firstDue");
    expect(page).toContain("p.due_date || firstDue");
    // a mesma regra, em dados
    const ana = buildEqualInstallments(90, 3, "2026-11-05").map((r) => r.due_date);
    const beto = buildEqualInstallments(90, 3, "2026-11-20").map((r) => r.due_date);
    expect(ana[0]).toBe("2026-11-05");
    expect(beto[0]).toBe("2026-11-20");
    expect(ana[1]).toBe("2026-12-05");
    expect(beto[1]).toBe("2026-12-20");
  });

  it("na edição, a data de cada pessoa é carregada e reenviada", () => {
    expect(page).toContain("due_date:p.due_date??\"\"");
    expect(page).toContain('.select("id,phone_e164,amount_due,due_date")');
  });

  it("o banco guarda a data da pessoa e a usa ao gerar as parcelas (individual > geral)", () => {
    expect(sql).toContain("add column if not exists due_date date");
    expect(sql).toContain("v_default_due := coalesce(part.due_date, se.due_date)");
    expect(sql).toContain("coalesce(v_due, v_default_due)");
    expect(sql).toContain("nullif(it->>'due_date', '')::date");
  });

  it("editar não derruba a data de quem veio de um cliente antigo (sem a chave) e não quebra o status enum", () => {
    expect(sql).toContain("jsonb_exists(it, 'due_date')");
    expect(sql).toContain("'paid'::participant_status");
    expect(sql).toContain("ELSE status END");
  });
});
