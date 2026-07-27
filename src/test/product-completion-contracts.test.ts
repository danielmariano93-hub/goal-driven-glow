import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260728100000_product_completion_core.sql"),
  "utf8",
);
const contextPage = readFileSync(resolve(root, "src/pages/NinoContexto.tsx"), "utf8");
const advisorPage = readFileSync(resolve(root, "src/pages/AssessorAcompanhamento.tsx"), "utf8");
const behaviorService = readFileSync(
  resolve(root, "supabase/functions/_shared/agent/core/BehaviorService.ts"),
  "utf8",
);
const proactiveTick = readFileSync(
  resolve(root, "supabase/functions/agent-proactive-tick/index.ts"),
  "utf8",
);

describe("product completion contracts", () => {
  it("mantém notificações e entregas nas estruturas canônicas", () => {
    expect(migration).toContain("alter table public.notification_preferences");
    expect(migration).toContain("alter table public.communication_deliveries");
    expect(migration).not.toContain("create table if not exists public.notification_events");
    expect(migration).not.toContain("create table if not exists public.platform_feature_flags");
  });

  it("protege RPCs do usuário por auth.uid", () => {
    expect(migration).toContain("v_user uuid := auth.uid()");
    expect(migration).toContain("revoke all on function public.my_nino_context()");
    expect(migration).toContain("grant execute on function public.my_nino_context() to authenticated");
  });

  it("protege resumo administrativo pela permissão existente", () => {
    expect(migration).toContain("perform public._require_perm('messaging.read')");
    expect(migration).not.toContain("'phone_e164'");
    expect(migration).not.toContain("'body', d.");
  });

  it("não trata falha de evidência como ausência real de dados", () => {
    expect(behaviorService).toContain("if (txResp.error) throw queryError");
    expect(behaviorService).toContain("if (checkinResp.error) throw queryError");
    expect(behaviorService).toContain("if (recurringResp.error) throw queryError");
  });

  it("isola as novas inteligências do pipeline proativo existente", () => {
    expect(proactiveTick).toContain("Promise.allSettled");
    expect(proactiveTick).toContain('stageError("behavior"');
    expect(proactiveTick).toContain('stageError("advisor"');
    expect(proactiveTick).toContain("const generated = await scanUser");
  });

  it("expõe memória editável, hipóteses e acompanhamento no frontend", () => {
    expect(contextPage).toContain("O que o Nino sabe sobre mim");
    expect(contextPage).toContain("Hipóteses comportamentais");
    expect(advisorPage).toContain("Acompanhamento do Nino");
    expect(advisorPage).toContain("Próximos passos");
  });
});
