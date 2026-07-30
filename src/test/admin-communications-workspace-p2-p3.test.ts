import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const page = fs.readFileSync(path.join(root, "src/pages/admin/ComunicacaoProativa.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "src/components/admin/ProactiveEnginePanelV2.tsx"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260730003000_admin_communications_workspace_p2_p3.sql"),
  "utf8",
);

describe("workspace de Comunicações P2+P3", () => {
  it("expõe evolução diária com contexto de período, canal e fonte", () => {
    expect(page).toContain('title="Evolução das comunicações"');
    expect(page).toContain('label: "Tentativas"');
    expect(page).toContain('label: "Entregues"');
    expect(page).toContain('label: "Falhas"');
    expect(page).toContain("dados de entrega reais");
  });

  it("oferece busca, filtro de canal e criação orientada de template", () => {
    expect(panel).toContain("Buscar por nome ou caso de uso");
    expect(panel).toContain("Filtrar templates por canal");
    expect(panel).toContain("Criar template");
    expect(panel).toContain("Nenhum template corresponde aos filtros");
  });

  it("traduz a fila para indicadores operacionais acionáveis", () => {
    expect(panel).toContain("Aguardando processamento");
    expect(panel).toContain("Falhas recentes");
    expect(panel).toContain("Retidas por regra");
    expect(panel).not.toContain("SQLSTATE");
  });

  it("semeia conteúdo leve e preserva templates personalizados", () => {
    expect(migration).toContain("Vamos organizar esse gasto?");
    expect(migration).toContain("Sem bronca");
    expect(migration).toContain("Consistência vale mais que perfeição");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
