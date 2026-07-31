import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { participantSplitReply } from "../../supabase/functions/_shared/messaging/splitParticipantSupport";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("contratos de Nino, IA e comunicação", () => {
  it("expõe uma área navegável para modelos e conhecimento", () => {
    expect(read("src/App.tsx")).toContain('path="nino-ia"');
    expect(read("src/components/admin/AdminLayout.tsx")).toContain("Nino & IA");
    expect(read("src/pages/admin/NinoIA.tsx")).toContain("admin_ai_model_route_update");
    expect(read("src/pages/admin/NinoIA.tsx")).toContain("admin_agent_knowledge_upsert");
  });

  it("separa aprendizado pessoal do plano de acompanhamento", () => {
    const learned = read("src/pages/NinoContextoV2.tsx");
    expect(learned).toContain("O que o Nino aprendeu");
    expect(learned).not.toContain("O que está acontecendo");
    expect(read("src/pages/AssessorAcompanhamentoV2.tsx")).toContain("O que está acontecendo");
  });

  it("mantém RPCs administrativas com contratos explícitos", () => {
    const registry = read("src/lib/admin/rpcContracts.ts");
    for (const rpc of ["admin_ai_model_routes", "admin_ai_model_route_update", "admin_agent_knowledge_list", "admin_agent_knowledge_upsert", "admin_split_reminder_policy_update"]) {
      expect(registry).toContain(rpc);
    }
  });

  it("faz a agenda usar a política editável, não datas fixas", () => {
    const sql = read("supabase/migrations/20260731013000_nino_admin_knowledge_communication.sql");
    expect(sql).toContain("cfg.due_soon_days_before");
    expect(sql).toContain("cfg.repeat_every_days");
    expect(sql).toContain("cfg.max_overdue_reminders");
    expect(sql).toContain("generate_series(1,cfg.max_overdue_reminders)");
  });

  it("aplica as rotas de modelo nas conversas, visão e categorização", () => {
    const prompt = read("supabase/functions/_shared/agent/prompt.ts");
    const ingest = read("supabase/functions/assistant-ingest-document/index.ts");
    expect(prompt).toContain('.eq("task", "complex_reasoning")');
    expect(ingest).toContain('resolveConfiguredModel(sb, "vision")');
    expect(ingest).toContain('resolveConfiguredModel(sb, "semantic_classification")');
  });

  it("responde a participante somente com o contexto do próprio rolê", () => {
    const context = { participantName: "Lucas Silva", title: "Jantar", amountDue: 80, amountPaid: 20, dueDate: "2026-08-02", pixKey: "pix@example.com" };
    expect(participantSplitReply("qual o site?", context)).toContain("https://meunino.com.br");
    expect(participantSplitReply("quanto eu devo?", context)).toContain("R$ 60,00");
    expect(participantSplitReply("qual o pix?", context)).toContain("pix@example.com");
  });
});
