// Textos do Mapa Financeiro: tudo que a pessoa lê sobre um indicador sai daqui (puro, testável, passa na auditoria de cópia).
// Voz: primeira pessoa, frases curtas, sem jargão. Valor sempre na unidade natural; nada de nota 0–10.
import type { MapaConfidence, MapaIndicator, MapaStatus } from "@/lib/engine/mapaContracts";

const nf = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const brl = (v: number) => `${v < 0 ? "−" : ""}R$ ${nf(Math.abs(v))}`;
const sbrl = (v: number) => `${v < 0 ? "−" : "+"}R$ ${nf(Math.abs(v))}`;
const months = (v: number) => `${nf(v, v < 10 ? 1 : 0)} ${Math.abs(v) < 2 ? "mês" : "meses"}`;
const input = (i: MapaIndicator, k: string) => (typeof i.inputs[k] === "number" ? (i.inputs[k] as number) : null);

export const STATUS_LABEL: Record<MapaStatus, string> = { ok: "Tudo certo", atencao: "Atenção", critico: "Precisa de cuidado", sem_dados: "Sem dados" };
export const CONFIDENCE_LABEL: Record<MapaConfidence, string> = { alta: "Leitura firme", moderada: "Leitura razoável", insuficiente: "Poucos dados" };

export const PILLAR_LABEL = { equilibrio: "Equilíbrio", seguranca: "Segurança", dividas: "Dívidas", futuro: "Construção de futuro" } as const;
export const PILLAR_QUESTION = {
  equilibrio: "O dinheiro que entra sustenta o que sai?",
  seguranca: "Você aguentaria um imprevisto?",
  dividas: "As dívidas cabem na sua vida?",
  futuro: "Suas decisões de hoje constroem o seu futuro?",
} as const;

export interface IndicatorText { title: string; value: string; explain: string }

const REASON_TEXT: Record<string, string> = {
  renda_irregular: "Sua renda varia bastante de mês a mês, então esta leitura oscila mais.",
  mes_parcial: "O mês ainda está em andamento.",
  essential_flag_missing: "Usei seus gastos totais porque você ainda não marcou o que é essencial.",
  liquidez_de_investimentos_desconhecida: "Não contei seus investimentos porque ainda não sei em quanto tempo viram dinheiro.",
  poucos_meses_fechados: "Preciso de pelo menos 3 meses completos de registros.",
  sem_dividas_ativas: "Você não tem dívidas ativas registradas.",
  parcela_ausente: "Alguma dívida está sem o valor da parcela, então o total pode estar menor do que é.",
  taxa_ou_periodo_ausente: "Faltam a taxa e o período (ao mês ou ao ano) das suas dívidas.",
  tipo_de_divida_ausente: "Falta dizer o tipo das suas dívidas (cartão, empréstimo, financiamento…).",
  sem_metas_de_poupanca: "Você ainda não tem meta de poupança.",
  sem_snapshot_financeiro: "Ainda estou montando a sua posição financeira.",
  sem_ponte_patrimonial: "Ainda estou montando a evolução do seu patrimônio.",
  sem_obrigacoes_no_mes: "Você não tem contas previstas até o fim do mês.",
  sem_resgates_no_periodo: "Você não resgatou investimentos nos últimos 90 dias.",
  sem_renda_registrada: "Não encontrei renda registrada nos últimos meses.",
  sem_leitura_de_atraso: "Ainda não consegui verificar atrasos.",
  sem_saldo_inicial: "Não havia saldo devedor no início do mês.",
  sem_gasto_tipico: "Ainda não tenho um gasto mensal típico para comparar.",
};

/** Para teste: todo código de motivo que a tela sabe traduzir. */
export const REASON_CODES_FOR_TEST = Object.keys(REASON_TEXT);

export const NEEDS_ACTION: Record<string, string> = {
  essencial_categoria: "Marcar o que é essencial",
  debt_rate: "Informar a taxa das dívidas",
  debt_kind: "Informar o tipo das dívidas",
  liquidez_investimento: "Informar a liquidez dos investimentos",
  meta_de_poupanca: "Criar uma meta de poupança",
};

export function reasonText(code: string): string | null {
  return REASON_TEXT[code] ?? null;
}

/** Frases de motivo legíveis (só as conhecidas; código técnico nunca aparece na tela). */
export function reasonsText(i: MapaIndicator): string[] {
  return i.reasons.map(reasonText).filter((t): t is string => t !== null);
}

export function indicatorText(i: MapaIndicator): IndicatorText {
  const v = i.value;
  switch (i.id) {
    case "equilibrio.resultado_3m":
      return { title: "Resultado dos últimos 3 meses", value: v === null ? "—" : sbrl(v), explain: v === null ? "" : v >= 0 ? `Sobrou ${brl(v)} depois de pagar os gastos.` : `Faltou ${brl(-v)}: o gasto passou da renda.` };
    case "equilibrio.taxa_poupanca_3m":
      return { title: "Quanto da renda sobrou", value: v === null ? "—" : `${nf(v, 1)}%`, explain: v === null ? "" : v >= 0 ? `De cada R$ 100 que entraram, sobraram R$ ${nf(v, 0)}.` : `De cada R$ 100 que entraram, faltaram R$ ${nf(-v, 0)}.` };
    case "equilibrio.cobertura_mes":
      return { title: "Dinheiro certo para as contas do mês", value: v === null ? "—" : v >= 10 ? "Sobra bastante" : `${nf(v * 100)}% cobertas`, explain: "Compara o que você tem na conta, mais as entradas já confirmadas, com as contas e a fatura que vencem até o fim do mês." };
    case "equilibrio.cobertura_mes_com_estimativa":
      return { title: "Se a renda esperada chegar", value: v === null ? "—" : v >= 10 ? "Sobra bastante" : `${nf(v * 100)}% cobertas`, explain: "Mesma conta, contando também a renda que eu estimo que vai entrar. É uma estimativa, não dinheiro garantido." };
    case "equilibrio.tendencia":
      return { title: "Para onde vai o resultado mensal", value: v === null ? "—" : `${sbrl(v)} por mês`, explain: v === null ? "" : v >= 0 ? "O resultado dos meses está melhorando." : "O resultado dos meses está piorando." };
    case "seguranca.meses_cobertos": {
      const base = i.inputs.base === "essenciais" ? "seus gastos essenciais" : "seus gastos totais";
      const target = input(i, "meta_meses");
      return { title: "Quantos meses seu dinheiro cobre", value: v === null ? "—" : months(v), explain: v === null ? "" : `Seu dinheiro disponível cobre ${months(v)} de ${base}.${target ? ` Como referência prática, para a sua renda vale ter cerca de ${months(target)}.` : ""}` };
    }
    case "seguranca.choque_1_renda":
      return { title: "Dá para pagar um mês de renda sem dívida?", value: v === null ? "—" : `${nf(v * 100)}% de uma renda`, explain: v === null ? "" : v >= 1 ? "Você conseguiria pagar uma despesa do tamanho de uma renda mensal sem pedir emprestado." : "Seu dinheiro disponível ainda não cobre uma despesa do tamanho de uma renda mensal." };
    case "dividas.comprometimento_renda":
      return { title: "Parcelas sobre a renda", value: v === null ? "—" : `${nf(v, 1)}%`, explain: v === null ? "" : `As parcelas das suas dívidas pesam ${nf(v, 1)}% da sua renda típica.` };
    case "dividas.atrasos":
      return { title: "Dívidas em atraso", value: v === null ? "—" : nf(v), explain: v === null ? "" : v === 0 ? "Nenhuma parcela em atraso." : `${nf(v)} ${v === 1 ? "dívida em atraso" : "dívidas em atraso"}${input(i, "valor_em_atraso") ? `, somando ${brl(input(i, "valor_em_atraso") as number)}` : ""}.` };
    case "dividas.custo_medio":
      return { title: "Custo médio das dívidas", value: v === null ? "—" : `${nf(v, 1)}% ao mês`, explain: "Média da taxa das suas dívidas, ponderada pelo quanto você deve em cada uma." };
    case "dividas.trajetoria":
      return { title: "Saldo devedor no mês", value: v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(Math.abs(v), 1)}%`, explain: v === null ? "" : v < 0 ? "O que você deve diminuiu neste mês." : v > 0 ? "O que você deve aumentou neste mês." : "O que você deve ficou igual neste mês." };
    case "dividas.perfil_custo_alto":
      return { title: "Dívida de custo alto", value: v === null ? "—" : `${nf(v)}% do que você deve`, explain: "Parte do saldo em cartão rotativo, cheque especial ou dívida informal, que costumam ter juros mais altos." };
    case "futuro.patrimonio_liquido":
      return { title: "Patrimônio líquido", value: v === null ? "—" : brl(v), explain: "O que você tem (conta e investimentos) menos o que você deve." };
    case "futuro.variacao_mes": {
      const parts: string[] = [];
      const op = input(i, "resultado_operacional"), am = input(i, "amortizacao_de_divida");
      if (op !== null) parts.push(`resultado do mês ${sbrl(op)}`);
      if (am !== null && am !== 0) parts.push(`${am < 0 ? "dívida paga" : "dívida nova"} ${brl(Math.abs(am))}`);
      return { title: "Variação do patrimônio no mês", value: v === null ? "—" : sbrl(v), explain: parts.length ? `Neste mês até agora: ${parts.join("; ")}. Resgate de investimento só muda o dinheiro de lugar.` : "" };
    }
    case "futuro.progresso_metas":
      return { title: "Metas de poupança", value: v === null ? "—" : `${nf(v)}% guardado`, explain: v === null ? "" : `Você guardou ${brl(input(i, "guardado") ?? 0)} de ${brl(input(i, "alvo") ?? 0)}.` };
    case "futuro.resgates_sem_destino": {
      const total = input(i, "resgates_90d") ?? 0, used = input(i, "usados_em_divida") ?? 0;
      return { title: "Resgates sem destino identificado", value: v === null ? "—" : brl(v), explain: total === 0 ? "" : `Em 90 dias você resgatou ${brl(total)}${used > 0 ? `, e ${brl(used)} parece ter ido para dívidas` : ""}. O restante não consegui ligar a um destino; isso não é perda, só falta contexto.` };
    }
    default:
      return { title: i.id, value: v === null ? "—" : nf(v, 2), explain: "" };
  }
}
