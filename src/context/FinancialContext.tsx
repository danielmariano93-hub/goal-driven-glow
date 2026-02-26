import React, { createContext, useContext, useReducer, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Lancamento, Meta, Aporte, Divida, ContaFixa, Investimento, EmocaoDiaria, ConfiguracaoPerfil, Alerta } from '@/types/financial';
import { type FinancialState, gerarAlertas, calcularPatrimonioLiquido, calcularSaldoMes, calcularRendaComprometida, calcularTotalInvestido, calcularTotalDividas, calcularScoreFinanceiro, calcularScoreEmocional, calcularRendaTotal, calcularGastoTotal, calcularGastosFixos, calcularGastosVariaveis, calcularProjecao, calcularTaxaPoupanca, calcularIndiceImpulsividade } from '@/lib/engine';

// --- Seed Data (vazio - usuario comeca do zero) ---
const SEED_LANCAMENTOS: Lancamento[] = [];
const SEED_METAS: Meta[] = [];
const SEED_APORTES: Aporte[] = [];
const SEED_DIVIDAS: Divida[] = [];
const SEED_CONTAS: ContaFixa[] = [];
const SEED_INVESTIMENTOS: Investimento[] = [];
const SEED_EMOCOES: EmocaoDiaria[] = [];

const DEFAULT_CONFIG: ConfiguracaoPerfil = {
  renda_mensal: 0,
  frequencia_recebimento: 'mensal',
  perfil_risco: 'moderado',
  objetivo_macro: '',
  horizonte_tempo: 5,
};

const DEFAULT_CATEGORIAS_CUSTOM: string[] = [];

// --- State ---
interface State extends FinancialState {
  alertas: Alerta[];
  categoriasCustom: string[];
}

const STORAGE_KEY = 'financial_ecosystem_v2';

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
    categoriasCustom: DEFAULT_CATEGORIAS_CUSTOM,
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
  | { type: 'IMPORT_DATA'; payload: Partial<State> }
  | { type: 'ADD_CATEGORIA'; payload: string }
  | { type: 'DELETE_CATEGORIA'; payload: string };

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
    case 'ADD_CATEGORIA':
      next = { ...state, categoriasCustom: [...(state.categoriasCustom || []), action.payload] }; break;
    case 'DELETE_CATEGORIA':
      next = { ...state, categoriasCustom: (state.categoriasCustom || []).filter(c => c !== action.payload) }; break;
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
    // Ensure categoriasCustom is persisted
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, categoriasCustom: state.categoriasCustom || [] }));
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
