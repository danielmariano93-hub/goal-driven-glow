export interface Receita {
  id: string;
  data: string;
  valor: number;
  categoria: string;
  recorrente: boolean;
}

export interface Gasto {
  id: string;
  data: string;
  valor: number;
  categoria: string;
  tipo: 'fixo' | 'variavel';
  impulsivo: boolean;
  forma_pagamento: string;
  descricao: string;
  emocao?: string;
  contexto_emocional?: string;
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

export interface Divida {
  id: string;
  tipo: string;
  valor_original: number;
  valor_atual: number;
  taxa_juros: number;
  parcelas_totais: number;
  parcelas_restantes: number;
  valor_parcela: number;
  prioridade: 'alta' | 'media' | 'baixa';
}

export interface Meta {
  id: string;
  nome: string;
  tipo: 'curto' | 'medio' | 'longo';
  valor_objetivo: number;
  valor_atual: number;
  prazo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  motivacao_emocional: string;
  aporte_mensal_planejado: number;
}

export interface EmocaoDiaria {
  id: string;
  data: string;
  nivel: number; // 1-5
  emocao_principal: string;
  observacao?: string;
}

export type CategoriaGasto = 
  | 'alimentacao' | 'transporte' | 'moradia' | 'saude' 
  | 'educacao' | 'lazer' | 'vestuario' | 'outros';

export type Emocao = 
  | 'calmo' | 'ansioso' | 'feliz' | 'triste' 
  | 'frustrado' | 'empolgado' | 'entediado' | 'estressado';

export const CATEGORIAS_GASTO: { value: CategoriaGasto; label: string; icon: string }[] = [
  { value: 'alimentacao', label: 'Alimentação', icon: '🍽️' },
  { value: 'transporte', label: 'Transporte', icon: '🚗' },
  { value: 'moradia', label: 'Moradia', icon: '🏠' },
  { value: 'saude', label: 'Saúde', icon: '💊' },
  { value: 'educacao', label: 'Educação', icon: '📚' },
  { value: 'lazer', label: 'Lazer', icon: '🎮' },
  { value: 'vestuario', label: 'Vestuário', icon: '👕' },
  { value: 'outros', label: 'Outros', icon: '📦' },
];

export const EMOCOES: { value: Emocao; label: string; icon: string }[] = [
  { value: 'calmo', label: 'Calmo', icon: '😌' },
  { value: 'ansioso', label: 'Ansioso', icon: '😰' },
  { value: 'feliz', label: 'Feliz', icon: '😊' },
  { value: 'triste', label: 'Triste', icon: '😢' },
  { value: 'frustrado', label: 'Frustrado', icon: '😤' },
  { value: 'empolgado', label: 'Empolgado', icon: '🤩' },
  { value: 'entediado', label: 'Entediado', icon: '😑' },
  { value: 'estressado', label: 'Estressado', icon: '😫' },
];

export const FORMAS_PAGAMENTO = [
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Cartão de Crédito' },
  { value: 'debito', label: 'Cartão de Débito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
];
