import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261016200000_latencia_banco.sql", "utf8");

/** Regressões de latência medidas em produção (16/10): ver o cabeçalho da migração. */
describe("migração de latência", () => {
  it("o claim da fila de categorias não reescreve mais linhas 'completed' a cada minuto", () => {
    const fn = sql.slice(sql.indexOf("claim_category_classification_batch"), sql.indexOf("nino_diag_situation_event"));
    expect(fn).toContain("WHERE q.status IN ('queued','failed')\n     AND (p_user_id IS NULL OR q.user_id=p_user_id)\n     AND NOT public.transaction_needs_categorization");
    expect(fn).not.toContain("IN ('queued','failed','completed')");
  });
  it("o gatilho de situações ignora ruído de valor e vai-e-volta", () => {
    expect(sql).toContain("greatest(1, 0.05*abs(coalesce(old.impact_amount,0)))");
    expect(sql).toContain("interval '6 hours'");
  });
  it("há índice para o evento material mais recente e limpeza do histórico repetitivo", () => {
    expect(sql).toContain("financial_situation_events_material_idx");
    expect(sql).toContain("r.rn > 10");
  });
});

describe("pacote inicial do app", () => {
  const cfg = readFileSync("vite.config.ts", "utf8");
  it("bibliotecas pesadas em chunks próprios (cache estável entre deploys) e gráficos fora da partida", () => {
    expect(cfg).toContain("manualChunks");
    for (const name of ["vendor-react", "vendor-charts", "vendor-supabase", "vendor-ui"]) expect(cfg).toContain(name);
    expect(cfg).toContain("commonjsHelpers");
  });
  it("o painel do Assessor (com gráficos) é carregado sob demanda", () => {
    const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
    expect(layout).toContain("lazy(() => import('@/components/assessor/AssessorPanel')");
    expect(layout).not.toMatch(/^import \{ AssessorPanel \}/m);
  });
});
