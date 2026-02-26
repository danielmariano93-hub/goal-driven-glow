import type { Lancamento, Meta, Divida, ContaFixa, Investimento, EmocaoDiaria, ConfiguracaoPerfil, Alerta, Aporte } from '@/types/financial';

export interface FinancialState {
  lancamentos: Lancamento[];
  metas: Meta[];
  aportes: Aporte[];
  dividas: Divida[];
  contasFixas: ContaFixa[];
  investimentos: Investimento[];
  emocoes: EmocaoDiaria[];
  config: ConfiguracaoPerfil;
}

// --- Cálculos Base ---

export function calcularRendaTotal(state: FinancialState, mes?: string): number {
  const lancamentos = mes
    ? state.lancamentos.filter(l => l.tipo === 'receita' && l.data.startsWith(mes))
    : state.lancamentos.filter(l => l.tipo === 'receita');
  return lancamentos.reduce((s, l) => s + l.valor, 0);
}

export function calcularGastoTotal(state: FinancialState, mes?: string): number {
  const lancamentos = mes
    ? state.lancamentos.filter(l => l.tipo === 'despesa' && l.data.startsWith(mes))
    : state.lancamentos.filter(l => l.tipo === 'despesa');
  return lancamentos.reduce((s, l) => s + l.valor, 0);
}

export function calcularGastosFixos(state: FinancialState): number {
  return state.contasFixas.reduce((s, c) => s + c.valor, 0);
}

export function calcularGastosVariaveis(state: FinancialState, mes?: string): number {
  const lancamentos = mes
    ? state.lancamentos.filter(l => l.tipo === 'despesa' && !l.fixo && l.data.startsWith(mes))
    : state.lancamentos.filter(l => l.tipo === 'despesa' && !l.fixo);
  return lancamentos.reduce((s, l) => s + l.valor, 0);
}

export function calcularTotalInvestido(state: FinancialState): number {
  return state.investimentos.reduce((s, i) => s + i.valor_atual, 0);
}

export function calcularTotalDividas(state: FinancialState): number {
  return state.dividas.reduce((s, d) => s + d.valor_atual, 0);
}

export function calcularPatrimonioLiquido(state: FinancialState): number {
  return calcularTotalInvestido(state) - calcularTotalDividas(state);
}

export function calcularSaldoMes(state: FinancialState, mes?: string): number {
  return calcularRendaTotal(state, mes) - calcularGastoTotal(state, mes) - calcularGastosFixos(state);
}

export function calcularRendaComprometida(state: FinancialState, mes?: string): number {
  const renda = calcularRendaTotal(state, mes) || state.config.renda_mensal;
  if (renda === 0) return 0;
  const gastos = calcularGastoTotal(state, mes) + calcularGastosFixos(state);
  return Math.round((gastos / renda) * 100);
}

// --- Dívidas ---

export function calcularCustoDivida(divida: Divida): number {
  return divida.valor_parcela * divida.parcelas_restantes;
}

export function calcularJurosProjetado(divida: Divida): number {
  return calcularCustoDivida(divida) - divida.valor_atual;
}

export function calcularTempoQuitacao(divida: Divida): number {
  return divida.parcelas_restantes;
}

export function compararAvalancheVsBolaNeve(dividas: Divida[]): { avalanche: Divida[]; bolaNeve: Divida[] } {
  const avalanche = [...dividas].sort((a, b) => b.taxa_juros - a.taxa_juros);
  const bolaNeve = [...dividas].sort((a, b) => a.valor_atual - b.valor_atual);
  return { avalanche, bolaNeve };
}

// --- Scores ---

export function calcularScoreFinanceiro(state: FinancialState): number {
  const renda = calcularRendaTotal(state) || state.config.renda_mensal;
  if (renda === 0) return 50;

  const saldo = calcularSaldoMes(state);
  const taxaPoupanca = Math.max(0, Math.min(100, (saldo / renda) * 100));
  const scorePoupanca = (taxaPoupanca / 100) * 25;

  const patrimonio = calcularPatrimonioLiquido(state);
  const scoreCrescimento = patrimonio > 0 ? 20 : patrimonio > -10000 ? 10 : 0;

  const totalDividas = calcularTotalDividas(state);
  const ratioDivida = totalDividas / (renda * 12);
  const scoreControleDivida = Math.max(0, (1 - ratioDivida) * 20);

  const comprometida = calcularRendaComprometida(state);
  const scoreRenda = Math.max(0, ((100 - comprometida) / 100) * 20);

  const metasAtivas = state.metas.filter(m => m.status === 'ativa');
  const metasComAporte = metasAtivas.filter(m => {
    const aportesMeta = state.aportes.filter(a => a.meta_id === m.id);
    return aportesMeta.length > 0;
  });
  const scoreConsistencia = metasAtivas.length > 0
    ? (metasComAporte.length / metasAtivas.length) * 15
    : 7.5;

  return Math.round(Math.min(100, scorePoupanca + scoreCrescimento + scoreControleDivida + scoreRenda + scoreConsistencia));
}

export function calcularScoreEmocional(state: FinancialState): number {
  const despesas = state.lancamentos.filter(l => l.tipo === 'despesa');
  if (despesas.length === 0) return 75;

  const totalDespesas = despesas.reduce((s, l) => s + l.valor, 0);
  const impulsivos = despesas.filter(l => l.impulsivo).reduce((s, l) => s + l.valor, 0);
  const pctImpulsivo = totalDespesas > 0 ? (impulsivos / totalDespesas) * 100 : 0;

  const emocoesNegativas = ['ansioso', 'triste', 'frustrado', 'estressado', 'entediado'];
  const gastosComEmocaoNeg = despesas.filter(l => l.emocao && emocoesNegativas.includes(l.emocao));
  const pctEmocaoNeg = despesas.length > 0 ? (gastosComEmocaoNeg.length / despesas.length) * 100 : 0;

  const score = 100 - pctImpulsivo * 0.6 - pctEmocaoNeg * 0.4;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// --- Projeção ---

export function calcularProjecao(state: FinancialState, meses: number): number[] {
  const saldoMensal = calcularSaldoMes(state);
  const patrimonioAtual = calcularPatrimonioLiquido(state);
  return Array.from({ length: meses }, (_, i) => Math.round(patrimonioAtual + saldoMensal * (i + 1)));
}

// --- Simulador ---

export interface CenarioSimulacao {
  reducaoFixo: number;
  reducaoVariavel: number;
  aumentoRenda: number;
  aumentoAporte: number;
}

export function simular(state: FinancialState, cenario: CenarioSimulacao) {
  const renda = (calcularRendaTotal(state) || state.config.renda_mensal) + cenario.aumentoRenda;
  const gastosFixos = calcularGastosFixos(state) * (1 - cenario.reducaoFixo / 100);
  const gastosVariaveis = calcularGastosVariaveis(state) * (1 - cenario.reducaoVariavel / 100);
  const novoSaldo = renda - gastosFixos - gastosVariaveis;
  const patrimonioAtual = calcularPatrimonioLiquido(state);

  const projecao12 = Array.from({ length: 12 }, (_, i) => Math.round(patrimonioAtual + novoSaldo * (i + 1)));
  const projecao24 = Array.from({ length: 24 }, (_, i) => Math.round(patrimonioAtual + novoSaldo * (i + 1)));
  const projecao60 = Array.from({ length: 60 }, (_, i) => Math.round(patrimonioAtual + novoSaldo * (i + 1)));

  const metaPrincipal = state.metas.find(m => m.prioridade === 'alta' && m.status === 'ativa');
  let tempoMeta: number | null = null;
  if (metaPrincipal && novoSaldo > 0) {
    const restante = metaPrincipal.valor_objetivo - metaPrincipal.valor_atual;
    tempoMeta = Math.ceil(restante / (novoSaldo > 0 ? novoSaldo : 1));
  }

  return {
    saldoSimulado: Math.round(novoSaldo),
    rendaComprometida: renda > 0 ? Math.round(((gastosFixos + gastosVariaveis) / renda) * 100) : 0,
    projecao12,
    projecao24,
    projecao60,
    tempoMeta,
  };
}

// --- Simulador de Decisão de Gasto ---

export interface GastoSimulado {
  valor: number;
  categoria: string;
  parcelado: boolean;
  parcelas: number;
  emocao?: string;
}

export interface ResultadoSimulacao {
  saldoAtual: number;
  saldoComGasto: number;
  diferencaSaldo: number;
  taxaPoupancaAtual: number;
  taxaPoupancaComGasto: number;
  patrimonioAtual12m: number;
  patrimonioComGasto12m: number;
  projecaoSem: number[];
  projecaoCom: number[];
  scoreAtual: number;
  scoreComGasto: number;
  metas: { nome: string; tempoAtual: number | null; tempoComGasto: number | null; atraso: number }[];
  feedback: string;
}

export function simularGasto(state: FinancialState, gasto: GastoSimulado): ResultadoSimulacao {
  const renda = calcularRendaTotal(state) || state.config.renda_mensal;
  const saldoAtual = calcularSaldoMes(state);
  const impactoMensal = gasto.parcelado && gasto.parcelas > 1 ? gasto.valor / gasto.parcelas : gasto.valor;
  const saldoComGasto = saldoAtual - impactoMensal;
  const diferencaSaldo = -impactoMensal;

  const taxaPoupancaAtual = renda > 0 ? Math.round(Math.max(0, (saldoAtual / renda) * 100)) : 0;
  const taxaPoupancaComGasto = renda > 0 ? Math.round(Math.max(0, (saldoComGasto / renda) * 100)) : 0;

  const patrimonioAtual = calcularPatrimonioLiquido(state);
  const mesesParcelado = gasto.parcelado && gasto.parcelas > 1 ? gasto.parcelas : 1;

  const projecaoSem: number[] = [];
  const projecaoCom: number[] = [];
  for (let i = 1; i <= 12; i++) {
    projecaoSem.push(Math.round(patrimonioAtual + saldoAtual * i));
    const deducao = i <= mesesParcelado ? impactoMensal * i : impactoMensal * mesesParcelado;
    projecaoCom.push(Math.round(patrimonioAtual + saldoAtual * i - deducao));
  }

  const patrimonioAtual12m = projecaoSem[11];
  const patrimonioComGasto12m = projecaoCom[11];

  const scoreAtual = calcularScoreFinanceiro(state);
  // Estimate score with reduced savings
  const pctGasto = renda > 0 ? (impactoMensal / renda) : 0;
  const scoreComGasto = Math.max(0, Math.round(scoreAtual - pctGasto * 30));

  // Impacto nas metas
  const metasAtivas = state.metas.filter(m => m.status === 'ativa');
  const metas = metasAtivas.map(m => {
    const restante = m.valor_objetivo - m.valor_atual;
    const tempoAtual = saldoAtual > 0 && restante > 0 ? Math.ceil(restante / saldoAtual) : null;
    const tempoComGasto = saldoComGasto > 0 && restante > 0 ? Math.ceil(restante / saldoComGasto) : null;
    const atraso = tempoAtual !== null && tempoComGasto !== null ? tempoComGasto - tempoAtual : 0;
    return { nome: m.nome, tempoAtual, tempoComGasto, atraso };
  });

  // Feedback comportamental
  const feedback = gerarFeedbackComportamental(gasto, renda, saldoAtual, impactoMensal);

  return {
    saldoAtual, saldoComGasto, diferencaSaldo,
    taxaPoupancaAtual, taxaPoupancaComGasto,
    patrimonioAtual12m, patrimonioComGasto12m,
    projecaoSem, projecaoCom,
    scoreAtual, scoreComGasto,
    metas, feedback,
  };
}

function gerarFeedbackComportamental(gasto: GastoSimulado, renda: number, saldoAtual: number, impactoMensal: number): string {
  const msgs: string[] = [];
  const emocoesImpulsivas = ['ansioso', 'triste', 'frustrado', 'estressado', 'entediado'];

  if (gasto.emocao && emocoesImpulsivas.includes(gasto.emocao)) {
    msgs.push('⚠️ Compra associada a emoção negativa. Considere esperar 24h antes de decidir.');
  }

  if (renda > 0) {
    const pct = Math.round((gasto.valor / renda) * 100);
    if (pct >= 30) {
      msgs.push(`🚨 Este gasto representa ${pct}% da sua renda mensal — muito elevado.`);
    } else if (pct >= 15) {
      msgs.push(`⚠️ Este gasto compromete ${pct}% da sua renda mensal.`);
    }
  }

  if (saldoAtual > 0 && impactoMensal > saldoAtual) {
    msgs.push('🔴 Este gasto ultrapassa seu saldo disponível no mês. Você ficará no negativo.');
  } else if (saldoAtual > 0 && impactoMensal > saldoAtual * 0.5) {
    msgs.push('🟡 Este gasto consome mais da metade do seu saldo mensal.');
  }

  if (gasto.parcelado && gasto.parcelas > 6) {
    msgs.push(`📌 Parcelamento longo (${gasto.parcelas}x) compromete seu orçamento por muitos meses.`);
  }

  if (gasto.categoria === 'lazer' && renda > 0 && (gasto.valor / renda) > 0.1) {
    msgs.push('💡 Gastos com lazer acima de 10% da renda podem impactar suas metas.');
  }

  if (msgs.length === 0) {
    msgs.push('✅ Este gasto parece controlado dentro do seu orçamento atual.');
  }

  return msgs.join('\n');
}

// --- Alertas ---

export function gerarAlertas(state: FinancialState): Alerta[] {
  const alertas: Alerta[] = [];

  const comprometida = calcularRendaComprometida(state);
  if (comprometida > 60) {
    alertas.push({
      id: 'alerta_renda',
      tipo: 'renda_comprometida',
      titulo: 'Renda muito comprometida',
      descricao: `${comprometida}% da sua renda está comprometida. O ideal é manter abaixo de 60%.`,
      severidade: comprometida > 80 ? 'alta' : 'media',
    });
  }

  state.metas.filter(m => m.status === 'ativa').forEach(meta => {
    if (meta.aporte_mensal_planejado > 0) {
      const restante = meta.valor_objetivo - meta.valor_atual;
      const mesesNecessarios = Math.ceil(restante / meta.aporte_mensal_planejado);
      const prazo = new Date(meta.prazo);
      const hoje = new Date();
      const mesesDisponiveis = (prazo.getFullYear() - hoje.getFullYear()) * 12 + prazo.getMonth() - hoje.getMonth();
      if (mesesNecessarios > mesesDisponiveis) {
        alertas.push({
          id: `alerta_meta_${meta.id}`,
          tipo: 'meta_atrasada',
          titulo: `Meta "${meta.nome}" atrasada`,
          descricao: `No ritmo atual, serão necessários ${mesesNecessarios} meses, mas o prazo é de ${mesesDisponiveis} meses.`,
          severidade: 'media',
        });
      }
    }
  });

  state.dividas.forEach(d => {
    if (d.taxa_juros > 5) {
      alertas.push({
        id: `alerta_juros_${d.id}`,
        tipo: 'juros_alto',
        titulo: `Juros elevados: ${d.nome}`,
        descricao: `Taxa de ${d.taxa_juros}% a.m. Considere renegociar ou priorizar quitação.`,
        severidade: 'alta',
      });
    }
  });

  const despesas = state.lancamentos.filter(l => l.tipo === 'despesa');
  const totalDesp = despesas.reduce((s, l) => s + l.valor, 0);
  const totalImpulsivo = despesas.filter(l => l.impulsivo).reduce((s, l) => s + l.valor, 0);
  const pctImpulsivo = totalDesp > 0 ? (totalImpulsivo / totalDesp) * 100 : 0;
  if (pctImpulsivo > 25) {
    alertas.push({
      id: 'alerta_impulsividade',
      tipo: 'impulsividade',
      titulo: 'Gastos impulsivos elevados',
      descricao: `${Math.round(pctImpulsivo)}% dos seus gastos são impulsivos. Tente aplicar a regra das 24h.`,
      severidade: 'media',
    });
  }

  return alertas;
}

// --- Relatórios ---

export function gastosPorCategoria(state: FinancialState, mes?: string) {
  const despesas = mes
    ? state.lancamentos.filter(l => l.tipo === 'despesa' && l.data.startsWith(mes))
    : state.lancamentos.filter(l => l.tipo === 'despesa');
  const map: Record<string, number> = {};
  despesas.forEach(l => { map[l.categoria] = (map[l.categoria] || 0) + l.valor; });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function gastosPorEmocao(state: FinancialState) {
  const despesas = state.lancamentos.filter(l => l.tipo === 'despesa' && l.emocao);
  const map: Record<string, number> = {};
  despesas.forEach(l => { map[l.emocao!] = (map[l.emocao!] || 0) + l.valor; });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function calcularTaxaPoupanca(state: FinancialState): number {
  const renda = calcularRendaTotal(state) || state.config.renda_mensal;
  if (renda === 0) return 0;
  const saldo = calcularSaldoMes(state);
  return Math.round(Math.max(0, (saldo / renda) * 100));
}

export function calcularIndiceImpulsividade(state: FinancialState): number {
  const despesas = state.lancamentos.filter(l => l.tipo === 'despesa');
  const total = despesas.reduce((s, l) => s + l.valor, 0);
  const impulsivo = despesas.filter(l => l.impulsivo).reduce((s, l) => s + l.valor, 0);
  return total > 0 ? Math.round((impulsivo / total) * 100) : 0;
}
