import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260728230000_product_quality_hardening.sql").toLowerCase();
const splitWorker = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
const tick = read("supabase/functions/agent-proactive-tick/index.ts");
const advisor = read("supabase/functions/_shared/agent/core/AdvisorReviewServiceV2.ts");
const proactive = read("supabase/functions/_shared/agent/core/ProactiveEngineV2.ts");
const contextPage = read("src/pages/NinoContextoV2.tsx");
const adminPanel = read("src/components/admin/ProactiveEnginePanelV2.tsx");

describe("product quality hardening", () => {
  it("agenda a divisão pelo vencimento e continua depois dele", () => {
    expect(migration).toContain("'due_soon'");
    expect(migration).toContain("'due_today'");
    expect(migration.toLowerCase()).toContain(
  "cross join (values (1), (3), (7))",
);
    expect(migration).toContain("split:catchup");
    expect(splitWorker).toContain("participant.linked_user_id");
    expect(splitWorker).toContain("split_reminder");
  });

  it("separa revisão semanal e mensal por janelas e comparações próprias", () => {
    expect(advisor).toContain('reviewWindow("weekly")');
    expect(advisor).toContain('reviewWindow("monthly")');
    expect(advisor).toContain("previousExpense");
    expect(advisor).not.toContain("Fazer uma revisão de cinco minutos");
    expect(advisor).toContain("não sugeriu um corte automático");
    expect(advisor).not.toContain("Fazer uma revisão de cinco minutos");
  });

  it("faz dry-run sem persistir sugestões", () => {
    expect(tick).toContain("persist: !dryRun");
    expect(tick).toContain("preview:");
    expect(proactive).toContain("if (!persist || suggestions.length === 0) return suggestions");
  });

  it("expõe templates, fila e simulação real no admin", () => {
    expect(migration).toContain("create table if not exists public.communication_templates");
    expect(migration).toContain("admin_communication_template_upsert");
    expect(adminPanel).toContain("Simular sem enviar");
    expect(adminPanel).toContain("Templates e prévia");
    expect(adminPanel).toContain("Fila e bloqueios");
  });

  it("remove edição técnica por JSON da memória", () => {
    expect(contextPage).toContain("Nenhum JSON precisa ser editado");
    expect(contextPage).not.toContain("JSON.parse");
    expect(contextPage).toContain("Menos relevantes");
  });

  it("cria detalhe acionável e feedback para falsos positivos", () => {
    expect(migration).toContain("my_proactive_suggestion_feedback");
    expect(migration).toContain("not_duplicate");
    expect(proactive).toContain("transactions: rows.map");
    expect(proactive).toContain("/app/alertas/");
  });

  it("faz backfill de categorização, memória e dicas históricas", () => {
    expect(migration).toContain("alias pessoal exato");
    expect(migration).toContain("reconcile_agent_memory_categories");
    expect(migration).toContain("update public.user_insights");
    expect(migration).toContain("category_source = coalesce(category_source,'legacy')");
  });
});
