// TurnComplexityClassifier (`nino_adaptive.v1`)
//
// Sinais BARATOS e determinísticos do turno: nenhuma chamada de modelo, nenhuma
// consulta ao banco. Só o texto, o estado de pendência e a existência de
// tópicos abertos. Servem para decidir QUANTA computação o turno merece.
//
// Regra dura: este módulo nunca decide verdade financeira e nunca formata
// resposta. Ele apenas mede dificuldade.

export type TurnSignals = {
  complexity_score: number;          // 0..1
  ambiguity_score: number;           // 0..1
  risk_score: number;                // 0..1 (risco de WRITE / dinheiro)
  context_dependency_score: number;  // 0..1
  financial_reasoning_score: number; // 0..1
  expected_tool_count: number;
  evidence_availability: number;     // 0..1 (quanto já está determinado)
  conversation_resume_probability: number; // 0..1
};

export type ClassifierInput = {
  text: string;
  has_pending_confirmation?: boolean;
  confirmation_act?: "confirm" | "cancel" | "ambiguous" | "none" | null;
  structured_bank_event?: boolean;
  quoted_message_id?: string | null;
  open_topic_count?: number;
  awaiting_answer?: boolean;
};

const norm = (t: string): string =>
  String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

/** Marcas de dependência de contexto: pronome solto, elipse, follow-up curto. */
const ANAPHORA_RX =
  /\b(isso|isto|aquilo|aquele|aquela|esse|essa|ele|ela|dele|dela|nisso|disso|nesse|nessa|o mesmo|a mesma)\b/;
const FOLLOWUP_RX =
  /^(e|mas|entao|então|ok e|so|só|tambem|também)\b|^\s*(por que|porque|pq|quais|quanto|quando|e no cartao|e em)\b/;
const RESUME_RX =
  /\b(voltando|retomando|sobre aquilo|aquela pergunta|aquele assunto|como eu disse|falamos (?:antes|ontem)|lembra (?:quando|que))\b/;

/** Comparação, tendência, causalidade, hipótese: raciocínio financeiro alto. */
const REASONING_RX =
  /\b(compar|comparando|tendencia|padrao|padrão|virou (?:um )?padrao|estrutural|evolu|melhorando|piorando|por que|porque|causa|explica|se eu|caso eu|simul|proje|vale a pena|deveria)\b/;

/** Multi-domínio: cada domínio citado tende a somar uma ferramenta. */
const DOMAIN_RX: Array<[RegExp, string]> = [
  [/\bgast|despesa|categor|estabelec|mercado|uber|transporte|alimenta/, "gastos"],
  [/\bmeta|objetivo\b/, "metas"],
  [/\bdivid|divida|parcel|emprestim/, "dividas"],
  [/\bcart[ao]|fatura|credito/, "cartao"],
  [/\bsaldo|conta|dispon[ií]vel|caixa/, "saldo"],
  [/\breceita|renda|salario|recebi|entrou/, "receita"],
  [/\binvestiment|patrim/, "patrimonio"],
];

const WRITE_RX =
  /\b(gastei|paguei|comprei|recebi|lancei|lançei|registra|registrar|anota|anotar|salvar|salva|transferi|pix)\b/;

export function domainsIn(text: string): string[] {
  const t = norm(text);
  const out: string[] = [];
  for (const [rx, name] of DOMAIN_RX) if (rx.test(t)) out.push(name);
  return out;
}

export function classifyTurn(input: ClassifierInput): TurnSignals {
  const raw = String(input.text ?? "");
  const t = norm(raw);
  const words = t.split(/\s+/).filter(Boolean);
  const act = input.confirmation_act ?? "none";

  // --- Transição de estado pura: tudo já está determinado -------------------
  if (input.has_pending_confirmation && (act === "confirm" || act === "cancel")) {
    return {
      complexity_score: 0, ambiguity_score: 0,
      risk_score: act === "confirm" ? 0.9 : 0.1,
      context_dependency_score: 0, financial_reasoning_score: 0,
      expected_tool_count: act === "confirm" ? 1 : 0,
      evidence_availability: 1, conversation_resume_probability: 0,
    };
  }

  if (input.structured_bank_event) {
    return {
      complexity_score: 0.1, ambiguity_score: 0.1, risk_score: 0.8,
      context_dependency_score: 0, financial_reasoning_score: 0.1,
      expected_tool_count: 1, evidence_availability: 0.9,
      conversation_resume_probability: 0,
    };
  }

  const domains = domainsIn(t);
  const questionMarks = (raw.match(/\?/g) ?? []).length;
  const hasReasoning = REASONING_RX.test(t);
  const anaphora = ANAPHORA_RX.test(t);
  // "quanto gastei em transporte esse mês?" começa com pronome interrogativo,
  // mas traz assunto próprio: não é follow-up dependente de contexto.
  const followup = FOLLOWUP_RX.test(t) && (domains.length === 0 || words.length <= 4);
  const resume = RESUME_RX.test(t);
  const short = words.length <= 6;

  const financial_reasoning_score = clamp01(
    (hasReasoning ? 0.6 : 0) +
    (domains.length >= 2 ? 0.2 : 0) +
    (/\b(tres|3|ultimos|últimos)\s+(meses|mes)\b/.test(t) ? 0.2 : 0),
  );

  const expected_tool_count = Math.max(
    domains.length > 0 ? domains.length : 1,
    hasReasoning && domains.length >= 2 ? domains.length + 1 : domains.length || 1,
  );

  const complexity_score = clamp01(
    financial_reasoning_score * 0.5 +
    Math.min(domains.length, 4) * 0.12 +
    (questionMarks > 1 ? 0.15 : 0) +
    (words.length > 24 ? 0.15 : 0),
  );

  const context_dependency_score = clamp01(
    (anaphora ? 0.5 : 0) +
    (followup && short ? 0.4 : followup ? 0.2 : 0) +
    (resume ? 0.5 : 0) +
    (input.quoted_message_id ? 0.4 : 0) +
    (input.awaiting_answer ? 0.2 : 0) -
    (domains.length >= 1 && !anaphora && !followup && !resume ? 0.2 : 0),
  );

  const openTopics = Math.max(0, input.open_topic_count ?? 0);
  const ambiguity_score = clamp01(
    (anaphora && openTopics >= 2 ? 0.6 : anaphora ? 0.3 : 0) +
    (short && domains.length === 0 && !input.has_pending_confirmation ? 0.3 : 0) +
    (act === "ambiguous" ? 0.3 : 0) -
    (input.quoted_message_id ? 0.5 : 0),
  );

  const risk_score = clamp01(
    (WRITE_RX.test(t) ? 0.7 : 0) +
    (input.has_pending_confirmation ? 0.2 : 0),
  );

  const evidence_availability = clamp01(
    (domains.length >= 1 ? 0.4 : 0) +
    (/\b(este mes|esse mes|mes passado|hoje|ontem|semana|agosto|setembro|outubro|novembro|dezembro|janeiro|fevereiro|marco|abril|maio|junho|julho)\b/.test(t) ? 0.3 : 0.1) +
    (anaphora || followup ? 0 : 0.2) +
    (input.quoted_message_id ? 0.2 : 0),
  );

  const conversation_resume_probability = clamp01(
    (input.quoted_message_id ? 1 : 0) ||
    ((resume ? 0.8 : 0) + (anaphora ? 0.4 : 0) + (followup && short ? 0.4 : 0) +
     (openTopics >= 1 ? 0.1 : -0.2)),
  );

  return {
    complexity_score, ambiguity_score, risk_score, context_dependency_score,
    financial_reasoning_score, expected_tool_count, evidence_availability,
    conversation_resume_probability,
  };
}
