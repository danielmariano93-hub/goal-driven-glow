// F1 (definições únicas) em modo sombra: trava, no CI, que a função nova é só leitura, fora do caminho de produção
// e que a fatura aberta nunca entra como compromisso (refinamento técnico §2.5).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/20261030140000_f1_compromissos_sombra.sql";
const sql = readFileSync(FILE, "utf8");

describe("F1: compromissos v2 em modo sombra", () => {
  it("é só leitura: STABLE, sem escrita, sem cron e sem acesso para usuários finais", () => {
    expect(sql).toContain("STABLE");
    expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|cron\.schedule|net\.http_post)\b/i);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.nino_commitments_shadow(uuid, date) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.nino_commitments_shadow(uuid, date) TO service_role;");
  });

  it("compromisso v2 = recorrências + dívidas + parcelas do cronograma; fatura aberta fica só informativa", () => {
    expect(sql).toContain("'commitments_v2_current', round(rec.v + div.v + parc.atual_abertas, 2)");
    expect(sql).toContain("'commitments_v2_next', round(rec.v + div.v + parc.proximo_agendadas, 2)");
    expect(sql).toContain("'open_card_bill_info_only'");
    expect(sql).not.toMatch(/commitments_v2_\w+',[^\n]*fatura\.aberta/);
  });

  it("parcela cancelada (antecipada/quitada) não conta como compromisso futuro", () => {
    expect(sql).toContain("i.status IN ('scheduled','billed')");
    expect(sql).not.toMatch(/status IN \([^)]*cancelled[^)]*\)\), 0\) AS (atual|proximo)_(abertas|agendadas)/);
  });

  it("nenhuma outra migração ou função de produção chama a função sombra ainda", () => {
    for (const f of readdirSync("supabase/migrations")) {
      if (`supabase/migrations/${f}` === FILE) continue;
      expect(readFileSync(`supabase/migrations/${f}`, "utf8")).not.toContain("nino_commitments_shadow");
    }
  });
});
