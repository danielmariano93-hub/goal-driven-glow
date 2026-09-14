// ConversationRepair — única fonte de verdade para feedback de correção.
//
// O mesmo texto não pode ser CANCEL em um módulo e REPAIR em outro. Este
// contrato é deliberadamente pequeno: ele só reconhece quando o usuário está
// dizendo que a interpretação/resposta anterior estava errada. Decidir o que
// fazer com a correção continua sendo responsabilidade do DialogueAct/turno.

const REPAIR_RX =
  /\b(n[aã]o foi isso(?: que eu (?:perguntei|pedi))?|n[aã]o era isso|voc[eê] n[aã]o respondeu(?: o que eu perguntei)?|isso n[aã]o respondeu(?: minha pergunta)?|respondeu outra coisa|entendeu errado|voc[eê] entendeu errado|faltou responder|eu perguntei .{0,40} n[aã]o|eu queria .{0,40} n[aã]o|isso (?:est[aá]|t[aá]) errado|(?:est[aá]|t[aá]) errado|^errado[.! ]*$)\b/i;

// Correção de valor/slot: "não foi atento, foi ansioso", "não era X, era Y".
// O verbo precisa reaparecer depois da negação para evitar falso positivo em
// frases como "não foi fácil, mas consegui economizar".
const SUBSTITUTION_RX =
  /\bn[aã]o\s+(?:foi|era|[eé]|estava|est[aá]|sou|estou)\s+[\wÀ-ú]{3,20}(?:\s+[\wÀ-ú]{2,20})?\s*[,;]?\s*(?:mas\s+|e\s+|)(?:foi|era|[eé]|estava|est[aá]|sou|estou)\s+[\wÀ-ú]{3,}/i;

export function isExplicitRepair(text: string): boolean {
  const raw = String(text ?? "").trim();
  return REPAIR_RX.test(raw) || SUBSTITUTION_RX.test(raw);
}

export function isExplicitSubstitution(text: string): boolean {
  return SUBSTITUTION_RX.test(String(text ?? "").trim());
}
