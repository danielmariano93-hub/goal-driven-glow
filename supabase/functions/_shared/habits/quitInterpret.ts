// Interpretação determinística (sem IA) das mensagens de "largar" e de automaticidade (F3/F4). Falha fechado: null = não é comigo.
import { norm } from "./interpret.ts";

export type QuitLite = { id: string; title: string };

export type QuitIntent =
  | { kind: "crisis" }
  | { kind: "craving"; habit_id: string }
  | { kind: "resisted"; craving_habit_id: string }
  | { kind: "slip"; habit_id: string }
  | { kind: "restart"; habit_id: string }
  | { kind: "quit_ask"; candidates: string[]; what: "craving" | "slip" }
  | { kind: "quit_status" }
  | { kind: "automaticity"; habit_id: string; score: number };

export type QuitContext = {
  quits: QuitLite[];
  /** Vontade registrada (sem resposta) nas últimas 3 h, por hábito. */
  openCravingHabitIds: string[];
  /** Hábito com escorregão só anotado (sem zerar) nas últimas 24 h. */
  noteOnlySlipHabitIds: string[];
  /** Hábito cuja pergunta de automaticidade foi enviada nas últimas 24 h (se houver). */
  autoPromptHabitId: string | null;
};

// Só frases explícitas de sofrimento grave. "quero morrer de rir" não conta.
const CRISIS_RX = /(suicid|me matar|vou me matar|quero me matar|pensando em me matar|nao quero mais viver|quero morrer(?! de )|acabar com a minha vida|me machucar|me cortar)/;
const CRAVING_RX = /\b(bateu (a )?vontade|deu vontade|to com vontade|estou com vontade|tenho vontade|fissura|vontade de|quase cedi|vou ceder)\b/;
const RESIST_RX = /\b(resisti|aguentei|segui firme|nao cedi|passou a vontade|a vontade passou|venci a vontade|passou)\b/;
const SLIP_RX = /\b(cedi|escorreguei|recai|recaida|tive uma recaida|falhei|quebrei)\b/;
// Sem citar o hábito, só as palavras que quase só se usam para recaída; "falhei" ou "quebrei" podem ser de outro assunto.
const STRONG_SLIP_RX = /\b(cedi|escorreguei|recai|recaida|tive uma recaida)\b/;
const RESTART_RX = /^(recomecar|recomeca|recomecar a contagem|zerar|zera|zerar a contagem|zera a contagem)$/;
const QUIT_STATUS_RX = /\b(quantos dias (sem|faz)|meus dias sem|como (esta|ta) (minha|a) contagem)\b/;
const SCORE_RX = /^(?:nota\s*)?([1-7])(?:\s*(?:de|\/)\s*7)?$/;

const STOP = new Set(["para", "por", "com", "uma", "das", "dos", "meu", "minha", "antes", "depois", "sem", "de", "do", "da"]);
const stems = (title: string): string[] =>
  norm(title).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((t) => t.length >= 4 && !STOP.has(t)).map((t) => t.slice(0, Math.max(4, t.length - 2)));

function matchQuits(text: string, quits: QuitLite[]): QuitLite[] {
  const hits = quits.filter((q) => stems(q.title).some((s) => new RegExp(`(^|\\W)${s}`).test(text)));
  return hits;
}

export function crisisMatch(raw: string): boolean {
  return CRISIS_RX.test(norm(raw));
}

export function interpretQuitMessage(raw: string, ctx: QuitContext): QuitIntent | null {
  const text = norm(raw);
  if (!text || text.length > 140) return null;
  if (CRISIS_RX.test(text)) return { kind: "crisis" };

  // Nota de automaticidade: só quando a pergunta foi enviada nas últimas 24 h.
  const sm = SCORE_RX.exec(text);
  if (sm && ctx.autoPromptHabitId) return { kind: "automaticity", habit_id: ctx.autoPromptHabitId, score: Number(sm[1]) };

  if (ctx.quits.length === 0) return null;
  if (text.includes("?")) return QUIT_STATUS_RX.test(text) ? { kind: "quit_status" } : null;
  if (QUIT_STATUS_RX.test(text)) return { kind: "quit_status" };

  if (RESTART_RX.test(text)) {
    return ctx.noteOnlySlipHabitIds.length === 1 ? { kind: "restart", habit_id: ctx.noteOnlySlipHabitIds[0] } : null;
  }

  if (SLIP_RX.test(text)) {
    const hits = matchQuits(text, ctx.quits);
    if (hits.length === 0 && !STRONG_SLIP_RX.test(text)) return null;
    const pool = hits.length > 0 ? hits : ctx.quits;
    return pool.length === 1 ? { kind: "slip", habit_id: pool[0].id } : { kind: "quit_ask", candidates: pool.map((q) => q.id), what: "slip" };
  }

  if (CRAVING_RX.test(text)) {
    const hits = matchQuits(text, ctx.quits);
    // "vontade de viajar" não é comigo: sem hábito citado, só a frase pura ("bateu a vontade") vale.
    const bare = /\b(bateu (a )?vontade|deu vontade|fissura|quase cedi|vou ceder)\b/.test(text);
    if (hits.length === 0 && !bare) return null;
    const pool = hits.length > 0 ? hits : ctx.quits;
    return pool.length === 1 ? { kind: "craving", habit_id: pool[0].id } : { kind: "quit_ask", candidates: pool.map((q) => q.id), what: "craving" };
  }

  if (RESIST_RX.test(text) && ctx.openCravingHabitIds.length === 1) return { kind: "resisted", craving_habit_id: ctx.openCravingHabitIds[0] };
  return null;
}
