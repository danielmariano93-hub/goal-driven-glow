// Limiares de status do Mapa Financeiro. TODOS são [provisório]: decisão de produto, não resultado científico.
// Ficam num só lugar para serem revisados com dados reais (spec seção 6). A tela deve chamá-los de "referência prática".

/** Poupança: % da renda dos 3 últimos meses fechados. */
export const SAVINGS_OK_PCT = 10;
/** Cobertura das obrigações do mês por dinheiro certo (razão). */
export const COVERAGE_OK = 1;
export const COVERAGE_CRITICAL = 0.5;
/** Reserva (meses cobertos) alvo conforme a estabilidade da renda. Abaixo de 1 mês é crítico. */
export const RESERVE_TARGET_MONTHS = { regular: 3, variavel: 4.5, irregular: 6, insuficiente: 3 } as const;
export const RESERVE_CRITICAL_MONTHS = 1;
/** Choque de 1 renda: liquidez ÷ renda típica. */
export const SHOCK_OK = 1;
export const SHOCK_CRITICAL = 0.5;
/** Parte do consumo com flag de essencial confirmada para falar em "essenciais". */
export const ESSENTIAL_COVERAGE_MIN = 0.8;
/** Essenciais acima desta fração da renda típica = pressão estrutural. */
export const ESSENTIAL_STRUCTURAL_SHARE = 0.8;
/** Comprometimento da renda com parcelas de dívida. */
export const DEBT_SERVICE_ATTENTION = 0.35;
export const DEBT_SERVICE_CRITICAL = 0.5;
/** Fração do saldo devedor com taxa/tipo informados para calcular custo e perfil. */
export const DEBT_DATA_COVERAGE_MIN = 0.7;
/** Custo médio mensal (% a.m.). */
export const DEBT_COST_OK_PM = 3;
export const DEBT_COST_CRITICAL_PM = 8;
/** Parte do saldo em modalidades de custo alto (rotativo, cheque especial, informal). */
export const DEBT_HIGH_COST_ATTENTION = 0.2;
export const DEBT_HIGH_COST_CRITICAL = 0.5;
export const HIGH_COST_DEBT_KINDS = ["cartao_rotativo", "cheque_especial", "informal"] as const;
/** Aumento do saldo devedor no mês (fração) que vira alerta. */
export const DEBT_GROWTH_CRITICAL = 0.05;
/** Janela para ligar um resgate a um pagamento de dívida. */
export const REDEMPTION_MATCH_DAYS = 7;
/** Sequência de meses fechados com resultado negativo que caracteriza pressão estrutural. */
export const NEGATIVE_STREAK_STRUCTURAL = 3;
