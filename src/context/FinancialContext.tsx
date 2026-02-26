import React, { createContext, useContext, useReducer, useEffect, useMemo, type ReactNode } from 'react';
import type { Lancamento, Meta, Aporte, Divida, ContaFixa, Investimento, EmocaoDiaria, ConfiguracaoPerfil, Alerta } from '@/types/financial';
import { type FinancialState, gerarAlertas, calcularPatrimonioLiquido, calcularSaldoMes, calcularRendaComprometida, calcularTotalInvestido, calcularTotalDividas, calcularScoreFinanceiro, calcularScoreEmocional, calcularRendaTotal, calcularGastoTotal, calcularGastosFixos, calcularGastosVariaveis, calcularProjecao, calcularTaxaPoupanca, calcularIndiceImpulsividade } from '@/lib/engine';

// --- Seed Data ---
const SEED_LANCAMENTOS: Lancamento[] = [
  { id: 'l1', data: '2026-02-01', tipo: 'receita', categoria: 'salario', descricao: 'Salário', valor: 8500, fixo: true, recorrente: true, impulsivo: false },
  { id: 'l2', data: '2026-02-15', tipo: 'receita', categoria: 'freelance', descricao: 'Freelance', valor: 1200, fixo: false, recorrente: false, impulsivo: false },
  { id: 'l3', data: '2026-02-03', tipo: 'despesa', categoria: 'alimentacao', descricao: 'Supermercado', valor: 45, fixo: false, recorrente: false, impulsivo: false, emocao: 'calmo', forma_pagamento: 'pix' },
  { id: 'l4', data: '2026-02-05', tipo: 'despesa', categoria: 'vestuario', descricao: 'Roupa nova', valor: 189, fixo: false, recorrente: false, impulsivo: true, emocao: 'ansioso', forma_pagamento: 'credito' },
  { id: 'l5', data: '2026-02-07', tipo: 'despesa', categoria: 'alimentacao', descricao: 'Almoço', valor: 32, fixo: false, recorrente: false, impulsivo: false, emocao: 'calmo', forma_pagamento: 'debito' },
  { id: 'l6', data: '2026-02-10', tipo: 'despesa', categoria: 'lazer', descricao: 'Jogo novo', valor: 250, fixo: false, recorrente: false, impulsivo: true, emocao: 'entediado', forma_pagamento: 'credito' },
  { id: 'l7', data: '2026-02-12', tipo: 'despesa', categoria: 'transporte', descricao: 'Uber', valor: 60, fixo: false, recorrente: false, impulsivo: false, emocao: 'estressado', forma_pagamento: 'pix' },
  { id: 'l8', data: '2026-02-14', tipo: 'despesa', categoria: 'alimentacao', descricao: 'Jantar especial', valor: 120, fixo: false, recorrente: false, impulsivo: false, emocao: 'feliz', forma_pagamento: 'credito' },
  { id: 'l9', data: '2026-02-18', tipo: 'despesa', categoria: 'saude', descricao: 'Farmácia', valor: 85, fixo: false, recorrente: false, impulsivo: false, emocao: 'calmo', forma_pagamento: 'pix' },
  { id: 'l10', data: '2026-02-20', tipo: 'despesa', categoria: 'lazer', descricao: 'Eletrônico', valor: 350, fixo: false, recorrente: false, impulsivo: true, emocao: 'empolgado', forma_pagamento: 'credito' },
  { id: 'l11', data: '2026-01-01', tipo: 'receita', categoria: 'salario', descricao: 'Salário', valor: 8500, fixo: true, recorrente: true, impulsivo: false },
  { id: 'l12', data: '2026-01-05', tipo: 'despesa', categoria: 'alimentacao', descricao: 'Supermercado', valor: 520, fixo: false, recorrente: false, impulsivo: false, emocao: 'calmo', forma_pagamento: 'debito' },
  { id: 'l13', data: '2026-01-10', tipo: 'despesa', categoria: 'transporte', descricao: 'Combustível', valor: 200, fixo: false, recorrente: false, impulsivo: false, forma_pagamento: 'debito' },
];

const SEED_METAS: Meta[] = [
  { id: 'm1', nome: 'Reserva de Emergência', tipo: 'reserva_emergencia', valor_objetivo: 30000, valor_atual: 18500, prazo: '2026-12-31', prioridade: 'alta', status: 'ativa', motivacao_emocional: 'Segurança e tranquilidade', aporte_mensal_planejado: 1500 },
  { id: 'm2', nome: 'Viagem Europa', tipo: 'compra', valor_objetivo: 25000, valor_atual: 8200, prazo: '2027-06-30', prioridade: 'media', status: 'ativa', motivacao_emocional: 'Experiência e liberdade', aporte_mensal_planejado: 1000 },
  { id: 'm3', nome: 'Entrada Apartamento', tipo: 'compra', valor_objetivo: 100000, valor_atual: 32000, prazo: '2028-12-31', prioridade: 'alta', status: 'ativa', motivacao_emocional: 'Estabilidade e conquista', aporte_mensal_planejado: 2000 },
];

const SEED_APORTES: Aporte[] = [
  { id: 'a1', meta_id: 'm1', data: '2026-01-15', valor: 1500 },
  { id: 'a2', meta_id: 'm2', data: '2026-01-15', valor: 1000 },
  { id: 'a3', meta_id: 'm3', data: '2026-01-15', valor: 2000 },
];

const SEED_DIVIDAS: Divida[] = [
  { id: 'd1', nome: 'Financiamento Carro', valor_original: 45000, valor_atual: 28000, taxa_juros: 1.2, parcelas_totais: 48, parcelas_restantes: 28, valor_parcela: 1150, prioridade: 'alta' },
  { id: 'd2', nome: 'Cartão de Crédito', valor_original: 3500, valor_atual: 2100, taxa_juros: 12.5, parcelas_totais: 6, parcelas_restantes: 3, valor_parcela: 780, prioridade: 'alta' },
];

const SEED_CONTAS: ContaFixa[] = [
  { id: 'cf1', nome: 'Aluguel', valor: 2200, vencimento: 5, recorrencia_mensal: true },
  { id: 'cf2', nome: 'Internet', valor: 120, vencimento: 10, recorrencia_mensal: true },
  { id: 'cf3', nome: 'Energia', valor: 180, vencimento: 15, recorrencia_mensal: true },
  { id: 'cf4', nome: 'Academia', valor: 150, vencimento: 1, recorrencia_mensal: true },
];

const SEED_INVESTIMENTOS: Investimento[] = [
  { id: 'i1', tipo: 'Tesouro Selic', valor_aplicado: 15000, valor_atual: 16200, rendimento_estimado: 13.25, liquidez: 'imediata' },
  { id: 'i2', tipo: 'CDB', valor_aplicado: 10000, valor_atual: 10800, rendimento_estimado: 12.5, liquidez: 'curto_prazo' },
  { id: 'i3', tipo: 'Ações', valor_aplicado: 8000, valor_atual: 9100, rendimento_estimado: 15, liquidez: 'imediata' },
];

const SEED_EMOCOES: EmocaoDiaria[] = [
  { id: 'e1', data: '2026-02-20', nivel: 3, emocao_principal: 'calmo', observacao: 'Dia tranquilo' },
  { id: 'e2', data: '2026-02-19', nivel: 2, emocao_principal: 'ansioso', observacao: 'Preocupado com contas' },
  { id: 'e3', data: '2026-02-18', nivel: 4, emocao_principal: 'feliz', observacao: 'Recebi o pagamento do freelance' },
];

const DEFAULT_CONFIG: ConfiguracaoPerfil = {
  renda_mensal: 8500,
  frequencia_recebimento: 'mensal',
  perfil_risco: 'moderado',
  objetivo_macro: 'Independência financeira',
  horizonte_tempo: 10,
};

// --- State ---
interface State extends FinancialState {
  alertas: Alerta[];
}

const STORAGE_KEY = 'financial_ecosystem_v1';

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      // recompute alertas
      parsed.alertas = gerarAlertas(parsed);
      return parsed;
    }
  } catch {}
  const seed: State = {
    lancamentos: SEED_LANCAMENTOS,
    metas: SEED_METAS,
    aportes: SEED_APORTES,
    dividas: SEED_DIVIDAS,
    contasFixas: SEED_CONTAS,
    investimentos: SEED_INVESTIMENTOS,
    emocoes: SEED_EMOCOES,
    config: DEFAULT_CONFIG,
    alertas: [],
  };
  seed.alertas = gerarAlertas(seed);
  return seed;
}

// --- Actions ---
type Action =
  | { type: 'ADD_LANCAMENTO'; payload: Lancamento }
  | { type: 'UPDATE_LANCAMENTO'; payload: Lancamento }
  | { type: 'DELETE_LANCAMENTO'; payload: string }
  | { type: 'ADD_META'; payload: Meta }
  | { type: 'UPDATE_META'; payload: Meta }
  | { type: 'DELETE_META'; payload: string }
  | { type: 'ADD_APORTE'; payload: Aporte }
  | { type: 'ADD_DIVIDA'; payload: Divida }
  | { type: 'UPDATE_DIVIDA'; payload: Divida }
  | { type: 'DELETE_DIVIDA'; payload: string }
  | { type: 'ADD_CONTA_FIXA'; payload: ContaFixa }
  | { type: 'UPDATE_CONTA_FIXA'; payload: ContaFixa }
  | { type: 'DELETE_CONTA_FIXA'; payload: string }
  | { type: 'ADD_INVESTIMENTO'; payload: Investimento }
  | { type: 'UPDATE_INVESTIMENTO'; payload: Investimento }
  | { type: 'DELETE_INVESTIMENTO'; payload: string }
  | { type: 'ADD_EMOCAO'; payload: EmocaoDiaria }
  | { type: 'UPDATE_CONFIG'; payload: Partial<ConfiguracaoPerfil> }
  | { type: 'IMPORT_DATA'; payload: Partial<State> };

function reducer(state: State, action: Action): State {
  let next: State;
  switch (action.type) {
    case 'ADD_LANCAMENTO':
      next = { ...state, lancamentos: [...state.lancamentos, action.payload] }; break;
    case 'UPDATE_LANCAMENTO':
      next = { ...state, lancamentos: state.lancamentos.map(l => l.id === action.payload.id ? action.payload : l) }; break;
    case 'DELETE_LANCAMENTO':
      next = { ...state, lancamentos: state.lancamentos.filter(l => l.id !== action.payload) }; break;
    case 'ADD_META':
      next = { ...state, metas: [...state.metas, action.payload] }; break;
    case 'UPDATE_META':
      next = { ...state, metas: state.metas.map(m => m.id === action.payload.id ? action.payload : m) }; break;
    case 'DELETE_META':
      next = { ...state, metas: state.metas.filter(m => m.id !== action.payload) }; break;
    case 'ADD_APORTE':
      next = { ...state, aportes: [...state.aportes, action.payload] };
      const metaAporte = next.metas.find(m => m.id === action.payload.meta_id);
      if (metaAporte) {
        next.metas = next.metas.map(m => m.id === action.payload.meta_id
          ? { ...m, valor_atual: m.valor_atual + action.payload.valor }
          : m
        );
      }
      break;
    case 'ADD_DIVIDA':
      next = { ...state, dividas: [...state.dividas, action.payload] }; break;
    case 'UPDATE_DIVIDA':
      next = { ...state, dividas: state.dividas.map(d => d.id === action.payload.id ? action.payload : d) }; break;
    case 'DELETE_DIVIDA':
      next = { ...state, dividas: state.dividas.filter(d => d.id !== action.payload) }; break;
    case 'ADD_CONTA_FIXA':
      next = { ...state, contasFixas: [...state.contasFixas, action.payload] }; break;
    case 'UPDATE_CONTA_FIXA':
      next = { ...state, contasFixas: state.contasFixas.map(c => c.id === action.payload.id ? action.payload : c) }; break;
    case 'DELETE_CONTA_FIXA':
      next = { ...state, contasFixas: state.contasFixas.filter(c => c.id !== action.payload) }; break;
    case 'ADD_INVESTIMENTO':
      next = { ...state, investimentos: [...state.investimentos, action.payload] }; break;
    case 'UPDATE_INVESTIMENTO':
      next = { ...state, investimentos: state.investimentos.map(i => i.id === action.payload.id ? action.payload : i) }; break;
    case 'DELETE_INVESTIMENTO':
      next = { ...state, investimentos: state.investimentos.filter(i => i.id !== action.payload) }; break;
    case 'ADD_EMOCAO':
      next = { ...state, emocoes: [action.payload, ...state.emocoes] }; break;
    case 'UPDATE_CONFIG':
      next = { ...state, config: { ...state.config, ...action.payload } }; break;
    case 'IMPORT_DATA':
      next = { ...state, ...action.payload }; break;
    default:
      return state;
  }
  next.alertas = gerarAlertas(next);
  return next;
}

// --- Context ---
interface FinancialContextValue {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const FinancialContext = createContext<FinancialContextValue | null>(null);

export function FinancialProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    const { alertas, ...rest } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  }, [state]);

  return (
    <FinancialContext.Provider value={{ state, dispatch }}>
      {children}
    </FinancialContext.Provider>
  );
}

export function useFinancial() {
  const ctx = useContext(FinancialContext);
  if (!ctx) throw new Error('useFinancial must be inside FinancialProvider');
  return ctx;
}

export function useIndicadores(mes?: string) {
  const { state } = useFinancial();
  return useMemo(() => ({
    patrimonioLiquido: calcularPatrimonioLiquido(state),
    saldoMes: calcularSaldoMes(state, mes),
    rendaComprometida: calcularRendaComprometida(state, mes),
    totalInvestido: calcularTotalInvestido(state),
    totalDividas: calcularTotalDividas(state),
    scoreFinanceiro: calcularScoreFinanceiro(state),
    scoreEmocional: calcularScoreEmocional(state),
    rendaTotal: calcularRendaTotal(state, mes),
    gastoTotal: calcularGastoTotal(state, mes),
    gastosFixos: calcularGastosFixos(state),
    gastosVariaveis: calcularGastosVariaveis(state, mes),
    projecao12: calcularProjecao(state, 12),
    taxaPoupanca: calcularTaxaPoupanca(state),
    indiceImpulsividade: calcularIndiceImpulsividade(state),
  }), [state, mes]);
}
