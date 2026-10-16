// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
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

// ---- Hábitos (fase 3). Também [provisório]; hábitos nunca chegam a "crítico": mostram atenção, não alarme. ----------------
/** Períodos comparáveis mínimos para falar em aderência. */
export const ADHERENCE_MIN_PERIODS = 3;
/** Aderência (% de períodos cumpridos): ok a partir daqui. */
export const ADHERENCE_OK_PCT = 70;
/** Planejamento: compromissos planejados ÷ renda típica. ≤ OK cabe com folga; ≤ 1 cabe justo; > 1 não cabe. */
export const VIABILITY_OK = 0.9;
export const VIABILITY_LIMIT = 1;
/** Recorrências detectadas no histórico que já estão cadastradas (%). */
export const RECURRING_REGISTERED_OK_PCT = 70;
export const RECURRING_MIN_DETECTED = 2;
/** Respostas mínimas para falar em "intencionalidade" e "reconhecimento". */
export const INTENT_MIN_ANSWERS = 5;
/** Calibragem (erro médio da estimativa de gasto do mês, %). */
export const CALIBRATION_MIN_ANSWERS = 2;
export const CALIBRATION_OK_PCT = 15;
/** Orçamento de atenção do agendador de perguntas. */
export const QUESTIONS_PER_DAY = 1;
export const QUESTIONS_PER_WEEK = 3;
export const QUESTION_SKIP_COOLDOWN_DAYS = 7;
export const QUESTION_LATER_DAYS = 2;
/** Estimativa mensal: perguntada nos primeiros dias após o fechamento do mês. */
export const ESTIMATE_ASK_UNTIL_DAY = 20;

// ---- Recomendação (fase 4) -------------------------------------------------------------------------------------------------
/** Depois de recusar uma recomendação, ela não volta por este período (dias). */
export const RECOMMENDATION_DISMISS_COOLDOWN_DAYS = 30;
export const RECOMMENDATION_NOT_USEFUL_COOLDOWN_DAYS = 60;
/** Depois de aceitar, dá tempo para a pessoa agir antes de insistir (dias). */
export const RECOMMENDATION_ACCEPTED_COOLDOWN_DAYS = 14;
