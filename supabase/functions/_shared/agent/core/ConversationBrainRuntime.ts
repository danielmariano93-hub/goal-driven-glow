// ConversationBrainRuntime (`nino_conversation_brain.v1`)
// Runtime determinístico do Turn Contract. Nesta fase ele assume WRITE:
// ActionIR -> slot binding -> workflow durável -> UMA draft tool compatível.
// Nunca faz commit financeiro direto e nunca troca a ação interpretada.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { mergeActionSlots, toolForAction, validateActionIR } from "./ActionIR.ts";
import { bindActionSlots } from "./ActionSlotResolver.ts";
import type { ConversationTurnContract } from "./ConversationTurnContract.ts";
import {
  closeWorkflow, loadWorkflow, nextStep, saveWorkflow, type WriteWorkflow,
} from "./WriteWorkflowManager.ts";
import { runTool } from "./ToolRuntime.ts";
import type { TurnEvidenceCache } from "./TurnEvidenceCache.ts";

export type BrainWriteOutcome = {
  handled: boolean;
  reply: string;
  reply_kind: "draft" | "question" | "info";
  draft_id?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: unknown;
  error?: string | null;
};

function draftText(result: any): string {
  const card = String(result?.card_text ?? "").trim();
  if (card) return card;
  const summary = String(result?.summary ?? "").trim();
  if (summary) return `${summary}\n\nConfirma?`;
  return "Deixei o rascunho pronto. Confirma?";
}

export function workflowFromContract(
  contract: ConversationTurnContract,
  existing: WriteWorkflow | null,
  now: Date = new Date(),
): { workflow: WriteWorkflow | null; conflict: boolean } {
  if (contract.mode !== "write" || !contract.action) return { workflow: null, conflict: false };
  const tool = toolForAction(contract.action.action);
  const currentSlots = bindActionSlots(contract.action, now);

  if (existing && existing.kind !== tool) {
    // Follow-up/repair nunca pode trocar silenciosamente o domínio da escrita.
    if (contract.act !== "new_request" && contract.act !== "topic_switch") {
      return { workflow: null, conflict: true };
    }
    return {
      workflow: {
        id: null,
        kind: tool,
        slots: mergeActionSlots(null, currentSlots),
        asked_slot: null,
        turns: 1,
      },
      conflict: false,
    };
  }

  return {
    workflow: {
      id: existing?.id ?? null,
      kind: tool,
      slots: mergeActionSlots(existing?.slots, currentSlots),
      asked_slot: null,
      turns: (existing?.turns ?? 0) + 1,
    },
    conflict: false,
  };
}

export async function executeBrainWriteTurn(args: {
  sb: SupabaseClient;
  user_id: string;
  conversation_id: string;
  user_text: string;
  contract: ConversationTurnContract;
  evidenceCache?: TurnEvidenceCache;
}): Promise<BrainWriteOutcome> {
  if (args.contract.mode !== "write" || !args.contract.action) {
    return { handled: false, reply: "", reply_kind: "info" };
  }

  const errors = validateActionIR(args.contract.action);
  if (errors.length) {
    return {
      handled: true,
      reply: "Quero confirmar o que você quer fazer antes de mexer em qualquer registro. Pode me dizer a ação de outra forma?",
      reply_kind: "question",
      error: `action_ir_invalid:${errors.join(",")}`,
    };
  }

  const existing = await loadWorkflow(args.sb, {
    user_id: args.user_id,
    conversation_id: args.conversation_id,
  });
  const built = workflowFromContract(args.contract, existing);
  if (built.conflict || !built.workflow) {
    return {
      handled: true,
      reply: "Você quer continuar a operação que já estava em andamento ou começar essa nova?",
      reply_kind: "question",
      error: "write_workflow_domain_conflict",
    };
  }

  if (existing && existing.kind !== built.workflow.kind) {
    await closeWorkflow(args.sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      outcome: "abandoned",
    });
  }

  const step = nextStep(built.workflow);
  if (step.status === "abandoned") {
    await closeWorkflow(args.sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      outcome: "abandoned",
    });
    return {
      handled: true,
      reply: "Esse pedido ficou incompleto por muitas mensagens. Me diga a operação novamente e eu recomeço limpo.",
      reply_kind: "question",
      error: `write_workflow_abandoned:${step.reason}`,
    };
  }

  if (step.status === "needs_slot") {
    await saveWorkflow(args.sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      workflow: { ...built.workflow, asked_slot: step.slot },
    });
    return {
      handled: true,
      reply: step.question,
      reply_kind: "question",
      tool_name: step.kind,
    };
  }

  const exec = await runTool(
    {
      sb: args.sb,
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      user_text: args.user_text,
      evidenceCache: args.evidenceCache,
    } as any,
    step.kind,
    step.args,
    { timeoutMs: 12_000, maxRetries: 0 },
  );

  if (!exec.ok && exec.error === "account_not_found") {
    // 2+ contas e nenhuma citada: é uma pergunta, não uma falha. Mantém a intenção viva.
    const { data: accs } = await args.sb.from("accounts").select("name")
      .eq("user_id", args.user_id).eq("active", true).order("name");
    const names = ((accs ?? []) as Array<{ name: string | null }>).map((a) => a.name).filter(Boolean) as string[];
    if (names.length) {
      await saveWorkflow(args.sb, {
        user_id: args.user_id,
        conversation_id: args.conversation_id,
        workflow: { ...built.workflow, asked_slot: "account" },
      });
      return {
        handled: true,
        reply: `Em qual conta eu registro? Você tem: ${names.join(", ")}.`,
        reply_kind: "question",
        tool_name: step.kind,
        tool_args: step.args,
        error: null,
      };
    }
  }

  if (!exec.ok) {
    // Mantém workflow aberto: erro de execução não pode apagar a intenção.
    await saveWorkflow(args.sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      workflow: built.workflow,
    });
    return {
      handled: true,
      reply: "Entendi o que você quer fazer, mas não consegui preparar o rascunho agora. Nenhum dado foi alterado.",
      reply_kind: "info",
      tool_name: step.kind,
      tool_args: step.args,
      error: exec.error ?? "brain_write_tool_error",
    };
  }

  const result: any = exec.result ?? {};
  // O adaptador pediu um dado que só a pessoa sabe (ex.: categoria de um
  // estabelecimento ainda sem histórico): pergunta e mantém a intenção viva.
  if (result?.needs_input) {
    await saveWorkflow(args.sb, {
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      workflow: { ...built.workflow, asked_slot: result.slot ? String(result.slot) : null },
    });
    return {
      handled: true,
      reply: String(result.card_text ?? "Pode me dar mais um detalhe?"),
      reply_kind: "question",
      tool_name: step.kind,
      tool_args: step.args,
      error: null,
    };
  }
  await closeWorkflow(args.sb, {
    user_id: args.user_id,
    conversation_id: args.conversation_id,
    outcome: "completed",
  });
  return {
    handled: true,
    reply: draftText(result),
    reply_kind: "draft",
    draft_id: result?.draft_id ? String(result.draft_id) : undefined,
    tool_name: step.kind,
    tool_args: step.args,
    tool_result: exec.result,
    error: null,
  };
}
