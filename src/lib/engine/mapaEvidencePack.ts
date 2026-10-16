// E12 (parte pura) — MapaEvidencePack: o que a camada de linguagem pode dizer sobre o Mapa, e o texto determinístico de reserva.
// A IA NÃO calcula, NÃO classifica e NÃO escolhe a recomendação: ela só reescreve, com os números e afirmações permitidos aqui.
// O pacote leva agregados e rótulos; nunca descrições de transações, nomes de pessoas, respostas do CFPB ou identificadores.
import type { MapaActionType, MapaConfidence, MapaIndicator, MapaReading, MapaStatus } from "./mapaContracts";

export const MAPA_EVIDENCE_VERSION = "mapa_evidence.v1";
export const MAPA_PROMPT_VERSION = "mapa_prompt.v1";
const MAX_FACTS = 5;

export type MapaNarrativeMode = "recomendacao_estrutural" | "recomendacao" | "em_dia" | "pouco_dado";
export type MapaClaim = "fact" | "recommendation" | "trend";

export interface MapaFact {
  key: string;
  label: string;
  /** Valor já formatado em português (é o texto que a IA pode citar). */
  text: string;
  value: number | null;
  status: MapaStatus;
  confidence: MapaConfidence;
  /** "meses fechados", "agora"... */
  window_label: string;
}

export interface MapaEvidencePack {
  version: typeof MAPA_EVIDENCE_VERSION;
  as_of: string;
  reading_level: "simples";
  tone: "calmo";
  mode: MapaNarrativeMode;
  recommendation: { id: string; kind: "estrutural" | "comportamento"; action: MapaActionType; action_label: string; deeplink: string; rationale: string[] } | null;
  facts: MapaFact[];
  allowed_numbers: number[];
  allowed_claims: MapaClaim[];
  prohibited_claims: string[];
  deterministic: { title: string; body: string; question: string | null };
  /** Muda quando muda qualquer fato, a recomendação ou o modo: chave de cache da narrativa. */
  hash: string;
}

export const PROHIBITED_CLAIMS = [
  "causa dos gastos ou do resultado",
  "emoção, estado de espírito ou intenção da pessoa",
  "diagnóstico ou rótulo (vício, compulsão, transtorno)",
  "julgamento moral do gasto ('gastou demais', 'irresponsável')",
  "promessa de resultado ('vai conseguir', 'garanto')",
  "nota, pontuação ou escala de 0 a 10",
  "mandar gastar ou cortar menos quando a dificuldade é estrutural (renda e contas grandes)",
  "qualquer número que não esteja nos fatos",
  "nome de modelo, motor ou código interno",
];

export const ACTION_LABEL: Record<MapaActionType, string> = {
  renegociar_dividas: "Ver minhas dívidas",
  regularizar_atrasos: "Ver minhas dívidas",
  plano_de_pagamento: "Ver minhas dívidas",
  revisar_essenciais: "Rever contas fixas",
  fechar_a_conta: "Ver para onde foi o dinheiro",
  criar_reserva: "Criar uma meta de reserva",
  ajustar_meta: "Ajustar uma meta",
  cadastrar_contas_fixas: "Cadastrar contas fixas",
};

const nf = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `${v < 0 ? "−" : ""}R$ ${nf(Math.abs(v))}`;
const monthsText = (v: number) => `${nf(v, Number.isInteger(v) ? 0 : 1)} ${Math.abs(v) < 2 ? "mês" : "meses"}`;

const LABEL: Record<string, string> = {
  "equilibrio.resultado_3m": "resultado dos últimos 3 meses",
  "equilibrio.taxa_poupanca_3m": "quanto da renda sobrou nos últimos 3 meses",
  "equilibrio.cobertura_mes": "cobertura das contas do mês com dinheiro certo",
  "seguranca.meses_cobertos": "meses de gastos que o dinheiro disponível cobre",
  "seguranca.choque_1_renda": "quanto de uma renda o dinheiro disponível cobre",
  "dividas.comprometimento_renda": "parcelas das dívidas sobre a renda típica",
  "dividas.atrasos": "dívidas em atraso",
  "dividas.custo_medio": "custo médio das dívidas",
  "dividas.perfil_custo_alto": "parte da dívida em modalidades de custo alto",
  "futuro.patrimonio_liquido": "patrimônio líquido",
  "execucao.aderencia": "metas mensais cumpridas",
  "planejamento.viabilidade": "plano comparado com a renda típica",
  "planejamento.recorrentes_registrados": "contas fixas cadastradas",
};

function windowLabel(i: MapaIndicator): string {
  return i.window.kind === "meses_fechados" ? `${i.window.n} meses fechados` : i.window.kind === "movel_dias" ? `últimos ${i.window.n} dias` : "agora";
}

/** Texto do valor de um indicador na unidade natural (o que a IA pode citar). */
export function factText(i: MapaIndicator): string {
  const v = i.value;
  if (v === null) return "sem dados";
  switch (i.unit) {
    case "brl": return brl(v);
    case "pct": case "pct_pontos": return `${nf(v, 1)}%`;
    case "meses": return monthsText(v);
    case "razao": return `${nf(v * 100)}%`;
    case "contagem": return nf(v);
    case "dias": return `${nf(v)} dias`;
    default: return nf(v, 2);
  }
}

/** Números que podem aparecer no texto por causa deste indicador (valor, versões arredondadas, ×100 de razões e insumos). */
function numbersFor(i: MapaIndicator): number[] {
  const out: number[] = [];
  const push = (n: unknown) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return;
    for (const x of [n, Math.abs(n), Math.round(n), Math.round(Math.abs(n)), Math.round(n * 10) / 10, Math.round(n * 100) / 100]) out.push(x);
  };
  push(i.value);
  if (i.value !== null && i.unit === "razao") push(i.value * 100);
  for (const v of Object.values(i.inputs)) push(v);
  return out;
}

function pickIndicators(r: MapaReading): MapaIndicator[] {
  const by = new Map(r.indicators.map((i) => [i.id, i]));
  const chosen: MapaIndicator[] = [];
  const add = (i?: MapaIndicator) => { if (i && i.value !== null && !chosen.includes(i) && LABEL[i.id]) chosen.push(i); };
  for (const id of r.recommendation?.indicator_ids ?? []) add(by.get(id));
  const rank = (s: MapaStatus) => (s === "critico" ? 0 : s === "atencao" ? 1 : 2);
  for (const i of [...r.indicators].sort((a, b) => rank(a.status) - rank(b.status))) {
    if (chosen.length >= MAPA_FACTS_TARGET) break;
    if (r.recommendation && i.status === "ok") continue; // com recomendação, só o que pesa
    add(i);
  }
  return chosen.slice(0, MAX_FACTS);
}
const MAPA_FACTS_TARGET = 3;

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

interface Template { title: string; body: string; question: string | null }

/** Texto de reserva: sempre válido pela guarda, sempre só com números dos fatos. */
export function deterministicTemplate(r: MapaReading, facts: MapaFact[], mode: MapaNarrativeMode): Template {
  const f = (key: string) => facts.find((x) => x.key === key);
  const ind = (id: string) => r.indicators.find((x) => x.id === id);
  const rec = r.recommendation;
  if (mode === "pouco_dado") {
    return { title: "Ainda é cedo para uma leitura firme", body: "Tenho poucos meses completos dos seus lançamentos. Com 3 meses fechados, a leitura fica bem mais firme.", question: null };
  }
  if (mode === "em_dia" || !rec) {
    return { title: "Nada pede ação agora", body: "Olhando os últimos meses, nada pede uma ação agora. Continue registrando para a leitura ficar mais firme.", question: null };
  }
  switch (rec.action.type) {
    case "renegociar_dividas": {
      const v = f("dividas.comprometimento_renda")?.text;
      return { title: "As parcelas pesam na sua renda", body: `${v ? `As parcelas das suas dívidas ocupam ${v} da sua renda típica.` : "As parcelas das suas dívidas ocupam boa parte da sua renda típica."} Antes de olhar gastos pequenos, vale olhar a negociação das dívidas.`, question: "Quer ver suas dívidas agora?" };
    }
    case "revisar_essenciais": {
      const share = r.structural.essential_share_of_income;
      return { title: "Os gastos essenciais pesam na renda", body: `${share !== null ? `Seus gastos essenciais ocupam ${nf(share * 100)}% da sua renda típica.` : "Seus gastos essenciais ocupam boa parte da sua renda típica."} O aperto vem das contas grandes, não de pequenos gastos.`, question: "Quer rever suas contas fixas?" };
    }
    case "fechar_a_conta":
      return { title: "O que sai passou do que entra", body: "Nos últimos três meses, o dinheiro que saiu passou do que entrou. Vale entender onde está o maior peso antes de criar metas.", question: "Quer ver para onde foi o dinheiro?" };
    case "regularizar_atrasos": {
      const n = ind("dividas.atrasos");
      const count = n?.value ?? 0;
      const amount = typeof n?.inputs.valor_em_atraso === "number" ? n.inputs.valor_em_atraso : null;
      return { title: "Tem conta em atraso", body: `Você tem ${nf(count)} ${count === 1 ? "dívida em atraso" : "dívidas em atraso"}${amount ? `, somando ${brl(amount)}` : ""}. Vale começar por elas.`, question: "Quer ver suas dívidas agora?" };
    }
    case "plano_de_pagamento": {
      const v = f("dividas.perfil_custo_alto")?.text;
      return { title: "Dívida cara merece um plano", body: `${v ? `${v} do que você deve está em modalidades de custo alto.` : "Parte do que você deve está em modalidades de custo alto."} Um plano de pagamento ajuda a decidir por qual começar.`, question: "Quer ver suas dívidas agora?" };
    }
    case "criar_reserva": {
      const m = ind("seguranca.meses_cobertos");
      const target = typeof m?.inputs.meta_meses === "number" ? m.inputs.meta_meses : null;
      return { title: "Sua reserva ainda é curta", body: `Seu dinheiro disponível cobre ${m ? factText(m) : "poucos meses"} de gastos.${target ? ` Uma referência prática para a sua renda é ter cerca de ${monthsText(target)}.` : ""}`, question: "Quer criar uma meta de reserva?" };
    }
    case "cadastrar_contas_fixas": {
      const n = ind("planejamento.recorrentes_registrados");
      const d = n?.inputs.detectadas, c = n?.inputs.cadastradas;
      return { title: "Tem conta fixa fora do app", body: typeof d === "number" && typeof c === "number" ? `Encontrei ${nf(d)} contas que se repetem e só ${nf(c)} estão cadastradas. Cadastrar ajuda a avisar antes do vencimento.` : "Encontrei contas que se repetem e ainda não estão cadastradas. Cadastrar ajuda a avisar antes do vencimento.", question: "Quer cadastrar agora?" };
    }
    case "ajustar_meta": {
      if (rec.rationale_keys.includes("plan_does_not_fit")) {
        const v = f("planejamento.viabilidade")?.text;
        return { title: "O plano não cabe na renda", body: `${v ? `Essenciais, metas e contas fixas somam ${v} da sua renda típica.` : "Essenciais, metas e contas fixas passam da sua renda típica."} Vale ajustar uma meta para o plano caber.`, question: "Quer ajustar uma meta?" };
      }
      if (rec.rationale_keys.includes("goal_adherence_low")) {
        const v = f("execucao.aderencia")?.text;
        return { title: "Suas metas estão apertadas?", body: `${v ? `Você cumpriu ${v} das metas mensais fechadas.` : "Você cumpriu poucas metas mensais fechadas."} Às vezes o limite está apertado demais para a sua rotina.`, question: "Quer rever uma meta?" };
      }
      const v = f("equilibrio.taxa_poupanca_3m")?.text;
      return { title: "Sobrou pouco da sua renda", body: `${v ? `Nos últimos 3 meses sobraram ${v} da renda.` : "Nos últimos 3 meses sobrou pouco da renda."} Uma meta de gasto em uma categoria pode ajudar a sobrar mais.`, question: "Quer ajustar uma meta?" };
    }
  }
}

export function buildMapaEvidencePack(r: MapaReading): MapaEvidencePack {
  const rec = r.recommendation;
  const mode: MapaNarrativeMode = rec ? (rec.kind === "estrutural" ? "recomendacao_estrutural" : "recomendacao")
    : r.data_quality.closed_months < 3 ? "pouco_dado" : "em_dia";
  const inds = pickIndicators(r);
  const facts: MapaFact[] = inds.map((i) => ({
    key: i.id, label: LABEL[i.id], text: factText(i), value: i.value, status: i.status, confidence: i.confidence, window_label: windowLabel(i),
  }));
  const numbers = new Set<number>(inds.flatMap(numbersFor));
  // Números extras que os textos de reserva usam fora dos fatos escolhidos.
  const extra = [r.structural.essential_share_of_income !== null ? r.structural.essential_share_of_income * 100 : null,
    r.indicators.find((x) => x.id === "dividas.atrasos")?.inputs.valor_em_atraso, r.indicators.find((x) => x.id === "seguranca.meses_cobertos")?.inputs.meta_meses];
  for (const v of extra) if (typeof v === "number" && Number.isFinite(v)) for (const x of [v, Math.round(v), Math.round(v * 10) / 10]) numbers.add(x);
  const claims: MapaClaim[] = ["fact", ...(rec ? ["recommendation" as const] : []), ...(r.indicators.some((i) => i.change?.comparable) ? ["trend" as const] : [])];

  const pack: Omit<MapaEvidencePack, "hash"> = {
    version: MAPA_EVIDENCE_VERSION, as_of: r.as_of, reading_level: "simples", tone: "calmo", mode,
    recommendation: rec ? { id: rec.id, kind: rec.kind, action: rec.action.type, action_label: ACTION_LABEL[rec.action.type], deeplink: rec.action.deeplink, rationale: rec.rationale_keys } : null,
    facts, allowed_numbers: [...numbers].filter((n) => Number.isFinite(n)), allowed_claims: claims, prohibited_claims: PROHIBITED_CLAIMS,
    deterministic: deterministicTemplate(r, facts, mode),
  };
  const hash = fnv1a(JSON.stringify({ m: pack.mode, r: pack.recommendation?.id, rk: pack.recommendation?.rationale, f: pack.facts.map((x) => [x.key, x.text, x.status]), d: pack.deterministic, p: MAPA_PROMPT_VERSION }));
  return { ...pack, hash };
}
