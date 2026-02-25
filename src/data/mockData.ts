import { Gasto, Receita, Meta, Divida, Investimento, ContaFixa } from '@/types/financial';

export const mockReceitas: Receita[] = [
  { id: '1', data: '2026-02-01', valor: 8500, categoria: 'salario', recorrente: true },
  { id: '2', data: '2026-02-15', valor: 1200, categoria: 'freelance', recorrente: false },
];

export const mockGastos: Gasto[] = [
  { id: '1', data: '2026-02-03', valor: 45, categoria: 'alimentacao', tipo: 'variavel', impulsivo: false, forma_pagamento: 'pix', descricao: 'Supermercado', emocao: 'calmo' },
  { id: '2', data: '2026-02-05', valor: 189, categoria: 'vestuario', tipo: 'variavel', impulsivo: true, forma_pagamento: 'credito', descricao: 'Roupa nova', emocao: 'ansioso' },
  { id: '3', data: '2026-02-07', valor: 32, categoria: 'alimentacao', tipo: 'variavel', impulsivo: false, forma_pagamento: 'debito', descricao: 'Almoço', emocao: 'calmo' },
  { id: '4', data: '2026-02-10', valor: 250, categoria: 'lazer', tipo: 'variavel', impulsivo: true, forma_pagamento: 'credito', descricao: 'Jogo novo', emocao: 'entediado' },
  { id: '5', data: '2026-02-12', valor: 60, categoria: 'transporte', tipo: 'variavel', impulsivo: false, forma_pagamento: 'pix', descricao: 'Uber', emocao: 'estressado' },
  { id: '6', data: '2026-02-14', valor: 120, categoria: 'alimentacao', tipo: 'variavel', impulsivo: false, forma_pagamento: 'credito', descricao: 'Jantar especial', emocao: 'feliz' },
  { id: '7', data: '2026-02-18', valor: 85, categoria: 'saude', tipo: 'variavel', impulsivo: false, forma_pagamento: 'pix', descricao: 'Farmácia', emocao: 'calmo' },
  { id: '8', data: '2026-02-20', valor: 350, categoria: 'lazer', tipo: 'variavel', impulsivo: true, forma_pagamento: 'credito', descricao: 'Eletrônico', emocao: 'empolgado' },
];

export const mockContasFixas: ContaFixa[] = [
  { id: '1', nome: 'Aluguel', valor: 2200, vencimento: 5, recorrencia_mensal: true },
  { id: '2', nome: 'Internet', valor: 120, vencimento: 10, recorrencia_mensal: true },
  { id: '3', nome: 'Energia', valor: 180, vencimento: 15, recorrencia_mensal: true },
  { id: '4', nome: 'Academia', valor: 150, vencimento: 1, recorrencia_mensal: true },
];

export const mockMetas: Meta[] = [
  { id: '1', nome: 'Reserva de Emergência', tipo: 'curto', valor_objetivo: 30000, valor_atual: 18500, prazo: '2026-12-31', prioridade: 'alta', motivacao_emocional: 'Segurança e tranquilidade', aporte_mensal_planejado: 1500 },
  { id: '2', nome: 'Viagem Europa', tipo: 'medio', valor_objetivo: 25000, valor_atual: 8200, prazo: '2027-06-30', prioridade: 'media', motivacao_emocional: 'Experiência e liberdade', aporte_mensal_planejado: 1000 },
  { id: '3', nome: 'Entrada Apartamento', tipo: 'longo', valor_objetivo: 100000, valor_atual: 32000, prazo: '2028-12-31', prioridade: 'alta', motivacao_emocional: 'Estabilidade e conquista', aporte_mensal_planejado: 2000 },
];

export const mockDividas: Divida[] = [
  { id: '1', tipo: 'Financiamento Carro', valor_original: 45000, valor_atual: 28000, taxa_juros: 1.2, parcelas_totais: 48, parcelas_restantes: 28, valor_parcela: 1150, prioridade: 'alta' },
  { id: '2', tipo: 'Cartão de Crédito', valor_original: 3500, valor_atual: 2100, taxa_juros: 12.5, parcelas_totais: 6, parcelas_restantes: 3, valor_parcela: 780, prioridade: 'alta' },
];

export const mockInvestimentos: Investimento[] = [
  { id: '1', tipo: 'Tesouro Selic', valor_aplicado: 15000, valor_atual: 16200, rendimento_estimado: 13.25, liquidez: 'imediata' },
  { id: '2', tipo: 'CDB', valor_aplicado: 10000, valor_atual: 10800, rendimento_estimado: 12.5, liquidez: 'curto_prazo' },
  { id: '3', tipo: 'Ações', valor_aplicado: 8000, valor_atual: 9100, rendimento_estimado: 15, liquidez: 'imediata' },
];

export function calcularPatrimonioLiquido() {
  const totalInvestimentos = mockInvestimentos.reduce((s, i) => s + i.valor_atual, 0);
  const totalDividas = mockDividas.reduce((s, d) => s + d.valor_atual, 0);
  return totalInvestimentos - totalDividas;
}

export function calcularRendaTotal() {
  return mockReceitas.reduce((s, r) => s + r.valor, 0);
}

export function calcularGastoTotal() {
  return mockGastos.reduce((s, g) => s + g.valor, 0) + mockContasFixas.reduce((s, c) => s + c.valor, 0);
}

export function calcularPercentualComprometido() {
  const renda = calcularRendaTotal();
  if (renda === 0) return 0;
  return Math.round((calcularGastoTotal() / renda) * 100);
}

export function calcularGastoImpulsivo() {
  const total = mockGastos.reduce((s, g) => s + g.valor, 0);
  const impulsivo = mockGastos.filter(g => g.impulsivo).reduce((s, g) => s + g.valor, 0);
  if (total === 0) return 0;
  return Math.round((impulsivo / total) * 100);
}

export function calcularIndiceDisciplina(): number {
  const comprometido = calcularPercentualComprometido();
  const impulsivo = calcularGastoImpulsivo();
  const score = Math.max(0, Math.min(100, 100 - comprometido * 0.5 - impulsivo * 1.5));
  return Math.round(score);
}

export function calcularIndiceRisco(): number {
  const comprometido = calcularPercentualComprometido();
  const totalDividas = mockDividas.reduce((s, d) => s + d.valor_atual, 0);
  const renda = calcularRendaTotal();
  const ratioDivida = renda > 0 ? (totalDividas / (renda * 12)) * 100 : 0;
  const score = Math.min(100, comprometido * 0.6 + ratioDivida * 0.4);
  return Math.round(score);
}

export function gerarInsights(): string[] {
  const insights: string[] = [];
  const impulsivo = calcularGastoImpulsivo();
  const comprometido = calcularPercentualComprometido();
  
  if (impulsivo > 20) {
    insights.push(`⚠️ ${impulsivo}% dos seus gastos são impulsivos. Tente pausar 24h antes de compras não planejadas.`);
  }
  if (comprometido > 70) {
    insights.push(`🔴 Sua renda está ${comprometido}% comprometida. Considere revisar gastos fixos.`);
  }
  
  const gastosAnsiosos = mockGastos.filter(g => g.emocao === 'ansioso' || g.emocao === 'estressado');
  if (gastosAnsiosos.length > 2) {
    insights.push(`🧠 Você tende a gastar mais quando está ansioso/estressado. ${gastosAnsiosos.length} gastos associados a essas emoções.`);
  }

  const metaProxima = mockMetas.find(m => m.prioridade === 'alta');
  if (metaProxima) {
    const progresso = Math.round((metaProxima.valor_atual / metaProxima.valor_objetivo) * 100);
    insights.push(`🎯 "${metaProxima.nome}" está em ${progresso}%. Continue firme!`);
  }

  if (insights.length === 0) {
    insights.push('✅ Suas finanças estão equilibradas. Continue assim!');
  }

  return insights;
}

export function getGastosPorCategoria() {
  const map: Record<string, number> = {};
  mockGastos.forEach(g => {
    map[g.categoria] = (map[g.categoria] || 0) + g.valor;
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export function getGastosPorDia() {
  const map: Record<string, number> = {};
  mockGastos.forEach(g => {
    const day = g.data.slice(8, 10);
    map[day] = (map[day] || 0) + g.valor;
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, valor]) => ({ dia: `${day}/02`, valor }));
}
