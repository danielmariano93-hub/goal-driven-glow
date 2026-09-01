/**
 * nino_home_editorial.v1 — view model editorial da Home.
 *
 * A Home NÃO decide o que é importante: ela apresenta a escolha já feita.
 * Este módulo apenas seleciona e traduz o que os motores canônicos já
 * produziram (diagnóstico, fila determinística de leituras e recomendação do
 * Change Agent) em UM item principal (Spotlight) e até TRÊS leituras
 * secundárias compactas (Insight Stack).
 *
 * Regras invioláveis:
 *  - não calcula, não arredonda e não deriva dinheiro;
 *  - não cria outro ranking: reaproveita severidade, relevância e a fila canônica;
 *  - jargão técnico (stage, confidence, priority score...) nunca chega à UI;
 *  - progresso/estabilidade só viram Spotlight quando não existe decisão melhor;
 *  - a mesma decisão nunca aparece duas vezes (Spotlight + apoio).
 */
import { composeNinoDecisionNarrative, isSameDecision, type NinoDecisionNarrative } from "@/lib/copy/decisionNarrative";
import { diagnosisActionLabel, diagnosisRouteForSituation } from "@/lib/nino/actions";
import { buildNinoReadingQueue, type NinoReading } from "@/lib/nino/rotation";
import type { FinancialSituation, HomeDiagnosisView, NinoDiagnosisContext } from "@/lib/nino/diagnosis";
import type { NinoNextStep } from "@/lib/nino/nextStep";

export type NinoEditorialTone = "critical" | "attention" | "decision" | "opportunity" | "progress" | "neutral";

export type NinoEditorialActionKind = "accept" | "link";

export type NinoEditorialAction = {
  kind: NinoEditorialActionKind;
  label: string;
  route: string | null;
};

/** Ordem canônica de importância (1 = mais importante). Nunca vai para a UI como texto. */
export const NINO_EDITORIAL_PRIORITY = {
  critical_risk: 1,
  next_best_action: 2,
  high_attention: 3,
  action_window: 4,
  opportunity: 5,
  progress: 6,
  stability: 7,
} as const;

export type NinoSpotlightItem = {
  id: string;
  situationId: string | null;
  semanticType: string;
  eyebrow: string;
  headline: string;
  supportingText: string | null;
  mainValue: number | null;
  mainValueSuffix: string | null;
  tone: NinoEditorialTone;
  priority: number;
  primaryAction: NinoEditorialAction | null;
  secondaryAction: NinoEditorialAction | null;
};

export type NinoSupportingItem = {
  id: string;
  situationId: string;
  semanticType: string;
  title: string;
  supportingText: string | null;
  tone: NinoEditorialTone;
  route: string;
  priority: number;
};

export type NinoHomeEditorialView = {
  primary: NinoSpotlightItem | null;
  supporting: NinoSupportingItem[];
  totalAvailable: number;
  lastUpdatedAt: string | null;
};

/** Teto absoluto de leituras de apoio (desktop / itens materialmente distintos). */
export const NINO_SUPPORTING_LIMIT = 3;
/** Padrão da Home: duas leituras de apoio. A terceira só entra se for outro assunto. */
export const NINO_SUPPORTING_DEFAULT = 2;

const HEADLINE_MAX = 65;
const SPOTLIGHT_BODY_MAX = 140;
const SUPPORTING_TITLE_MAX = 48;
const SUPPORTING_BODY_MAX = 60;

/** Metadata de detector nunca é linguagem de Home. */
const TECHNICAL_METADATA = /(amostra|confian[cç]a|percentil|desvio[- ]padr|relev[âa]ncia|score|p\d{2}\b)/i;
const TECHNICAL_REPLACEMENT = "Padrão recorrente no seu histórico";

function clean(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Resumo editorial por sentença: nunca corta número nem decisão no meio. */
export function compactSentence(value: string | null | undefined, max: number): string | null {
  const text = clean(value);
  if (!text) return null;
  if (text.length <= max) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const sentence of sentences) {
    if (!out) {
      out = sentence;
      if (out.length <= max) continue;
      break;
    }
    if (`${out} ${sentence}`.length > max) break;
    out = `${out} ${sentence}`;
  }
  if (out.length <= max) return out;
  const cut = out.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 20 ? space : max).trim()}…`;
}

/**
 * Sanitiza subtítulo de apoio: significado em vez de metadata do detector.
 * O texto técnico continua íntegro na tela detalhada, na evidência e no Admin.
 */
export function humanizeSupportingText(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  return TECHNICAL_METADATA.test(text) ? TECHNICAL_REPLACEMENT : text;
}

function semanticKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9á-ú]+/gi, " ")
    .trim();
}

/** Assunto canônico da leitura (meta, dívida, entidade, domínio). */
function subjectKey(situation: FinancialSituation | null, step?: NinoNextStep | null): string {
  const evaluation = (situation?.evaluation ?? {}) as Record<string, unknown>;
  const candidates = [
    step?.goalId,
    evaluation.goal_id,
    evaluation.debt_id,
    evaluation.entity_id,
    evaluation.category_id,
    evaluation.merchant_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return `id:${candidate.trim().toLowerCase()}`;
  }
  const names = [step?.goalName, evaluation.goal_name, evaluation.entity_name, evaluation.merchant];
  for (const name of names) {
    if (typeof name === "string" && name.trim()) return `name:${semanticKey(name)}`;
  }
  return "";
}


function toneForSituation(situation: FinancialSituation): NinoEditorialTone {
  if (situation.severity === "critical") return "critical";
  if (situation.severity === "attention") return "attention";
  if (situation.severity === "positive") return "progress";
  return "neutral";
}

function toneForNarrative(narrative: NinoDecisionNarrative, fromStep: boolean): NinoEditorialTone {
  if (narrative.tone === "risk") return "critical";
  if (narrative.tone === "progress") return "progress";
  if (narrative.tone === "opportunity") return "opportunity";
  return fromStep ? "decision" : "attention";
}

function eyebrowFor(tone: NinoEditorialTone, fromStep: boolean): string {
  if (tone === "critical") return "Atenção";
  if (tone === "attention") return fromStep ? "Próximo passo" : "Atenção";
  if (tone === "opportunity") return "Oportunidade";
  if (tone === "progress") return "Progresso";
  if (tone === "decision") return "Próximo passo";
  return "Orientação do Nino";
}

function priorityForSituation(situation: FinancialSituation): number {
  if (situation.severity === "critical") return NINO_EDITORIAL_PRIORITY.critical_risk;
  if (situation.severity === "attention") return NINO_EDITORIAL_PRIORITY.high_attention;
  if (situation.temporal_scope === "future") return NINO_EDITORIAL_PRIORITY.action_window;
  if (situation.severity === "positive") return NINO_EDITORIAL_PRIORITY.progress;
  return NINO_EDITORIAL_PRIORITY.opportunity;
}

function toAction(cta: NinoDecisionNarrative["primaryCta"]): NinoEditorialAction | null {
  if (!cta) return null;
  const label = clean(cta.label);
  if (!label) return null;
  if (cta.kind === "accept") return { kind: "accept", label, route: cta.route ?? null };
  return { kind: "link", label, route: cta.route };
}

function fallbackAction(situation: FinancialSituation | null): NinoEditorialAction | null {
  if (!situation) return null;
  const route = diagnosisRouteForSituation(situation, null);
  const label = clean(diagnosisActionLabel(situation, null));
  if (!route || !label) return null;
  return { kind: "link", label, route };
}


/**
 * Spotlight: o Nino escolheu isso. A decisão do Change Agent lidera, exceto
 * quando existe um risco crítico que não é a mesma decisão — nesse caso o risco
 * vem primeiro e a decisão desce para o apoio.
 */
function buildSpotlight(
  diagnosis: HomeDiagnosisView | null,
  nextStep: NinoNextStep | null,
): { item: NinoSpotlightItem; usedSituationId: string | null; usedStep: boolean; subject: string } | null {
  const situation = diagnosis?.primary ?? null;
  const same = isSameDecision(situation, nextStep);
  const criticalFirst = situation?.severity === "critical" && !same;
  const useStep = Boolean(nextStep) && !criticalFirst;

  const narrative = composeNinoDecisionNarrative({
    situation,
    action: diagnosis?.hasTrustedAction ? diagnosis.action : null,
    nextStep: useStep ? nextStep : null,
  });
  if (!narrative) return null;

  const tone = toneForNarrative(narrative, useStep);
  const priority = criticalFirst
    ? NINO_EDITORIAL_PRIORITY.critical_risk
    : useStep
      ? NINO_EDITORIAL_PRIORITY.next_best_action
      : situation
        ? priorityForSituation(situation)
        : NINO_EDITORIAL_PRIORITY.stability;

  // Home usa a variante compacta: conclusão curta + uma evidência.
  const headline = compactSentence(narrative.compact.headline, HEADLINE_MAX) ?? narrative.compact.headline;
  const body = compactSentence(narrative.compact.body, SPOTLIGHT_BODY_MAX);

  return {
    usedSituationId: useStep && !same ? null : situation?.id ?? null,
    usedStep: useStep,
    subject: subjectKey(situation, useStep ? nextStep : null),
    item: {
      id: useStep && nextStep ? nextStep.id : situation?.id ?? "nino-spotlight",
      situationId: situation?.id ?? null,
      semanticType: useStep ? "next_best_action" : situation?.situation_type ?? "guidance",
      eyebrow: eyebrowFor(tone, useStep),
      headline,
      supportingText: body,
      mainValue: narrative.primaryAmount?.value ?? null,
      mainValueSuffix: narrative.primaryAmount?.caption ? clean(narrative.primaryAmount.caption) : null,
      tone,
      priority,
      // Spotlight sem CTA não converte: quando o motor não anexou ação confiável,
      // usamos o destino canônico da própria situação (rota já existente).
      primaryAction: toAction(narrative.primaryCta) ?? fallbackAction(situation),
      secondaryAction: toAction(narrative.secondaryCta),
    },
  };
}

type SupportingCandidate = NinoSupportingItem & { subject: string };

function toSupporting(reading: NinoReading): SupportingCandidate | null {
  const situation = reading.situation;
  const title = clean(situation.one_line_summary) ?? clean(situation.headline);
  if (!title) return null;
  const body = humanizeSupportingText(
    compactSentence(situation.cause_summary ?? situation.consequence_summary, SUPPORTING_BODY_MAX),
  );
  return {
    id: situation.id,
    situationId: situation.id,
    semanticType: situation.situation_type,
    title: compactSentence(title, SUPPORTING_TITLE_MAX) ?? title,
    supportingText: body ?? clean(diagnosisActionLabel(situation, reading.action)),
    tone: toneForSituation(situation),
    route: diagnosisRouteForSituation(situation, reading.action),
    priority: priorityForSituation(situation),
    subject: subjectKey(situation),
  };
}

export function buildNinoHomeEditorialView(input: {
  context: NinoDiagnosisContext | null;
  diagnosis: HomeDiagnosisView | null;
  nextStep: NinoNextStep | null;
  now?: number;
}): NinoHomeEditorialView {
  const { context, diagnosis, nextStep } = input;
  const spotlight = buildSpotlight(diagnosis, nextStep ?? null);

  const queue = context
    ? buildNinoReadingQueue(context, {
        suppressedIds: context.suppressed_situation_ids ?? [],
        now: input.now,
      })
    : [];

  const usedId = spotlight?.usedSituationId ?? null;
  const usedKey = spotlight ? semanticKey(spotlight.item.headline) : "";
  const usedSubject = spotlight?.subject ?? "";
  const usedName = usedSubject.startsWith("name:") ? usedSubject.slice(5) : "";

  const eligible = queue
    .map(toSupporting)
    .filter((item): item is SupportingCandidate => Boolean(item))
    .filter((item) => {
      if (usedId && item.situationId === usedId) return false;
      // Dedup por assunto canônico: mesma meta/entidade não repete na Home.
      if (usedSubject && item.subject === usedSubject) return false;
      const key = semanticKey(item.title);
      if (usedName && key.includes(usedName)) return false;
      if (!usedKey || !key) return true;
      return key !== usedKey && !usedKey.includes(key) && !key.includes(usedKey);
    })
    .sort((a, b) => a.priority - b.priority);

  // Padrão: 2 leituras de apoio. A terceira só entra quando é outro assunto.
  const chosen: SupportingCandidate[] = eligible.slice(0, NINO_SUPPORTING_DEFAULT);
  const third = eligible[NINO_SUPPORTING_DEFAULT];
  if (
    third &&
    chosen.length === NINO_SUPPORTING_DEFAULT &&
    !chosen.some(
      (item) =>
        item.semanticType === third.semanticType || (Boolean(item.subject) && item.subject === third.subject),
    )
  ) {
    chosen.push(third);
  }

  return {
    primary: spotlight?.item ?? null,
    supporting: chosen.slice(0, NINO_SUPPORTING_LIMIT).map(({ subject: _subject, ...item }) => item),
    totalAvailable: eligible.length + (spotlight ? 1 : 0),
    lastUpdatedAt: diagnosis?.asOf ?? context?.as_of ?? null,
  };
}

