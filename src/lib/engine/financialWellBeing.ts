// Escala de Bem-Estar Financeiro do CFPB (EUA), versão padrão de 10 itens, pontuação oficial.
// Fonte: CFPB, "Measuring financial well-being: a guide to using the CFPB Financial Well-Being Scale" (2015),
// Apêndice A (planilha de pontuação, questionário autoaplicado). Adaptação brasileira validada:
// Howat-Rodrigues, Laks e Marinho (2021), DOI 10.47626/2237-6089-2020-0034 (alfa 0,89; fator único).
// TEXTO EM PORTUGUÊS: 3 das 10 frases (itens 2, 3 e 10) usam a redação da versão brasileira validada da escala
// PFWB, cujos itens coincidem com estes do CFPB (Ponchio e Cordeiro, 2020, RIMAR 10(1), DOI 10.4025/rimar.v10i1.45854;
// 1.027 respondentes). As outras 7 são tradução do Nino (`validatedPt: false`): o artigo de Howat-Rodrigues et al. (2021)
// não traz a versão final em português em nenhum formato que conseguimos acessar. Trocar pelo texto validado quando obtido.
// Puro, sem I/O. Espelhado para as Edge Functions por scripts/sync-finance-core.mjs.

export const FWB_VERSION = "cfpb_fwb10.v1";
/** Intervalo entre aplicações do questionário. */
export const FWB_CADENCE_DAYS = 15;

export type FwbFormat = "describes" | "frequency";
export interface FwbItem {
  id: number;
  text: string;
  format: FwbFormat;
  /** Item com pontuação invertida: a 1ª opção vale 0 (pior) e a última vale 4. */
  reverse: boolean;
  /** true = redação em português de versão brasileira validada; false = tradução do Nino. */
  validatedPt: boolean;
}

export const FWB_OPTIONS: Record<FwbFormat, string[]> = {
  // Ordem de exibição: da 1ª à 5ª opção, igual ao questionário original.
  describes: ["Completamente", "Muito bem", "Mais ou menos", "Muito pouco", "De jeito nenhum"],
  frequency: ["Sempre", "Muitas vezes", "Às vezes", "Raramente", "Nunca"],
};

export const FWB_ITEMS: FwbItem[] = [
  { id: 1, text: "Eu conseguiria lidar com um grande gasto inesperado", format: "describes", reverse: false, validatedPt: false },
  { id: 2, text: "Estou garantindo meu futuro financeiro", format: "describes", reverse: false, validatedPt: true },
  { id: 3, text: "Por causa da minha situação financeira, sinto que nunca terei as coisas que quero na vida", format: "describes", reverse: true, validatedPt: true },
  { id: 4, text: "Consigo aproveitar a vida por causa do jeito como administro meu dinheiro", format: "describes", reverse: false, validatedPt: false },
  { id: 5, text: "Estou apenas me virando financeiramente", format: "describes", reverse: true, validatedPt: false },
  { id: 6, text: "Me preocupa que o dinheiro que tenho ou vou guardar não dure", format: "describes", reverse: true, validatedPt: false },
  { id: 7, text: "Dar um presente de casamento, aniversário ou outra ocasião pesaria nas minhas finanças do mês", format: "frequency", reverse: true, validatedPt: false },
  { id: 8, text: "Sobra dinheiro no fim do mês", format: "frequency", reverse: false, validatedPt: false },
  { id: 9, text: "Estou atrasado(a) com as minhas finanças", format: "frequency", reverse: true, validatedPt: false },
  { id: 10, text: "Minhas finanças controlam minha vida", format: "frequency", reverse: true, validatedPt: true },
];

/** Tabela oficial (questionário autoaplicado): soma bruta 0-40 → escala 0-100. Índice = soma bruta. */
export const FWB_TABLE_18_61 = [14, 19, 22, 25, 27, 29, 31, 32, 34, 35, 37, 38, 40, 41, 42, 44, 45, 46, 47, 49, 50, 51, 52, 54, 55, 56, 58, 59, 60, 62, 63, 65, 66, 68, 69, 71, 73, 75, 78, 81, 86] as const;
export const FWB_TABLE_62_PLUS = [14, 20, 24, 26, 29, 31, 33, 35, 36, 38, 39, 41, 42, 44, 45, 46, 48, 49, 50, 52, 53, 54, 56, 57, 58, 60, 61, 63, 64, 66, 67, 69, 71, 73, 75, 77, 79, 82, 84, 88, 95] as const;

export type FwbAgeBand = "18-61" | "62+";

/** Valor 0-4 de uma resposta. `option` é o índice exibido (0 = 1ª opção). */
export function fwbResponseValue(item: FwbItem, option: number): number {
  if (!Number.isInteger(option) || option < 0 || option > 4) throw new Error("fwb_invalid_option");
  // Sem inversão: 1ª opção = 4 … última = 0. Com inversão: 1ª = 0 … última = 4.
  return item.reverse ? option : 4 - option;
}

export interface FwbResult {
  version: typeof FWB_VERSION;
  /** Soma bruta 0-40. */
  total: number;
  /** Pontuação oficial 14-95 (quanto maior, melhor). */
  score: number;
  ageBand: FwbAgeBand;
}

/** `options`: índice da opção escolhida em cada um dos 10 itens, na ordem. Exige todas as respostas. */
export function scoreFinancialWellBeing(options: Array<number | null | undefined>, ageBand: FwbAgeBand = "18-61"): FwbResult | null {
  if (options.length !== FWB_ITEMS.length || options.some((o) => o == null)) return null;
  const total = FWB_ITEMS.reduce((sum, item, i) => sum + fwbResponseValue(item, options[i] as number), 0);
  const table = ageBand === "62+" ? FWB_TABLE_62_PLUS : FWB_TABLE_18_61;
  return { version: FWB_VERSION, total, score: table[total], ageBand };
}

/** Dias até a próxima aplicação (0 = já pode responder). */
export function fwbDaysUntilDue(lastAnsweredAt: string | null | undefined, now: number = Date.now()): number {
  if (!lastAnsweredAt) return 0;
  const last = new Date(lastAnsweredAt).getTime();
  if (!Number.isFinite(last)) return 0;
  const elapsedDays = (now - last) / 86_400_000;
  return Math.max(0, Math.ceil(FWB_CADENCE_DAYS - elapsedDays));
}

/** Mudança relevante entre duas aplicações. O CFPB não define corte oficial; usamos o erro típico de ~3 pontos como piso para não narrar ruído. */
export function fwbChange(current: number, previous: number | null | undefined): { delta: number; direction: "up" | "down" | "same" } | null {
  if (previous == null) return null;
  const delta = current - previous;
  return { delta, direction: Math.abs(delta) < 3 ? "same" : delta > 0 ? "up" : "down" };
}
