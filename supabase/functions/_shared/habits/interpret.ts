// Interpretação determinística de mensagens de hábito no WhatsApp (F2). SEM modelo de IA: casa a frase com os hábitos
// ativos da pessoa e falha fechado (devolve null) diante de qualquer dúvida, para a conversa seguir o caminho normal.
// Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seção 7: "IA só onde ajuda"; este caminho nem precisa dela).
import type { HabitKind } from "../habits-core/index.ts";

export type HabitLite = {
  id: string;
  title: string;
  kind: HabitKind;
  quantity_target: number | null;
  quantity_unit: string | null;
  /** Horário de referência do gatilho (HH:MM[:SS]) ou nulo. */
  cue_time: string | null;
};

export type HabitStatusWord = "done" | "minimum" | "skipped" | "rest" | "quantity";

export type HabitIntent =
  | { kind: "log"; habit_id: string; status: HabitStatusWord; quantity?: number; day: "today" | "yesterday" }
  | { kind: "status" }
  | { kind: "undo" }
  | { kind: "ask"; status: HabitStatusWord; candidates: string[]; day: "today" | "yesterday" };

export type InterpretContext = {
  habits: HabitLite[];
  /** Hábitos de modelo diário previstos hoje e ainda sem registro. */
  dueUnlogged: string[];
  /** Entre os acima, os que já passaram do horário do gatilho (ou não têm horário). */
  dueNow: string[];
  /** Há um registro feito pelo WhatsApp nos últimos 15 minutos (desfazível)? */
  recentWhatsappLog: boolean;
};

export const norm = (s: unknown): string =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

const FINANCE_RX = /(r\$|\breais?\b|\bgastei\b|\bpaguei\b|\bcomprei\b|\brecebi\b|\btransferi\b|\bpix\b|\bfatura\b|\bsaldo\b|\bparcela\b|\bcartao\b|\bboleto\b|\bconta\b)/;
const STATUS_RX = /\b(meus habitos|como (estao|esta|ficaram) (meus |os )?habitos|o que falta (hoje|de habito|fazer)|falta (algum )?habito|habitos (de hoje|do dia|pendentes)|resumo dos habitos|quais habitos)\b/;
const UNDO_RX = /^(desfaz|desfazer|desfaca|foi engano|errei|cancela isso|anula)\b/;
const SKIP_RX = /\b(hoje nao|nao rolou|nao deu|nao fiz|nao consegui|nao vou conseguir|pulei|deixei passar)\b/;
const REST_RX = /\b(folga|tirei folga|tirar folga)\b/;
const MINIMUM_RX = /\b(so o minimo|versao minima|fiz o minimo|so o basico|so um pouco|so um pouquinho)\b|^minimo$/;
const DONE_RX = /\b(feito|feita|fiz|ja fiz|fiz sim|terminei|conclui|concluido|completei|cumpri|bati a meta)\b/;
const NEGATIVE_RX = /\b(mal|nada|pouco|pouca|quase|tentei|tentando|pessimo|ruim)\b/;
const FILLER = new Set(["ja", "sim", "ok", "pronto", "entao", "a", "o", "ai", "foi", "hoje", "agora", "acabei", "de", "fazer", "e", "ta", "tá", "beleza", "obrigado", "valeu"]);
const STOP_TOKENS = new Set(["minutos", "minuto", "min", "para", "antes", "depois", "durante", "todo", "todos", "dia", "dias", "pelo", "pela", "uma", "umas", "uns", "com", "por", "das", "dos", "meu", "minha"]);

// Formas de primeira pessoa do passado que não seguem a regra regular (infinitivo -> -ei / -i).
const IRREGULAR_PAST: Record<string, string[]> = { ler: ["li"], beber: ["bebi"], dormir: ["dormi"], fazer: ["fiz"], comer: ["comi"], correr: ["corri"], estudar: ["estudei"], alongar: ["aloguei", "alonguei"] };
const IRREGULAR_PAST_KEYS = Object.keys(IRREGULAR_PAST);

const tokens = (title: string): string[] => norm(title).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);

/** Formas verbais no passado (1ª pessoa) derivadas do infinitivo dos tokens do título. */
export function pastForms(title: string): string[] {
  const out = new Set<string>();
  for (const t of tokens(title)) {
    if (IRREGULAR_PAST_KEYS.includes(t)) IRREGULAR_PAST[t].forEach((f) => out.add(f));
    if (t.length >= 5 && /ar$/.test(t)) out.add(t.slice(0, -2) + "ei");
    else if (t.length >= 5 && /(er|ir)$/.test(t)) out.add(t.slice(0, -2) + "i");
  }
  return [...out];
}

/** Radicais de substantivos/verbos do título (4+ letras), para casar "meditar" com "meditação". */
export function titleStems(title: string): string[] {
  return tokens(title)
    .filter((t) => t.length >= 4 && !STOP_TOKENS.has(t) && !/^\d+$/.test(t))
    .map((t) => t.slice(0, Math.max(4, t.length - 2)));
}

const hasWord = (text: string, form: string) => new RegExp(`(^|\\W)${form}(\\W|$)`).test(text);
const hasStem = (text: string, stem: string) => new RegExp(`(^|\\W)${stem}`).test(text);

function parseNumber(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function cueFrom(text: string): HabitStatusWord | null {
  if (SKIP_RX.test(text)) return "skipped";
  if (REST_RX.test(text)) return "rest";
  if (MINIMUM_RX.test(text)) return "minimum";
  if (DONE_RX.test(text)) return "done";
  return null;
}

/** A mensagem é só o gatilho de ação ("feito", "já fiz", "hoje não")? Qualquer outra palavra de conteúdo desqualifica. */
function isBareCue(text: string): boolean {
  const rest = text
    .replace(SKIP_RX, " ").replace(REST_RX, " ").replace(MINIMUM_RX, " ").replace(DONE_RX, " ")
    .replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean)
    .filter((w) => !FILLER.has(w));
  return rest.length === 0;
}

/**
 * Entende a mensagem ou devolve null. Regras de segurança:
 *  - frases longas, perguntas (exceto o resumo dos hábitos) e qualquer assunto de dinheiro ficam com o agente;
 *  - só vira registro quando há um hábito inequívoco (nome, forma verbal, ou o único hábito pendente);
 *  - empate entre hábitos vira pergunta, nunca palpite.
 */
export function interpretHabitMessage(raw: string, ctx: InterpretContext): HabitIntent | null {
  const text = norm(raw);
  if (!text || text.length > 140 || ctx.habits.length === 0) return null;
  if (STATUS_RX.test(text)) return { kind: "status" };
  if (UNDO_RX.test(text)) return ctx.recentWhatsappLog ? { kind: "undo" } : null;
  if (text.includes("?") || FINANCE_RX.test(text)) return null;

  const day: "today" | "yesterday" = /\bontem\b/.test(text) ? "yesterday" : "today";
  const cue = cueFrom(text);

  // 1) Casamento com os hábitos pelo nome.
  const scored = ctx.habits.map((h) => {
    const verbHit = pastForms(h.title).some((f) => hasWord(text, f));
    const stemHits = titleStems(h.title).filter((s) => hasStem(text, s)).length;
    return { h, verbHit, stemHits, score: (verbHit ? 2 : 0) + stemHits };
  }).filter((x) => x.score > 0);

  if (scored.length > 0) {
    const top = Math.max(...scored.map((x) => x.score));
    const best = scored.filter((x) => x.score === top);
    // Sem palavra de ação, só vale a forma verbal no passado ("treinei"). Substantivo solto ("água") não registra.
    const status: HabitStatusWord | null = cue ?? (best.some((x) => x.verbHit) ? "done" : null);
    if (!status) return null;
    // "dormi mal", "li pouco": a forma verbal sozinha não basta quando há palavra que nega ou relativiza.
    if (!cue && NEGATIVE_RX.test(text)) return null;
    if (best.length > 1) return { kind: "ask", status, candidates: best.map((x) => x.h.id), day };
    const h = best[0].h;
    if (h.kind === "do_quantity" && (status === "done" || status === "quantity")) {
      const q = parseNumber(text);
      if (q != null && q >= 0 && q <= 100000) return { kind: "log", habit_id: h.id, status: "quantity", quantity: q, day };
    }
    return { kind: "log", habit_id: h.id, status: status === "quantity" ? "done" : status, day };
  }

  // 2) Sem nome de hábito: só um gatilho curto e isolado ("feito", "hoje não") se aplica ao hábito pendente.
  if (!cue || !isBareCue(text)) return null;
  const pool = ctx.dueNow.length > 0 ? ctx.dueNow : ctx.dueUnlogged;
  if (pool.length === 1) return { kind: "log", habit_id: pool[0], status: cue, day };
  if (pool.length > 1) return { kind: "ask", status: cue, candidates: pool, day };
  return null;
}
