import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_RPC_ARGS, buildArgs } from "@/lib/admin/rpcContracts";
import { mapWhatsAppStatus } from "@/lib/admin/statusMapper";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("P0 — contratos operacionais do admin", () => {
  it("mantém os argumentos do frontend iguais às assinaturas reais do banco", () => {
    expect(ADMIN_RPC_ARGS.admin_communication_catalog_update).toContain("_cooldown_hours");
    expect(ADMIN_RPC_ARGS.admin_communication_catalog_update).toContain("_max_per_day");
    expect(ADMIN_RPC_ARGS.admin_communication_template_upsert).not.toContain("_allowed_variables");
    expect(ADMIN_RPC_ARGS.admin_proactive_engine_toggle).toEqual(["_enabled", "_channels"]);

    expect(buildArgs("admin_proactive_engine_toggle", {
      _enabled: true,
      _channels: ["app"],
      _unknown: "drop",
    })).toEqual({ _enabled: true, _channels: ["app"] });
  });

  it("consulta o nome canônico das recorrências nos dois motores", () => {
    for (const path of ["supabase/functions/_shared/agent/core/ProactiveEngineV2.ts"]) {
      const content = source(path);
      expect(content).toContain("recurring_rules(name");
      expect(content).not.toContain("recurring_rules(description");
    }
  });

  it("consulta a sessão ao vivo sem tornar o painel dependente da sonda", () => {
    const hook = source("src/hooks/useAdminPlatformStatus.ts");
    expect(hook).toContain('action: "operational_status"');
    expect(hook).toContain("Promise.allSettled");
    expect(hook).toContain('source: "live_session"');
  });

  it("não classifica os jobs por uma janela fixa de 30 minutos", () => {
    const migration = source("supabase/migrations/20260729220000_admin_operations_p0.sql");
    expect(migration).toContain("due_count > 0");
    expect(migration).toContain("oldest_due < now() - tolerance");
    expect(migration).not.toContain("last_run_at < now() - interval '30 minutes'");
  });

  it("grava auditoria usando as colunas que existem em produção", () => {
    const migration = source("supabase/migrations/20260729220000_admin_operations_p0.sql");
    expect(migration).toContain("platform_admin_audit (actor_user_id, action, meta)");
    expect(migration).not.toContain(
      "platform_admin_audit (actor_user_id, action, target_type",
    );
  });

  it("traduz estados de incerteza sem declarar desconexão", () => {
    expect(mapWhatsAppStatus("unstable").label).toBe("Conexão instável");
    expect(mapWhatsAppStatus("unverifiable").tone).toBe("warn");
  });
});
