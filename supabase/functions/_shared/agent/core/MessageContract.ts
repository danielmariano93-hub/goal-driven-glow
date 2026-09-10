// comm_contract.v1 — contrato de comunicação (título, corpo, moldura, ação).
// ==========================================================================
// Regras duras, válidas para QUALQUER tipo de comunicação:
//  1. o mesmo fato não aparece duas vezes na mesma mensagem;
//  2. no máximo uma pergunta/ação por mensagem;
//  3. nenhum marcador técnico chega ao usuário;
//  4. o WhatsApp tem um único renderizador (determinístico e narrativo).
export const COMM_CONTRACT_VERSION = "comm_contract.v1";

export function normalizeForCompare(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[*_~`]+/g, "")
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitBlocks(text: string): string[] {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Marcadores técnicos que nunca podem chegar ao usuário. */
export function stripTechnicalMarkers(text: string): { text: string; removed: boolean } {
  const before = String(text ?? "");
  const after = before
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\b(?:null|undefined|NaN)\b/g, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: after, removed: normalizeForCompare(before) !== normalizeForCompare(after) };
}

/**
 * Remove do corpo (incluindo moldura) qualquer bloco/frase que apenas repita o
 * título ou um fato já dito antes. Funciona quando a repetição vem depois E
 * quando vem antes (moldura acima do conteúdo).
 */
export function dedupeFacts(title: string, body: string): { body: string; removed: number; titleCovered: boolean } {
  const seen = new Set<string>();
  const titleNorm = normalizeForCompare(title);
  if (titleNorm) seen.add(titleNorm);
  let removed = 0;

  let titleCovered = false;

  const blocks = splitBlocks(body).map((block) => {
    const kept = splitSentences(block).filter((sentence) => {
      const norm = normalizeForCompare(sentence);
      if (!norm) return false;
      // Frase que apenas repete um fato já dito sai da mensagem.
      const repeats = [...seen].some((prev) =>
        prev === norm || (norm.length > 18 && prev.startsWith(norm))
      );
      if (repeats) {
        removed += 1;
        return false;
      }
      // Frase que começa com o título mas acrescenta informação fica: o título
      // é que deixa de ser repetido acima dela.
      if (titleNorm && titleNorm.length > 12 && norm.startsWith(titleNorm)) titleCovered = true;
      seen.add(norm);
      return true;
    });
    return kept.join(" ").trim();
  }).filter(Boolean);

  return { body: blocks.join("\n\n"), removed, titleCovered };
}

/** Uma pergunta por mensagem: a primeira permanece, as seguintes saem. */
export function enforceSingleQuestion(body: string): { body: string; removed: number } {
  let seenQuestion = false;
  let removed = 0;
  const blocks = splitBlocks(body).map((block) => {
    const kept = splitSentences(block).filter((sentence) => {
      if (!sentence.endsWith("?")) return true;
      if (seenQuestion) {
        removed += 1;
        return false;
      }
      seenQuestion = true;
      return true;
    });
    return kept.join(" ").trim();
  }).filter(Boolean);
  return { body: blocks.join("\n\n"), removed };
}

export type MessageGuardResult = {
  title: string;
  body: string;
  guards: string[];
  contract_version: string;
};

/** Passagem única de contrato, usada por app e WhatsApp. */
export function applyMessageContract(title: string, body: string): MessageGuardResult {
  const guards: string[] = [];
  const cleanTitle = stripTechnicalMarkers(title);
  const cleanBody = stripTechnicalMarkers(body);
  if (cleanTitle.removed || cleanBody.removed) guards.push("technical_marker_stripped");

  const deduped = dedupeFacts(cleanTitle.text, cleanBody.text);
  if (deduped.removed > 0) guards.push(`duplicate_fact_removed:${deduped.removed}`);
  if (deduped.titleCovered) guards.push("title_absorbed_by_body");

  const single = enforceSingleQuestion(deduped.body);
  if (single.removed > 0) guards.push(`extra_cta_removed:${single.removed}`);

  return {
    title: deduped.titleCovered ? "" : cleanTitle.text,
    body: single.body || cleanBody.text,
    guards,
    contract_version: COMM_CONTRACT_VERSION,
  };
}

/**
 * Renderizador único do WhatsApp: título em negrito, blocos curtos separados
 * por linha em branco, pergunta final destacada, sem repetição.
 */
export function renderWhatsappMessage(title: string, body: string): { message: string; guards: string[] } {
  const contract = applyMessageContract(title, body);
  const blocks = splitBlocks(contract.body).map((block) =>
    block.endsWith("?") ? `*${block}*` : block
  );
  const head = contract.title.trim();
  const message = [head ? `*${head}*` : "", ...blocks].filter(Boolean).join("\n\n").slice(0, 1800);
  return { message, guards: contract.guards };
}
