// IntentResolver — reconhecimento de intenção de LEITURA por significado, não
// por frase enumerada (`nino_intent.v1`).
//
// Causa-raiz que este módulo fecha: o roteador determinístico só reconhecia
// intenção por listas fechadas de expressões. "Quero saber como o mês está
// indo, de forma detalhada" não estava na lista, caiu em `general`, exigiu
// modelo e morreu num 403 de crédito — para uma pergunta que os motores
// canônicos respondem sozinhos.
//
// Aqui a intenção é resolvida por SIMILARIDADE contra exemplares canônicos de
// cada capacidade de leitura, com exigência de âncora de objeto financeiro.
// Nenhum número nasce aqui: o resolver só escolhe qual motor canônico responde.

export type ReadIntentName =
  | "month_report"
  | "holistic_assessment"
  | "financial_performance"
  | "financial_snapshot"
  | "forecast_month_close"
  | "debt_status"
  | "goals_overview"
  | "recent_transactions";

export type ResolvedReadIntent = {
  name: ReadIntentName;
  required_tool: string;
  allowed_tools: readonly string[];
  score: number;
  matched: string;
};

/** Palavras sem valor de intenção — removidas antes de comparar. */
const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
  "para", "pra", "por", "com", "sem", "e", "ou", "que", "se", "me", "meu", "minha", "meus", "minhas",
  "eu", "voce", "vc", "nino", "por favor", "favor", "ai", "agora", "ja", "so", "mais", "bem",
  "quero", "queria", "gostaria", "poderia", "pode", "podes", "saber", "ver", "olhar", "dar",
  "uma", "olhada", "forma", "jeito", "modo", "detalhada", "detalhado", "detalhe", "detalhes",
  "completo", "completa", "resumida", "rapido", "rapidamente", "favorzinho", "diz", "dizer",
  "fala", "falar", "conta", "contar", "explica", "explicar", "mostra", "mostrar", "manda", "mandar",
  "passa", "passar", "traz", "trazer", "sobre", "the", "tudo", "coisa", "coisas", "hoje",
]);

/**
 * Objetos financeiros que precisam aparecer para o resolver assumir leitura.
 * Sem âncora, qualquer frase solta pareceria uma consulta financeira.
 */
const OBJECT_ANCHORS = [
  "mes", "meses", "financa", "financas", "financeira", "financeiro", "financeiramente",
  "saldo", "dinheiro", "grana", "gasto", "gastos", "gastei", "gastando", "despesa", "despesas",
  "conta", "contas", "divida", "dividas", "devo", "meta", "metas", "orcamento",
  "fatura", "cartao", "lancamento", "lancamentos", "sobra", "sobrando", "situacao", "vida",
  "patrimonio", "receita", "renda", "fechamento", "fechar", "extrato", "relatorio", "resumo",
  "desempenho", "performance", "balanco", "panorama", "disponivel", "tenho",
  // Âncoras de estado/avaliação: "estou melhorando ou piorando?" é pergunta
  // financeira mesmo sem citar o objeto.
  "melhorando", "piorando", "melhorei", "piorei", "economizando", "poupando", "devendo",
];

type Exemplar = { name: ReadIntentName; text: string };

/**
 * Exemplares canônicos por capacidade. Ampliar esta lista é barato e seguro:
 * ela não decide número nenhum, só qual motor determinístico atende.
 */
const EXEMPLARS: Exemplar[] = [
  // Leitura do mês corrente / relatório
  { name: "month_report", text: "como o mes esta indo" },
  { name: "month_report", text: "como esta meu mes" },
  { name: "month_report", text: "como anda o meu mes" },
  { name: "month_report", text: "como esta indo o mes de forma detalhada" },
  { name: "month_report", text: "me explica o meu mes" },
  { name: "month_report", text: "resumo do mes" },
  { name: "month_report", text: "relatorio do mes" },
  { name: "month_report", text: "balanco do mes" },
  { name: "month_report", text: "extrato do mes" },
  { name: "month_report", text: "como foi o mes" },
  { name: "month_report", text: "panorama do mes" },
  { name: "month_report", text: "como estao os gastos do mes" },

  // Avaliação global
  { name: "holistic_assessment", text: "como estao minhas financas" },
  { name: "holistic_assessment", text: "como estou financeiramente" },
  { name: "holistic_assessment", text: "estou melhorando ou piorando" },
  { name: "holistic_assessment", text: "minha saude financeira" },
  { name: "holistic_assessment", text: "faz um raio x da minha vida financeira" },
  { name: "holistic_assessment", text: "diagnostico da minha situacao financeira" },
  { name: "holistic_assessment", text: "estou indo bem financeiramente" },
  { name: "holistic_assessment", text: "to bem ou to mal nas financas" },

  // Desempenho comparado
  { name: "financial_performance", text: "qual o meu desempenho financeiro" },
  { name: "financial_performance", text: "melhorei em relacao ao mes passado" },
  { name: "financial_performance", text: "minha performance do mes" },

  // Caixa disponível
  { name: "financial_snapshot", text: "quanto eu tenho disponivel" },
  { name: "financial_snapshot", text: "quanto ainda posso gastar" },
  { name: "financial_snapshot", text: "qual o meu saldo" },
  { name: "financial_snapshot", text: "quanto sobra este mes" },
  { name: "financial_snapshot", text: "como estao as minhas contas" },
  { name: "financial_snapshot", text: "quanto de dinheiro eu tenho" },

  // Fechamento projetado
  { name: "forecast_month_close", text: "como vou fechar o mes" },
  { name: "forecast_month_close", text: "quanto vou gastar ate o fim do mes" },
  { name: "forecast_month_close", text: "previsao de fechamento do mes" },

  // Dívidas
  { name: "debt_status", text: "como estao as minhas dividas" },
  { name: "debt_status", text: "quanto eu devo" },
  { name: "debt_status", text: "situacao das dividas" },

  // Metas
  { name: "goals_overview", text: "como estao as minhas metas" },
  { name: "goals_overview", text: "situacao das minhas metas" },

  // Últimos lançamentos
  { name: "recent_transactions", text: "quais foram os meus ultimos gastos" },
  { name: "recent_transactions", text: "meus ultimos lancamentos" },
  { name: "recent_transactions", text: "o que eu gastei nos ultimos dias" },
];

const TOOL_BY_INTENT: Record<ReadIntentName, { required_tool: string; allowed_tools: readonly string[] }> = {
  month_report: {
    required_tool: "get_financial_snapshot",
    allowed_tools: ["get_financial_snapshot", "analyze_spending", "compare_financial_metric"],
  },
  holistic_assessment: {
    required_tool: "assess_financial_health",
    allowed_tools: ["assess_financial_health", "assess_financial_performance", "get_financial_snapshot"],
  },
  financial_performance: {
    required_tool: "assess_financial_performance",
    allowed_tools: ["assess_financial_performance", "compare_financial_metric", "get_financial_snapshot"],
  },
  financial_snapshot: {
    required_tool: "get_financial_snapshot",
    allowed_tools: ["get_financial_snapshot"],
  },
  forecast_month_close: {
    required_tool: "forecast_month_close",
    allowed_tools: ["forecast_month_close", "get_financial_snapshot"],
  },
  debt_status: {
    required_tool: "get_debt_status",
    allowed_tools: ["get_debt_status", "get_financial_snapshot"],
  },
  goals_overview: {
    required_tool: "get_goals_overview",
    allowed_tools: ["get_goals_overview", "get_financial_snapshot"],
  },
  recent_transactions: {
    required_tool: "list_recent_transactions",
    allowed_tools: ["list_recent_transactions"],
  },
};

/** Normalização compartilhada: minúsculas, sem acento, sem pontuação. */
export function normalizeIntentText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Variações coloquiais viram forma canônica antes da comparação. */
function canonicalizeTokens(normalized: string): string[] {
  const raw = normalized.split(" ").filter(Boolean);
  const out: string[] = [];
  for (let token of raw) {
    if (token === "to") token = "estou";
    if (token === "ta") token = "esta";
    if (token === "tao") token = "estao";
    if (token === "andando" || token === "anda" || token === "andam") token = "esta";
    if (token === "indo" || token === "esta" || token === "estao" || token === "estou") token = "estado";
    if (token === "financas" || token === "financeira" || token === "financeiro" || token === "financeiramente") token = "financa";
    if (token === "gastos" || token === "gastei" || token === "gastando" || token === "gastar") token = "gasto";
    if (token === "dividas") token = "divida";
    if (token === "metas") token = "meta";
    if (token === "contas") token = "conta";
    if (token === "lancamentos") token = "lancamento";
    if (token === "meses") token = "mes";
    if (STOPWORDS.has(token)) continue;
    if (token.length <= 1) continue;
    out.push(token);
  }
  return out;
}

function hasObjectAnchor(tokens: string[], normalized: string): boolean {
  if (tokens.some((token) => OBJECT_ANCHORS.includes(token))) return true;
  return OBJECT_ANCHORS.some((anchor) => new RegExp(`\\b${anchor}`).test(normalized));
}

function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const token of new Set(a)) if (setB.has(token)) shared += 1;
  const union = new Set([...a, ...b]).size;
  const jaccard = shared / union;
  const coverage = shared / Math.min(new Set(a).size, setB.size);
  // Cobertura pesa mais que Jaccard: frase longa com pedido claro
  // ("quero saber como o mês está indo, de forma detalhada") não pode ser
  // punida por palavras de cortesia.
  return 0.35 * jaccard + 0.65 * coverage;
}

/**
 * Resolve intenção de leitura por significado. Devolve `null` quando não há
 * âncora financeira ou quando nenhum exemplar chega ao limiar — nesse caso o
 * turno segue para o assistente geral, como antes.
 */
export function resolveReadIntent(text: string): ResolvedReadIntent | null {
  const normalized = normalizeIntentText(text);
  if (!normalized) return null;
  const tokens = canonicalizeTokens(normalized);
  if (tokens.length === 0) return null;
  if (!hasObjectAnchor(tokens, normalized)) return null;

  let best: { name: ReadIntentName; score: number; matched: string } | null = null;
  for (const exemplar of EXEMPLARS) {
    const score = similarity(tokens, canonicalizeTokens(normalizeIntentText(exemplar.text)));
    if (!best || score > best.score) best = { name: exemplar.name, score, matched: exemplar.text };
  }
  if (!best || best.score < 0.5) return null;
  const tools = TOOL_BY_INTENT[best.name];
  return { name: best.name, score: Number(best.score.toFixed(3)), matched: best.matched, ...tools };
}
