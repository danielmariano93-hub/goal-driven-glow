import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261106140000_metricas_canonicas.sql", "utf8");

describe("métricas canônicas (nino_metrics_canonical.v1)", () => {
  it("conversa real exclui simulador e contas de teste/sandbox", () => {
    expect(sql).toContain("coalesce(a.channel, '''') <> ''simulator''");
    expect(sql).toMatch(/p\.is_test or p\.is_sandbox/);
  });
  it("pedir um dado (needs_*) conta como concluída, e o status original continua acessível", () => {
    expect(sql).toContain("like ''needs\\_%''");
    expect(sql).toContain("a.status as raw_status");
  });
  it("as visões não são legíveis por usuários comuns", () => {
    expect(sql).toMatch(/revoke all on public\.v_real_outbound from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on public\.v_real_agent_runs from public, anon, authenticated/);
  });
  it("os painéis de qualidade leem a mesma definição", () => {
    for (const fn of ["admin_v2_operations_health", "admin_v2_cockpit", "admin_v2_metrics_universe", "admin_v2_daily_evolution",
      "admin_platform_status", "admin_v2_agent_autonomy", "admin_v4_command_center", "ops_alerts_evaluate", "feature_health_snapshot"]) {
      expect(sql).toContain(`'${fn}'`);
    }
    expect(sql).toContain("admin_v2_messaging_failure_7d");
  });
  it("custo e telas por usuário NÃO usam a visão (simulador gasta dinheiro; ficha do cliente quer o dado bruto)", () => {
    for (const fn of ["admin_v2_ai_history", "admin_v3_ai_history", "admin_v2_ai_efficiency", "admin_ai_ops_snapshot", "admin_v2_client_profile", "admin_message_reprocess"]) {
      expect(sql).not.toContain(`'${fn}'`);
    }
  });
  it("a troca é reversível: a definição original fica guardada", () => {
    expect(sql).toMatch(/insert into public\.admin_function_backups/);
  });
  it("o snapshot de saúde das features usa a visão (uma só definição de erro)", () => {
    const health = readFileSync("supabase/migrations/20261106120000_feature_health.sql", "utf8");
    expect(health).toContain("agent_runs a"); // o texto original; a migração canônica o troca por v_real_agent_runs
    expect(sql).toContain("'feature_health_snapshot'");
  });
});
