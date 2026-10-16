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

export const PILLAR_LABEL = {
  equilibrio: "Equilíbrio", seguranca: "Segurança", dividas: "Dívidas", futuro: "Construção de futuro",
  execucao: "Execução", planejamento: "Planejamento", acompanhamento: "Acompanhamento",
} as const;
export const PILLAR_QUESTION = {
  equilibrio: "O dinheiro que entra sustenta o que sai?",
  seguranca: "Você aguentaria um imprevisto?",
  dividas: "As dívidas cabem na sua vida?",
  futuro: "Suas decisões de hoje constroem o seu futuro?",
  execucao: "Você cumpre o que combina com você mesmo?",
  planejamento: "O seu plano cabe na sua renda?",
  acompanhamento: "Você tem noção de para onde o dinheiro vai?",
} as const;

export interface IndicatorText { title: string; value: string; explain: string }

const REASON_TEXT: Record<string, string> = {
  renda_irregular: "Sua renda varia bastante de mês a mês, então esta leitura oscila mais.",
  mes_parcial: "O mês ainda está em andamento.",
  essential_flag_missing: "Usei seus gastos totais porque você ainda não marcou o que é essencial.",
  liquidez_de_investimentos_desconhecida: "Não contei seus investimentos porque ainda não sei em quanto tempo viram dinheiro.",
  poucos_meses_fechados: "Preciso de pelo menos 3 meses completos de registros.",
  sem_dividas_ativas: "Você não tem dívidas ativas registradas.",
  so_pagamentos_registrados: "Só conto o que foi registrado como pagamento de dívida; parcelas debitadas direto e não registradas ficam de fora.",
  sem_pagamentos_de_divida_registrados: "Ainda não há pagamentos de dívida registrados.",
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
  poucos_periodos_comparaveis: "Preciso de pelo menos 3 períodos fechados com meta para comparar.",
  aderencia_muito_baixa_revisar_meta: "Quando quase nenhuma meta é cumprida, muitas vezes o limite está apertado demais. Vale revisar o valor.",
  metas_sem_prazo: "Metas sem prazo não entram no cálculo do aporte mensal.",
  poucas_recorrencias_detectadas: "Encontrei poucas contas fixas nos seus lançamentos para comparar.",
  poucas_respostas: "Ainda não tenho respostas suficientes.",
  exploratorio: "Esta medida é nova e ainda está em teste: use como curiosidade, não como nota.",
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
  metas_fechadas: "Criar uma meta de gastos",
  estimativa_mensal: "Responder a pergunta do mês",
  planejado_vs_hora: "Responder sobre seus gastos",
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
    case "equilibrio.resultado_3m": {
      const inc = input(i, "renda_3m"), out = input(i, "consumo_3m");
      const facts = inc !== null && out !== null ? ` Entraram ${brl(inc)} de renda e saíram ${brl(out)}.` : "";
      const loan = input(i, "entrada_emprestimo_3m"), redeem = input(i, "entrada_resgate_3m"), other = input(i, "entrada_outras_3m");
      const extra = (loan ?? 0) + (redeem ?? 0) + (other ?? 0);
      let excluded = " Empréstimos, resgates e transferências não contam como renda.";
      if (loan !== null && redeem !== null && other !== null) {
        if (extra < 1) excluded = " Não entrou empréstimo nem resgate nesse período.";
        else {
          const all = (inc ?? 0) + extra;
          const share = (x: number) => `${nf((x / all) * 100)}%`;
          const parts = [loan >= 1 ? `${brl(loan)} de empréstimo (${share(loan)})` : "", redeem >= 1 ? `${brl(redeem)} de resgate de investimento (${share(redeem)})` : "", other >= 1 ? `${brl(other)} de outras entradas, como Pix recebido e depósito (${share(other)})` : ""].filter(Boolean);
          excluded = ` Além da renda, entraram ${brl(extra)} que não contei como renda: ${parts.join("; ")}. As porcentagens são sobre tudo que entrou (${brl(all)}). Esse dinheiro não é ganho do período: empréstimo vira dívida e resgate vem de um dinheiro que você já tinha.`;
        }
      }
      return { title: "Resultado dos últimos 3 meses", value: v === null ? "—" : sbrl(v), explain: v === null ? "" : `${v >= 0 ? `Sobrou ${brl(v)}` : `Saiu ${brl(-v)} a mais do que entrou`} nos 3 últimos meses fechados.${facts}${excluded}` };
    }
    case "equilibrio.taxa_poupanca_3m":
      return { title: "Quanto da renda sobrou", value: v === null ? "—" : `${nf(v, 1)}%`, explain: v === null ? "" : v >= 0 ? `De cada R$ 100 que entraram, sobraram R$ ${nf(v, 0)}.` : `De cada R$ 100 que entraram, faltaram R$ ${nf(-v, 0)}.` };
    case "equilibrio.cobertura_mes":
    case "equilibrio.cobertura_mes_com_estimativa": {
      const withEst = i.id.endsWith("estimativa");
      const cash = input(i, "dinheiro_hoje"), obl = input(i, "obrigacoes"), inflow = input(i, "entradas") ?? 0, card = input(i, "fatura");
      const missing = cash !== null && obl !== null ? Math.max(0, obl - cash - inflow) : null;
      const detail = cash !== null && obl !== null
        ? `Hoje você tem ${brl(cash)}${inflow > 0 ? ` e conto com mais ${brl(inflow)}${withEst ? " de renda esperada (é estimativa, não dinheiro garantido)" : " de entradas já confirmadas"}` : ""}. Até o fim do mês vencem ${brl(obl)}${card ? `, sendo ${brl(card)} de fatura de cartão` : ""}.${missing ? ` Faltam ${brl(missing)}.` : ` Dá para cobrir${(input(i, "folga") ?? 0) >= 1 ? ` e ainda sobram ${brl(input(i, "folga") as number)}` : ""}.`}`
        : "";
      return { title: withEst ? "Contas do mês, contando a renda esperada" : "Contas do mês que o dinheiro de hoje cobre", value: v === null ? "—" : `${nf(Math.min(1, v) * 100)}% cobertas`, explain: detail };
    }
    case "equilibrio.tendencia": {
      // Só mostro número quando a variação é maior que o "ruído" normal dos seus meses; senão, o número enganaria.
      const clear = input(i, "significativa") === 1;
      return {
        title: "Para onde vai o resultado mensal",
        value: v === null ? "—" : clear ? `${sbrl(v)} por mês` : "Sem tendência clara",
        explain: v === null ? "" : !clear ? "O seu resultado varia bastante de um mês para o outro, e essa variação é maior do que qualquer tendência. Por isso não dá para dizer que está melhorando ou piorando." : v < 0 ? "O resultado dos meses está piorando de forma consistente." : "O resultado dos meses está melhorando de forma consistente.",
      };
    }
    case "seguranca.meses_cobertos": {
      const base = i.inputs.base === "essenciais" ? "gastos essenciais" : "gastos totais";
      const target = input(i, "meta_meses"), spend = input(i, "gasto_mensal_tipico"), cash = input(i, "dinheiro_em_conta");
      return { title: "Quantos meses seu dinheiro cobre", value: v === null ? "—" : months(v), explain: v === null ? "" : `${spend !== null && cash !== null ? `Seus ${base} somam cerca de ${brl(spend)} por mês (parcelas de dívida incluídas) e você tem ${brl(cash)} disponíveis, o que cobre ${months(v)}.` : `Seu dinheiro disponível cobre ${months(v)} de ${base}.`}${target ? ` Como referência prática, para a sua renda vale ter cerca de ${months(target)}.` : ""}` };
    }
    case "seguranca.choque_1_renda": {
      const cash = input(i, "liquidez"), inc = input(i, "renda_tipica");
      return { title: "Dinheiro disponível frente a uma renda mensal", value: v === null ? "—" : `${nf(v * 100)}% de uma renda`, explain: v === null ? "" : `${cash !== null && inc !== null ? `Seu dinheiro disponível (${brl(cash)}) equivale a ${nf(v * 100)}% de uma renda mensal típica (${brl(inc)}). ` : ""}${v >= 1 ? "Uma despesa do tamanho de uma renda mensal não te obrigaria a pedir emprestado." : "Uma despesa do tamanho de uma renda mensal te obrigaria a recorrer a empréstimo ou investimento."}` };
    }
    case "dividas.comprometimento_renda": {
      const inst = input(i, "parcelas_mensais"), inc = input(i, "renda_tipica");
      return { title: "Parcelas sobre a renda", value: v === null ? "—" : `${nf(v, 1)}%`, explain: v === null ? "" : `${inst !== null && inc !== null ? `As parcelas das suas dívidas somam ${brl(inst)} por mês, ${nf(v, 1)}% da sua renda típica de ${brl(inc)}.` : `As parcelas das suas dívidas pesam ${nf(v, 1)}% da sua renda típica.`} Não inclui a fatura do cartão.` };
    }
    case "dividas.atrasos":
      return { title: "Dívidas em atraso", value: v === null ? "—" : nf(v), explain: v === null ? "" : v === 0 ? "Nenhuma parcela em atraso." : `${nf(v)} ${v === 1 ? "dívida em atraso" : "dívidas em atraso"}${input(i, "valor_em_atraso") ? `, somando ${brl(input(i, "valor_em_atraso") as number)}` : ""}.` };
    case "dividas.custo_medio":
      return { title: "Custo médio das dívidas", value: v === null ? "—" : `${nf(v, 1)}% ao mês`, explain: "Média da taxa das suas dívidas, ponderada pelo quanto você deve em cada uma." };
    case "dividas.amortizacao_90d":
      return { title: "Principal de dívida pago (90 dias)", value: v === null ? "—" : brl(v), explain: v === null ? "" : `Nos últimos 90 dias foram registrados ${brl(v)} pagos do principal das suas dívidas (hoje você deve ${brl(input(i, "saldo_devedor_hoje") ?? 0)}). Pagar a fatura do cartão não conta aqui, porque só quita o que já foi gasto.` };
    case "dividas.perfil_custo_alto":
      return { title: "Dívida de custo alto", value: v === null ? "—" : `${nf(v)}% do que você deve`, explain: "Parte do saldo em cartão rotativo, cheque especial ou dívida informal, que costumam ter juros mais altos." };
    case "futuro.patrimonio_liquido":
      const cashA = input(i, "conta"), inv = input(i, "investimentos"), owed = input(i, "dividas_total"), card = input(i, "fatura_cartao"), oth = input(i, "outras_dividas");
      const comp = cashA !== null && inv !== null && owed !== null
        ? ` Você tem ${brl(cashA + inv)} (${brl(cashA)} em conta e ${brl(inv)} em investimentos) e deve ${brl(owed)}${card !== null && oth !== null ? `, sendo ${brl(oth)} em dívidas e empréstimos e ${brl(card)} em fatura de cartão` : ""}.`
        : "";
      return { title: "Patrimônio líquido", value: v === null ? "—" : brl(v), explain: `O que você tem (conta e investimentos) menos o que você deve.${comp}` };
    case "futuro.variacao_mes": {
      const op = input(i, "resultado_operacional"), unexplained = input(i, "sem_explicacao"), yieldV = input(i, "rendimento");
      const parts: string[] = [];
      if (op !== null && op !== 0) parts.push(`${brl(op)} pelo resultado do mês (${op < 0 ? "saiu mais do que entrou" : "entrou mais do que saiu"})`);
      if (yieldV !== null && yieldV !== 0) parts.push(`${sbrl(yieldV)} de rendimento`);
      if (unexplained !== null && Math.abs(unexplained) >= 1) parts.push(`${brl(unexplained)} que ainda não consegui explicar`);
      return { title: "Variação do patrimônio no mês", value: v === null ? "—" : sbrl(v), explain: v === null ? "" : `O mês ainda não acabou. ${parts.length ? `Até agora: ${parts.join("; ")}. ` : ""}Pagar fatura ou dívida e resgatar investimento só trocam dinheiro de lugar, sem mudar o patrimônio.` };
    }
    case "futuro.progresso_metas":
      return { title: "Metas de poupança", value: v === null ? "—" : `${nf(v)}% guardado`, explain: v === null ? "" : `Você guardou ${brl(input(i, "guardado") ?? 0)} de ${brl(input(i, "alvo") ?? 0)}.` };
    case "futuro.resgates_90d": {
      const used = input(i, "coincidem_com_divida") ?? 0, now = input(i, "investido_hoje");
      return { title: "Resgates de investimentos (90 dias)", value: v === null ? "—" : brl(v), explain: v === null ? "" : v === 0 ? "Você não resgatou investimentos nos últimos 90 dias." : `Em 90 dias você resgatou ${brl(v)} de investimentos${now !== null ? ` e hoje tem ${brl(now)} investidos` : ""}.${used > 0 ? ` ${brl(used)} coincidiram com pagamento de dívida.` : ""} Resgatar para pagar contas é uso normal da reserva; o que importa é quanto sobra.` };
    }
    case "execucao.aderencia":
      return { title: "Metas cumpridas", value: v === null ? "—" : `${nf(v)}%`, explain: v === null ? "" : `Você cumpriu ${nf(input(i, "cumpridos") ?? 0)} de ${nf(input(i, "periodos") ?? 0)} metas mensais fechadas. Não precisa ser 100%: serve para ver se o limite combina com a sua vida.` };
    case "execucao.sequencia":
      return { title: "Meses seguidos no combinado", value: v === null ? "—" : `${nf(v)} ${v === 1 ? "mês" : "meses"}`, explain: v === null ? "" : v === 0 ? "No último mês fechado alguma meta não foi cumprida." : `Nos últimos ${nf(v)} ${v === 1 ? "mês" : "meses"} fechados você cumpriu todas as suas metas.` };
    case "execucao.aderencia_fim_de_semana":
      return { title: "Combinados de fim de semana", value: v === null ? "—" : `${nf(v)}%`, explain: v === null ? "" : `Você cumpriu ${nf(input(i, "cumpridos") ?? 0)} de ${nf(input(i, "periodos") ?? 0)} combinados de fim de semana.` };
    case "planejamento.viabilidade":
      return { title: "Quanto do plano cabe na renda", value: v === null ? "—" : `${nf(v * 100)}% da renda`, explain: v === null ? "" : `Gastos essenciais, aportes das metas e contas fixas somam ${brl((input(i, "essenciais_mensal") ?? 0) + (input(i, "aportes_metas_mensal") ?? 0) + (input(i, "recorrentes_nao_essenciais_mensal") ?? 0))} por mês, para uma renda típica de ${brl(input(i, "renda_tipica") ?? 0)}.${v > 1 ? " O plano não cabe: ou a renda sobe, ou algum item precisa ceder." : ""}` };
    case "planejamento.recorrentes_registrados":
      return { title: "Contas fixas cadastradas", value: v === null ? "—" : `${nf(v)}%`, explain: v === null ? "" : `Das ${nf(input(i, "detectadas") ?? 0)} contas que se repetem nos seus lançamentos, ${nf(input(i, "cadastradas") ?? 0)} já estão cadastradas. Cadastrar ajuda o Nino a avisar antes do vencimento.` };
    case "planejamento.intencionalidade":
      return { title: "Gastos que você já planeja", value: v === null ? "—" : `${nf(v)}%`, explain: v === null ? "" : `Em ${nf(input(i, "respondidas") ?? 0)} respostas, ${nf(input(i, "planejados") ?? 0)} foram "já planejo". Decidir na hora não é errado: isso só mostra como você costuma agir.` };
    case "acompanhamento.calibragem_total":
      return { title: "Noção do gasto do mês", value: v === null ? "—" : `${nf(v, 0)}% de diferença`, explain: v === null ? "" : `Em média, o seu palpite sobre o gasto do mês ficou ${nf(v, 0)}% longe do que aconteceu${typeof i.inputs.vies_medio_pct === "number" ? (i.inputs.vies_medio_pct < -3 ? ", em geral para menos" : i.inputs.vies_medio_pct > 3 ? ", em geral para mais" : "") : ""}.` };
    case "acompanhamento.categoria_que_mais_pesou":
      return { title: "Acerto da categoria que mais pesou", value: v === null ? "—" : `${nf(v)}%`, explain: v === null ? "" : `Você acertou ${nf(input(i, "acertos") ?? 0)} de ${nf(input(i, "respostas") ?? 0)} vezes qual categoria mais pesou no mês.` };
    case "acompanhamento.reconhecimento_padroes":
      return { title: "Dicas que você achou úteis", value: v === null ? "—" : `${nf(v)}%`, explain: v === null ? "" : `Você marcou ${nf(input(i, "uteis") ?? 0)} de ${nf(input(i, "respondidas") ?? 0)} dicas como úteis.` };
    default:
      return { title: i.id, value: v === null ? "—" : nf(v, 2), explain: "" };
  }
}

export interface ChangeText { label: string; tone: "up" | "down" | "same" | "none"; detail: string }

const NOT_COMPARABLE: Record<string, string> = {
  formula_changed: "A forma de calcular mudou desde a leitura anterior, então não comparo.",
  data_completeness_changed: "Os dados mudaram (mais meses ou outra base) desde a leitura anterior, então não comparo.",
  window_mismatch: "O período medido é diferente do da leitura anterior, então não comparo.",
  within_measurement_error: "A diferença está dentro do que a própria medida costuma oscilar.",
};

/** Frase de evolução de um indicador (E10). null = não há leitura anterior. */
export function changeText(i: MapaIndicator): ChangeText | null {
  const c = i.change;
  if (!c) return null;
  if (!c.comparable) return { label: "Sem comparação", tone: "none", detail: (c.not_comparable_reason && NOT_COMPARABLE[c.not_comparable_reason]) || "Não há uma leitura anterior comparável." };
  const before = c.previous === null ? "" : ` (antes: ${indicatorText({ ...i, value: c.previous }).value})`;
  if (c.direction === "melhorou") return { label: "Melhorou", tone: "up", detail: `Melhorou desde a leitura anterior${before}.` };
  if (c.direction === "piorou") return { label: "Piorou", tone: "down", detail: `Piorou desde a leitura anterior${before}.` };
  return { label: "Parecido", tone: "same", detail: `Parecido com a leitura anterior${before}.` };
}
