export interface Lancamento {
  id: string;
  data: string;
  tipo: 'receita' | 'despesa';
  categoria: string;
  subcategoria?: string;
  descricao: string;
  valor: number;
  fixo: boolean;
  recorrente: boolean;
  impulsivo: boolean;
  emocao?: string;
  forma_pagamento?: string;
}

export interface Meta {
  id: string;
  nome: string;
  tipo: 'reserva_emergencia' | 'investimento' | 'compra' | 'independencia';
  valor_objetivo: number;
  valor_atual: number;
  prazo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'ativa' | 'pausada' | 'concluida';
  motivacao_emocional: string;
  aporte_mensal_planejado: number;
}

export interface Aporte {
  id: string;
  meta_id: string;
  data: string;
  valor: number;
}

export interface Divida {
  id: string;
  nome: string;
  valor_original: number;
  valor_atual: number;
  taxa_juros: number;
  parcelas_totais: number;
  parcelas_restantes: number;
  valor_parcela: number;
  prioridade: 'alta' | 'media' | 'baixa';
}

export interface ContaFixa {
  id: string;
  nome: string;
  valor: number;
  vencimento: number;
  recorrencia_mensal: boolean;
}

export interface Investimento {
  id: string;
  tipo: string;
  valor_aplicado: number;
  valor_atual: number;
  rendimento_estimado: number;
  liquidez: 'imediata' | 'curto_prazo' | 'longo_prazo';
}

export interface EmocaoDiaria {
  id: string;
  data: string;
  nivel: number;
  emocao_principal: string;
  observacao?: string;
}

export interface ConfiguracaoPerfil {
  renda_mensal: number;
  frequencia_recebimento: 'mensal' | 'quinzenal' | 'semanal';
  perfil_risco: 'conservador' | 'moderado' | 'arrojado';
  objetivo_macro: string;
  horizonte_tempo: number;
}

export interface Alerta {
  id: string;
  tipo: 'renda_comprometida' | 'meta_atrasada' | 'juros_alto' | 'impulsividade' | 'patrimonio_queda';
  titulo: string;
  descricao: string;
  severidade: 'alta' | 'media' | 'baixa';
}

export type CategoriaGasto =
  | 'alimentacao' | 'transporte' | 'moradia' | 'saude'
  | 'educacao' | 'lazer' | 'vestuario' | 'outros';

export type Emocao =
  | 'calmo' | 'ansioso' | 'feliz' | 'triste'
  | 'frustrado' | 'empolgado' | 'entediado' | 'estressado';

export const CATEGORIAS_GASTO: { value: CategoriaGasto; label: string }[] = [
  { value: 'alimentacao', label: 'Alimentação' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'moradia', label: 'Moradia' },
  { value: 'saude', label: 'Saúde' },
  { value: 'educacao', label: 'Educação' },
  { value: 'lazer', label: 'Lazer' },
  { value: 'vestuario', label: 'Vestuário' },
  { value: 'outros', label: 'Outros' },
];

export const EMOCOES: { value: Emocao; label: string }[] = [
  { value: 'calmo', label: 'Calmo' },
  { value: 'ansioso', label: 'Ansioso' },
  { value: 'feliz', label: 'Feliz' },
  { value: 'triste', label: 'Triste' },
  { value: 'frustrado', label: 'Frustrado' },
  { value: 'empolgado', label: 'Empolgado' },
  { value: 'entediado', label: 'Entediado' },
  { value: 'estressado', label: 'Estressado' },
];

export const FORMAS_PAGAMENTO = [
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Cartão de Crédito' },
  { value: 'debito', label: 'Cartão de Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
];

export const TIPOS_META: { value: Meta['tipo']; label: string }[] = [
  { value: 'reserva_emergencia', label: 'Reserva de Emergência' },
  { value: 'investimento', label: 'Investimento' },
  { value: 'compra', label: 'Compra' },
  { value: 'independencia', label: 'Independência Financeira' },
];
