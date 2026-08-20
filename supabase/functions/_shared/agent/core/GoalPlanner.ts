// GoalPlanner (`nino_agent.v1`) — decomposição orientada a objetivo.
//
// O CapabilityRouter escolhe UMA rota por turno. O GoalPlanner responde a outra
// pergunta: "para atender esse pedido, quais passos, em que ordem, e quais
// deles precisam da confirmação do usuário?".
//
// Determinístico e puro: nenhuma chamada de rede. A saída é auditável e vai
// para `agent_decisions.planned_steps`.

import { capabilityByTool, capabilityByKey, type CapabilityEntry, type RiskLevel } from "./CapabilityRegistry.ts";
import { decideAutonomy, type AutonomyDecision } from "./AutonomyPolicy.ts";

export type PlanStepKind = "read" | "compute" | "write" | "confirm";

export type PlanStep = {
  index: number;
  kind: PlanStepKind;
  capability_key: string;
  tool: string;
  label: string;
  risk: RiskLevel;
  /** Passos que precisam ter rodado antes deste. */
  depends_on: number[];
  /** Só para passos de escrita: o que a política decidiu. */
  autonomy: AutonomyDecision | null;
  /** Passo pronto para executar sem perguntar nada ao usuário. */
  ready: boolean;
  /** Motivo curto quando o passo não está pronto. */
  blocked_reason: string | null;
};

export type GoalPlan = {
  goal: string;
  steps: PlanStep[];
  /** Precisa de confirmação explícita em algum passo. */
  requires_confirmation: boolean;
  /** Nada pode ser executado (capacidade desconhecida). */
  refused: boolean;
  /** Resumo em pt-BR, sem jargão, para o Nino explicar o que vai fazer. */
  narration: string;
};

export type PlanRequest = {
  /** Texto original do usuário (só para narração/goal). */
  text: string;
  /** Ferramenta canônica da rota principal do turno. */
  primary_tool: string;
  /** Ferramentas de leitura que precisam rodar antes da escrita. */
  prerequisite_tools?: readonly string[];
  /** Slots completos e resolvidos? */
  complete?: boolean;
  /** Usuário pediu explicitamente ("registra", "confirma"). */
  user_explicit?: boolean;
  /** Turno disparado por proatividade (usuário não pediu). */
  proactive?: boolean;
  amount?: number | null;
};

/** Leituras que sustentam uma escrita: sem elas, o Nino escreve no escuro. */
const READ_PREREQ_BY_DOMAIN: Record<string, string[]> = {
  cards: ["list_credit_cards"],
  goals: ["get_goals_overview"],
  debts: ["get_debt_status"],
};

function stepLabel(entry: CapabilityEntry, kind: PlanStepKind): string {
  if (kind === "read") return `Consultar ${entry.label.toLowerCase()}`;
  if (kind === "confirm") return "Pedir sua confirmação";
  if (kind === "write") return entry.label;
  return entry.label;
}

/**
 * Monta o plano do turno. Escritas nunca entram como passo executável quando a
 * política de autonomia exige confirmação: nesse caso, o plano ganha um passo
 * `confirm` antes do passo `write`, e o `write` fica `ready:false`.
 */
export function buildGoalPlan(req: PlanRequest): GoalPlan {
  const primary = capabilityByTool(req.primary_tool);
  const goal = String(req.text ?? "").trim().slice(0, 200) || (primary?.label ?? "pedido");

  if (!primary) {
    return {
      goal,
      steps: [],
      requires_confirmation: false,
      refused: true,
      narration: "Isso não está entre as coisas que eu sei fazer com segurança hoje.",
    };
  }

  const steps: PlanStep[] = [];
  const push = (partial: Omit<PlanStep, "index">) => {
    steps.push({ ...partial, index: steps.length + 1 });
    return steps.length;
  };

  // 1) Leituras: pré-requisitos explícitos + os do domínio da escrita.
  const reads = new Set<string>(req.prerequisite_tools ?? []);
  if (primary.writes) for (const t of READ_PREREQ_BY_DOMAIN[primary.domain] ?? []) reads.add(t);
  reads.delete(primary.tool);

  const readIndexes: number[] = [];
  for (const tool of reads) {
    const entry = capabilityByTool(tool);
    if (!entry || entry.writes) continue;
    readIndexes.push(push({
      kind: "read", capability_key: entry.key, tool: entry.tool,
      label: stepLabel(entry, "read"), risk: entry.risk,
      depends_on: [], autonomy: null, ready: true, blocked_reason: null,
    }));
  }

  // 2) Passo principal.
  if (!primary.writes) {
    push({
      kind: "compute", capability_key: primary.key, tool: primary.tool,
      label: stepLabel(primary, "compute"), risk: primary.risk,
      depends_on: readIndexes, autonomy: null, ready: true, blocked_reason: null,
    });
    return {
      goal, steps, requires_confirmation: false, refused: false,
      narration: narrate(steps),
    };
  }

  const autonomy = decideAutonomy({
    tool: primary.tool,
    complete: req.complete !== false,
    user_explicit: !!req.user_explicit,
    proactive: !!req.proactive,
    amount: req.amount ?? null,
  });

  const dependsOnConfirm: number[] = [];
  if (autonomy.mode === "draft_then_confirm") {
    dependsOnConfirm.push(push({
      kind: "confirm", capability_key: primary.key, tool: primary.tool,
      label: stepLabel(primary, "confirm"), risk: autonomy.risk,
      depends_on: readIndexes, autonomy, ready: true, blocked_reason: null,
    }));
  }

  push({
    kind: "write", capability_key: primary.key, tool: primary.tool,
    label: stepLabel(primary, "write"), risk: autonomy.risk,
    depends_on: [...readIndexes, ...dependsOnConfirm],
    autonomy,
    ready: autonomy.mode === "auto_execute",
    blocked_reason: autonomy.mode === "auto_execute" ? null : autonomy.reason,
  });

  return {
    goal,
    steps,
    requires_confirmation: autonomy.mode === "draft_then_confirm",
    refused: autonomy.mode === "refuse",
    narration: narrate(steps),
  };
}

/** Plano a partir de uma chave de capacidade (usado por rotas proativas). */
export function planForCapabilityKey(key: string, req: Omit<PlanRequest, "primary_tool">): GoalPlan {
  const entry = capabilityByKey(key);
  return buildGoalPlan({ ...req, primary_tool: entry?.tool ?? "" });
}

function narrate(steps: PlanStep[]): string {
  if (steps.length === 0) return "";
  const parts = steps.map((s) => (s.kind === "confirm" ? "confirmar com você" : s.label.toLowerCase()));
  return parts.join(" → ");
}

/** Forma compacta para telemetria/auditoria (`agent_decisions.planned_steps`). */
export function planToSteps(plan: GoalPlan): Array<Record<string, unknown>> {
  return plan.steps.map((s) => ({
    index: s.index,
    kind: s.kind,
    tool: s.tool,
    capability: s.capability_key,
    risk: s.risk,
    ready: s.ready,
    blocked_reason: s.blocked_reason,
    autonomy_mode: s.autonomy?.mode ?? null,
    autonomy_reason: s.autonomy?.reason ?? null,
    depends_on: s.depends_on,
  }));
}
