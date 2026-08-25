/**
 * CommunicationIntent (`nino_comm.v1`) — camada de INTENÇÃO de comunicação.
 *
 * ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/copy/commIntent.ts
 * (gerado por scripts/sync-finance-core.mjs — não editar o espelho à mão).
 *
 * Regra dura: esta camada é DERIVAÇÃO, não fonte. Ela não soma, não divide,
 * não estima e não cria número novo — apenas escolhe o que dizer primeiro,
 * o que dizer depois e o que fica escondido. Toda superfície (card do app,
 * relatório, WhatsApp, push, recibo) consome o MESMO intent para que App e
 * WhatsApp nunca divirjam.
 */
import { confidencePhrase, humanizeJargon, limitSentences, type CommSurface } from "./ninoVoice";
import { money, type NumberContext } from "./numbers";

export type CommSeverity = "info" | "attention" | "critical" | "positive";

/** Fonte já calculada (situação do diagnóstico, item de insight, destaque). */
export type CommSource = {
  headline?: string | null;
  one_line_summary?: string | null;
  title?: string | null;
  summary?: string | null;
  explanation?: string | null;
  cause_summary?: string | null;
  consequence_summary?: string | null;
  forecast_summary?: string | null;
  impact_amount?: number | null;
  severity?: string | null;
  priority?: number | null;
  confidence?: number | null;
  action_label?: string | null;
  action_route?: string | null;
};

export type CommunicationIntent = {
  /** Nível 1: a conclusão. Uma frase, sem indicador cru. */
  conclusion: string;
  /** Nível 1: por que isso importa. Uma frase, opcional. */
  why_it_matters: string | null;
  /** Nível 1: peso financeiro já formatado para a superfície (ou null). */
  impact_label: string | null;
  /** Nível 2: até 2 frases de apoio, sob demanda. */
  supporting: string[];
  /** Nível 3: como o Nino chegou aqui, sem número de confiança. */
  detail: string[];
  severity: CommSeverity;
  priority: number;
  action: { label: string; route: string } | null;
};

function firstSentence(text: string | null | undefined): string {
  const clean = humanizeJargon(text);
  if (!clean) return "";
  const first = clean.split(/(?<=[.!?])\s+/).find((part) => part.trim().length > 0) ?? clean;
  return limitSentences(first.trim(), "card").trim();
}

function normalizeSeverity(value: string | null | undefined): CommSeverity {
  if (value === "critical" || value === "attention" || value === "positive") return value;
  return "info";
}

/** Contexto numérico por superfície: leitura compacta, prova exata. */
export function numberContextFor(surface: CommSurface): NumberContext {
  if (surface === "receipt") return "receipt";
  if (surface === "card_detail") return "detail";
  if (surface === "whatsapp") return "alert";
  if (surface === "report") return "summary";
  return "card";
}

export function buildCommunicationIntent(source: CommSource, surface: CommSurface = "card"): CommunicationIntent {
  const conclusionRaw = source.one_line_summary || source.headline || source.title || source.summary || "";
  const conclusion = firstSentence(conclusionRaw) || "Sem novidades relevantes na sua leitura de hoje.";

  const whyCandidates = [source.summary, source.cause_summary, source.consequence_summary]
    .map((t) => firstSentence(t))
    .filter((t) => t.length > 0 && t !== conclusion);
  const why_it_matters = whyCandidates[0] ?? null;

  const supporting = [source.consequence_summary, source.forecast_summary, source.explanation]
    .map((t) => firstSentence(t))
    .filter((t) => t.length > 0 && t !== conclusion && t !== why_it_matters)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 2);

  const impact = typeof source.impact_amount === "number" && Math.abs(source.impact_amount) > 0
    ? Math.abs(source.impact_amount)
    : null;

  const detail = [
    ...[source.cause_summary, source.consequence_summary, source.forecast_summary]
      .map((t) => humanizeJargon(t))
      .filter((t) => t.length > 0),
    confidencePhrase(source.confidence),
  ];

  return {
    conclusion,
    why_it_matters,
    impact_label: impact ? `Peso no seu mês: ${money(impact, numberContextFor(surface))}` : null,
    supporting,
    detail,
    severity: normalizeSeverity(source.severity),
    priority: Number(source.priority ?? 0),
    action: source.action_label && source.action_route
      ? { label: source.action_label, route: source.action_route }
      : null,
  };
}

/**
 * Texto de canal conversacional (WhatsApp/push): conclusão + contexto +
 * pergunta específica. Sem cabeçalho de dashboard, sem parágrafo analítico.
 */
export function intentToConversationalText(intent: CommunicationIntent, question: string): string {
  const lines = [intent.conclusion];
  if (intent.why_it_matters) lines.push(intent.why_it_matters);
  if (intent.impact_label) lines.push(intent.impact_label);
  lines.push(question);
  return lines.slice(0, 4).join("\n");
}
