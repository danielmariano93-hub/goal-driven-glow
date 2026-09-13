import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser.ts";
import { classifyDialogueState } from "../../supabase/functions/_shared/agent/core/DialogueAct.ts";
import { routeIntent } from "../../supabase/functions/_shared/agent/core/IntentRouter.ts";
import {
  emptyTopicState, resolveTopicForTurn, upsertTopic, type ConversationTopic,
} from "../../supabase/functions/_shared/agent/core/ConversationTopicState.ts";
import {
  canonicalDraftForIntent, isDraftCompatibleWithIntent, scopeToolsToWriteIntent,
} from "../../supabase/functions/_shared/agent/core/WriteIntentContract.ts";
import { expectationFromHistory } from "../../supabase/functions/_shared/agent/core/ConversationExpectation.ts";
import { detectContinuationOffer } from "../../supabase/functions/_shared/agent/core/ContinuationContract.ts";

describe("Nino conversation authority P0 — regressões reais de produção", () => {
  it("meta explícita de R$ 5.000 não cai no fallback de transação", () => {
    const now = new Date("2026-09-13T15:00:00-03:00");
    const parsed = interpret(
      "Nino cria uma meta financeira para eu juntar R$5000 até o final deste ano",
      now,
    );
    expect(parsed.kind).toBe("goal");
    if (parsed.kind !== "goal") throw new Error("goal_not_parsed");
    expect(parsed.target_amount).toBe(5000);
    expect(parsed.target_date).toBe("2026-12-31");
    expect(parsed.name).toMatch(/Juntar R\$ 5\.000/);
  });

  it("pergunta sobre como criar meta continua sendo consulta, não escrita", () => {
    const parsed = interpret("Como criar uma meta de R$ 5.000?");
    expect(parsed.kind).not.toBe("goal");
    expect(parsed.kind).not.toBe("transaction");
  });

  it("turno de meta expõe no máximo o draft de meta", () => {
    const parsed = interpret(
      "Nino cria uma meta financeira para eu juntar R$5000 até o final deste ano",
      new Date("2026-09-13T15:00:00-03:00"),
    );
    const scoped = scopeToolsToWriteIntent([
      "list_accounts",
      "list_categories",
      "create_transaction_draft",
      "create_transfer_draft",
      "create_goal_draft",
      "add_goal_contribution_draft",
      "create_debt_draft",
    ], parsed);
    expect(canonicalDraftForIntent(parsed)).toBe("create_goal_draft");
    expect(scoped).toContain("create_goal_draft");
    expect(scoped).toContain("list_accounts");
    expect(scoped).not.toContain("create_transaction_draft");
    expect(scoped).not.toContain("create_transfer_draft");
    expect(scoped).not.toContain("create_debt_draft");
    expect(isDraftCompatibleWithIntent("create_goal_draft", parsed)).toBe(true);
    expect(isDraftCompatibleWithIntent("create_transaction_draft", parsed)).toBe(false);
  });

  it("repair não chega ao PolicyEngine como cancel, mesmo com parser legado permissivo", () => {
    for (const text of ["não era isso", "não foi isso que te pedi", "você entendeu errado", "está errado"]) {
      expect(routeIntent(text).intent.kind, text).toBe("unknown");
    }
  });

  it("'Quais os estabelecimentos?' é follow-up, não novo tópico", () => {
    const text = "Quais os estabelecimentos?";
    const parsed = interpret(text);
    const dialogue = classifyDialogueState(text, parsed);
    expect(dialogue.acts).toContain("followup");
    expect(dialogue.acts).not.toContain("new_query");

    const base: ConversationTopic = {
      topic_id: "t-food",
      subject: "gastos",
      original_query: "Quanto eu gastei esse mês em alimentação?",
      last_query: "E no mês passado?",
      acts: ["followup"],
      period: { from: "2026-08-01", to: "2026-08-31" },
      entities: ["Alimentação"],
      ir: { category: "Alimentação" },
      execution_summary: { engines: ["analyze_spending"], complete: true },
      evidence_reference: null,
      pending_clarification: null,
      status: "answered",
      updated_at: new Date().toISOString(),
    };
    const state = upsertTopic(emptyTopicState(), base, true);
    const resolved = resolveTopicForTurn({
      state,
      text,
      acts: dialogue.acts,
      period: { from: "2026-09-01", to: "2026-09-13" },
      entities: [],
      explicit_period_override: false,
      explicit_entity_override: false,
    });
    expect(resolved.created).toBe(false);
    expect(resolved.topic.topic_id).toBe("t-food");
    expect(resolved.topic.period).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(resolved.topic.entities).toEqual(["Alimentação"]);
  });

  it("'Por quê?' também continua o foco ativo", () => {
    const parsed = interpret("Por quê?");
    const dialogue = classifyDialogueState("Por quê?", parsed);
    expect(dialogue.acts).toContain("followup");
    expect(dialogue.acts).not.toContain("new_query");
  });

  it("pergunta emocional antiga não é revivida como expectativa atual", () => {
    const now = new Date("2026-09-13T15:49:00-03:00");
    const old = new Date(now.getTime() - 13 * 60 * 60 * 1000).toISOString();
    expect(expectationFromHistory([
      { role: "assistant" as const, content: "Como você está se sentindo hoje?", created_at: old },
    ], now)).toBeNull();
  });

  it("última mensagem proativa substitui uma expectativa emocional antiga", () => {
    const now = new Date("2026-09-13T15:49:00-03:00");
    const old = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const history: Array<{ role: "assistant"; content: string; created_at: string }> = [
      { role: "assistant", content: "Como você está se sentindo hoje?", created_at: old },
      {
        role: "assistant",
        content: "Guardar R$ 317,69 já coloca o plano em movimento. Quer que eu detalhe essa oportunidade?",
        created_at: recent,
      },
    ];
    expect(expectationFromHistory(history, now)).toBeNull();
    expect(detectContinuationOffer(history[1].content, now)).not.toBeNull();
  });
});
