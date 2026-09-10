// Teste de contrato de schema — report_projection.v1
// ==================================================
// Este teste existe por causa de um incidente real (06–10/09/2026): a Edge
// Function `financial-reports-generate` pedia
// `credit_card_installments.installments_total`, coluna que não existe, e a
// geração de relatório caiu em produção com HTTP 500 por dias.
//
// Duas invariantes:
//   1) CAMPOS PROJETADOS ⊆ COLUNAS REAIS DO BANCO
//      (fonte: `src/integrations/supabase/types.ts`, gerado a partir do schema)
//   2) CAMPOS EXIGIDOS PELO MOTOR ⊆ CAMPOS PROJETADOS
//      (fonte: interfaces canônicas de `_shared/finance-core/cardExposure.ts`)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ENGINE_REQUIRED_FIELDS,
  REPORT_PROJECTIONS,
  projection,
} from "../../supabase/functions/financial-reports-generate/projections";

const TYPES = readFileSync("src/integrations/supabase/types.ts", "utf8");
const LOADER = readFileSync("supabase/functions/financial-reports-generate/index.ts", "utf8");
const CARD_EXPOSURE = readFileSync("supabase/functions/_shared/finance-core/cardExposure.ts", "utf8");

/** Colunas reais da tabela, lidas do arquivo de tipos gerado pelo banco. */
function actualColumns(table: string): string[] {
  const start = TYPES.indexOf(`      ${table}: {\n        Row: {\n`);
  expect(start, `tabela ${table} não encontrada nos tipos gerados`).toBeGreaterThan(-1);
  const rowStart = TYPES.indexOf("Row: {", start) + "Row: {".length;
  const rowEnd = TYPES.indexOf("\n        }", rowStart);
  return TYPES.slice(rowStart, rowEnd)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(":")[0].replace("?", "").trim())
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
}

/** Campos declarados numa interface canônica de linha. */
function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  expect(start, `interface ${name} não encontrada`).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("{", start) + 1;
  const bodyEnd = source.indexOf("\n}", bodyStart);
  return source.slice(bodyStart, bodyEnd)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[a-z_][a-z0-9_]*\??\s*:/.test(line))
    .map((line) => line.split(/\??\s*:/)[0].trim());
}

describe("contrato de projeção do relatório: schema real → loader → motor", () => {
  for (const table of Object.keys(REPORT_PROJECTIONS) as Array<keyof typeof REPORT_PROJECTIONS>) {
    it(`só projeta colunas que existem em ${table}`, () => {
      const columns = actualColumns(table);
      const missing = REPORT_PROJECTIONS[table].filter((f) => !columns.includes(f));
      expect(missing, `campos inexistentes em ${table}`).toEqual([]);
    });
  }

  it("não volta a pedir installments_total (coluna inexistente — causa do incidente)", () => {
    expect(REPORT_PROJECTIONS.credit_card_installments as readonly string[]).not.toContain("installments_total");
    expect(LOADER).not.toContain("installments_total");
  });

  for (const [table, required] of Object.entries(ENGINE_REQUIRED_FIELDS)) {
    it(`carrega todos os campos que o motor exige de ${table}`, () => {
      const projected = REPORT_PROJECTIONS[table as keyof typeof REPORT_PROJECTIONS] as readonly string[];
      const missing = required.filter((f) => !projected.includes(f));
      expect(missing, `campos exigidos pelo motor e não carregados de ${table}`).toEqual([]);
    });
  }

  it("cobre integralmente CardStatementRow e CardInstallmentRow", () => {
    const statementFields = interfaceFields(CARD_EXPOSURE, "CardStatementRow");
    const installmentFields = interfaceFields(CARD_EXPOSURE, "CardInstallmentRow");
    // Qualquer campo NOVO no tipo canônico precisa entrar no contrato de
    // projeção — é assim que renomeação/adição para de passar silenciosamente.
    for (const f of statementFields) {
      expect(ENGINE_REQUIRED_FIELDS.credit_card_statements as readonly string[], `CardStatementRow.${f}`).toContain(f);
    }
    for (const f of installmentFields) {
      expect(ENGINE_REQUIRED_FIELDS.credit_card_installments as readonly string[], `CardInstallmentRow.${f}`).toContain(f);
    }
  });

  it("o loader usa exclusivamente o contrato de projeção (sem select solto)", () => {
    for (const table of Object.keys(REPORT_PROJECTIONS)) {
      expect(LOADER, `${table} deve usar projection("${table}")`).toContain(`projection("${table}")`);
    }
    expect(projection("credit_card_installments")).toContain("absorbed_by_statement_id");
    expect(projection("credit_card_statements")).toContain("outstanding_amount");
  });
});
