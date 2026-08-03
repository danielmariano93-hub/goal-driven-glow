// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Dicionário único de copy do RESULTADO do período (`finance_contract.v4`).
//
// ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/copy/resultWording.ts
// (gerado por scripts/sync-finance-core.mjs — não editar o espelho à mão).
//
// Regra de produto: o Nino NUNCA fala "fechou negativo", "déficit" ou
// "no vermelho". Quando os gastos superam as receitas, a leitura é sempre
// "gastou X acima do que recebeu". Nenhum número novo é criado aqui.

const BRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

/** Palavras proibidas na copy de usuário — usado também nos testes. */
export const FORBIDDEN_RESULT_WORDS = [
  "fechou negativo",
  "fechou no negativo",
  "déficit",
  "deficit",
  "no vermelho",
  "saldo negativo do mês",
];

export type ResultShape = "surplus" | "gap" | "even";

export function resultShape(income: number, expense: number): ResultShape {
  const net = Number(income || 0) - Number(expense || 0);
  if (net > 0.005) return "surplus";
  if (net < -0.005) return "gap";
  return "even";
}

/** Título curto do resultado. `periodWord` = "mês" | "semana". */
export function resultHeadline(income: number, expense: number, periodWord = "mês"): string {
  const net = Number(income || 0) - Number(expense || 0);
  switch (resultShape(income, expense)) {
    case "surplus":
      return income > 0
        ? `Sobraram ${BRL(net)} de ${BRL(income)} recebidos`
        : `Sobraram ${BRL(net)} neste ${periodWord}`;
    case "gap":
      return `Você gastou ${BRL(Math.abs(net))} acima do que recebeu`;
    default:
      return `Receitas e gastos empataram neste ${periodWord}`;
  }
}

/** Frase para narrativa longa (relatórios, resumo do assessor). */
export function resultSentence(income: number, expense: number, periodWord = "mês"): string {
  const net = Number(income || 0) - Number(expense || 0);
  const base = `você registrou ${BRL(income)} de receitas e ${BRL(expense)} de gastos`;
  switch (resultShape(income, expense)) {
    case "surplus":
      return `${base} — sobraram ${BRL(net)} neste ${periodWord}`;
    case "gap":
      return `${base} — gastou ${BRL(Math.abs(net))} acima do que recebeu neste ${periodWord}`;
    default:
      return `${base} — receitas e gastos empataram neste ${periodWord}`;
  }
}

/** Rótulo da linha de resultado em mensagens curtas (WhatsApp). */
export function resultLineLabel(income: number, expense: number): string {
  switch (resultShape(income, expense)) {
    case "surplus":
      return "Sobra";
    case "gap":
      return "Gastos acima das receitas";
    default:
      return "Resultado";
  }
}

/** Valor sempre em módulo — nunca exibimos "-R$ x" como resultado. */
export function resultLineValue(income: number, expense: number): string {
  return BRL(Math.abs(Number(income || 0) - Number(expense || 0)));
}

/** Definição canônica do patrimônio líquido, usada em hints e no glossário. */
export const NET_WORTH_DEFINITION =
  "Patrimônio líquido = dinheiro em conta + investido − fatura em aberto − outras dívidas.";

/** Definição canônica dos recursos brutos (antes das obrigações). */
export const RESOURCES_DEFINITION =
  "Seus recursos hoje = dinheiro em conta + investido, antes de descontar as obrigações.";
