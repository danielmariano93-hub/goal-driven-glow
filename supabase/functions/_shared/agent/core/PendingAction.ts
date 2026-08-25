// PendingAction (`nino_context.v1`) — o Nino termina o que ele começou.
//
// Causa raiz que este módulo fecha: depois de um recibo de lançamento sem
// categoria, a próxima mensagem curta do usuário ("Beleza") era lida como
// acknowledgement (ou pior, como assunto novo) e o Nino respondia
// "não encontrei nada pendente". O lançamento ficava sem categoria.
//
// Regras:
//  - workflow de curta duração (45 min), NUNCA memória permanente;
//  - resolução 100% determinística (zero chamadas de modelo);
//  - a escrita passa pelo caminho canônico (rascunho de edição + confirmação),
//    que já grava auditoria e aprende a categoria do estabelecimento.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { draft_transaction_update, confirm_pending_action, type ToolContext } from "../tools.ts";

/** Janela em que um lançamento recém-criado ainda é "o assunto atual". */
export const PENDING_ACTION_TTL_MS = 45 * 60 * 1000;

export type CategoryAnswer = {
  name: string;
  /** O usuário pediu explicitamente a criação/atribuição (não é resposta seca). */
  explicit: boolean;
  /** Pediu para criar a categoria ("cria a categoria beleza"). */
  create: boolean;
};

/** Palavras que nunca são nome de categoria. */
const NOT_A_CATEGORY = new Set([
  "sim", "nao", "não", "ok", "okay", "certo", "confirma", "confirmar", "confirmado",
  "cancela", "cancelar", "cancelado", "obrigado", "obrigada", "valeu", "vlw",
  "bom", "boa", "oi", "ola", "olá", "tchau", "isso", "exato", "perfeito",
  "pode", "pronto", "top", "show", "legal", "entendi", "certeza", "nada",
]);

/**
 * Tokens que revelam FRASE (relato, pedido, conversa) em vez de nome de
 * categoria. Se qualquer palavra da resposta seca cair aqui, a mensagem volta
 * para o roteamento normal do Nino.
 */
const SENTENCE_TOKENS = new Set([
  "eu", "me", "meu", "minha", "mim", "voce", "vc", "nino",
  "estou", "esto", "to", "ta", "tou", "sinto", "sinta", "fiquei", "fico", "sou", "era", "foi",
  "quero", "queria", "preciso", "podia", "vamos", "vou", "acho", "sei", "tenho", "tive",
  "hoje", "ontem", "amanha", "agora", "depois", "ainda", "muito", "pouco", "mais", "menos",
  "gastei", "paguei", "comprei", "recebi", "registra", "registre", "registrar", "anota", "anote",
  "mostra", "mostre", "quanto", "quando", "porque", "como", "qual", "por",
  "ajuda", "ajude", "explica", "explique", "esqueci", "tudo", "bem", "mal",
]);

/** Estados emocionais: assunto do registro de emoção, nunca categoria. */
const EMOTION_TOKENS = new Set([
  "triste", "tristeza", "feliz", "felicidade", "ansioso", "ansiosa", "ansiedade",
  "preocupado", "preocupada", "preocupacao", "cansado", "cansada", "cansaco",
  "irritado", "irritada", "raiva", "calmo", "calma", "tranquilo", "tranquila",
  "animado", "animada", "culpado", "culpada", "culpa", "estressado", "estressada",
  "medo", "aliviado", "aliviada", "orgulhoso", "orgulhosa", "frustrado", "frustrada",
  "empolgado", "empolgada", "desanimado", "desanimada", "sozinho", "sozinha",
]);



const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function normalizeCategoryName(raw: string): string {
  return stripAccents(String(raw ?? "").toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
}

export function categorySlug(name: string): string {
  const base = normalizeCategoryName(name).replace(/\s+/g, "-");
  return base || "categoria";
}

/** Nome apresentável: "beleza" → "Beleza". */
export function titleizeCategory(raw: string): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
}

const ASSIGN_RX =
  /^(?:nino[,\s]+)?(?:pode\s+)?(?:coloca(?:r)?|coloque|p[oõ]e|ponha|joga|jogue|muda(?:r)?|mude|troca(?:r)?|categoriza(?:r)?|categorize|classifica(?:r)?|classifique|marca(?:r)?|marque)\s+(?:isso|esse|essa|este|esta|ele|ela|o\s+lan[çc]amento|a\s+despesa|o\s+gasto)?\s*(?:como|em|na|no|para|pra|categoria)\s+(?:a\s+|o\s+)?(?:categoria\s+)?["“']?([\p{L}][\p{L}\s&/-]{1,40})["”']?\s*[.!]?$/iu;

const CREATE_RX =
  /^(?:nino[,\s]+)?(?:pode\s+)?(?:cria(?:r)?|crie|adiciona(?:r)?|adicione|cadastra(?:r)?|cadastre)\s+(?:a\s+|uma\s+|o\s+)?categoria\s+["“']?([\p{L}][\p{L}\s&/-]{1,40}?)["”']?(?:\s+e\s+.{0,60})?\s*[.!]?$/iu;


/**
 * Lê a mensagem como resposta de categoria.
 * `hasPendingEntry` = existe lançamento recente sem categoria: só nesse caso
 * uma resposta SECA ("Beleza") pode ser lida como nome de categoria.
 */
export function readCategoryAnswer(
  text: string,
  hasPendingEntry: boolean,
): CategoryAnswer | null {
  const t = String(text ?? "").trim();
  if (!t) return null;

  const create = CREATE_RX.exec(t);
  if (create) {
    const name = create[1].trim();
    if (!name) return null;
    return { name, explicit: true, create: true };
  }

  const assign = ASSIGN_RX.exec(t);
  if (assign) {
    const name = assign[1].trim();
    if (!name || NOT_A_CATEGORY.has(normalizeCategoryName(name))) return null;
    return { name, explicit: true, create: false };
  }

  if (!hasPendingEntry) return null;
  // Resposta seca: 1–3 palavras, sem número, sem valor, sem pergunta.
  if (/[?\d]|R\$/i.test(t)) return null;
  const words = t.replace(/[.!,;:]+$/g, "").split(/\s+/);
  if (words.length > 3) return null;
  const norm = normalizeCategoryName(t);
  if (!norm || NOT_A_CATEGORY.has(norm)) return null;
  // Frase (mesmo curta) NÃO é nome de categoria: "estou triste hoje",
  // "me sinto mal", "tô cansado" são relato emocional/conversa, não slot.
  if (norm.split(" ").some((w) => SENTENCE_TOKENS.has(w) || EMOTION_TOKENS.has(w))) return null;
  if (norm.split(" ").some((w) => NOT_A_CATEGORY.has(w) && words.length === 1)) return null;
  return { name: words.join(" "), explicit: false, create: false };
}


export type PendingEntry = {
  transaction_id: string;
  type: "income" | "expense";
  amount: number;
  description: string | null;
  occurred_at: string;
};

/**
 * Lançamento recém-criado e ainda sem categoria. Derivado do ledger — não há
 * estado paralelo para dessincronizar.
 */
export async function findRecentUncategorized(
  sb: SupabaseClient,
  user_id: string,
  opts: { withinMs?: number; amountHint?: number | null } = {},
): Promise<PendingEntry | null> {
  const since = new Date(Date.now() - (opts.withinMs ?? PENDING_ACTION_TTL_MS)).toISOString();
  let q = sb.from("transactions")
    .select("id,type,amount,description,occurred_at,created_at,category_id,status")
    .eq("user_id", user_id)
    .eq("status", "confirmed")
    .in("type", ["income", "expense"])
    .is("category_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  if (opts.amountHint && opts.amountHint > 0) q = q.eq("amount", opts.amountHint);
  const { data, error } = await q;
  if (error || !data?.length) return null;
  const row = data[0] as any;
  return {
    transaction_id: String(row.id),
    type: row.type === "income" ? "income" : "expense",
    amount: Number(row.amount ?? 0),
    description: row.description ?? null,
    occurred_at: String(row.occurred_at ?? ""),
  };
}

/** Categoria já existente do usuário (ou global), comparando sem acento/caixa. */
export async function findCategoryByName(
  sb: SupabaseClient,
  user_id: string,
  name: string,
  type: "income" | "expense",
): Promise<{ id: string; name: string } | null> {
  const target = normalizeCategoryName(name);
  if (!target) return null;
  const { data } = await sb.from("categories")
    .select("id,name,user_id,type")
    .or(`user_id.eq.${user_id},user_id.is.null`)
    .is("archived_at", null)
    .eq("type", type);
  const rows = (data ?? []) as Array<{ id: string; name: string; user_id: string | null }>;
  const exact = rows.find((r) => normalizeCategoryName(r.name) === target);
  if (exact) return { id: exact.id, name: exact.name };
  const partial = rows.find((r) => normalizeCategoryName(r.name).startsWith(target) && target.length >= 4);
  return partial ? { id: partial.id, name: partial.name } : null;
}

/** Cria a categoria do usuário (taxonomia própria, nunca ledger). */
export async function createUserCategory(
  sb: SupabaseClient,
  user_id: string,
  name: string,
  type: "income" | "expense",
): Promise<{ id: string; name: string } | null> {
  const label = titleizeCategory(name);
  const { data, error } = await sb.from("categories")
    .insert({ user_id, name: label, slug: categorySlug(label), type })
    .select("id,name").maybeSingle();
  if (error || !data) {
    // Corrida com slug duplicado: relê.
    return await findCategoryByName(sb, user_id, name, type);
  }
  return { id: String((data as any).id), name: String((data as any).name) };
}

export type AssignOutcome = {
  handled: boolean;
  reply: string;
  reply_kind: "receipt" | "question" | "info";
  transaction_id?: string;
  category_id?: string;
};

/**
 * Atribui a categoria ao lançamento pendente pelo caminho canônico
 * (rascunho de edição + confirmação, com auditoria e aprendizado por
 * estabelecimento). Zero chamadas de modelo.
 */
export async function assignCategoryToEntry(
  sb: SupabaseClient,
  args: {
    user_id: string;
    conversation_id: string;
    entry: PendingEntry;
    answer: CategoryAnswer;
    user_text: string;
  },
): Promise<AssignOutcome> {
  const { user_id, conversation_id, entry, answer } = args;
  const existing = await findCategoryByName(sb, user_id, answer.name, entry.type);

  let category = existing;
  if (!category) {
    if (!answer.explicit) {
      return {
        handled: true,
        reply: `Ainda não tenho a categoria “${titleizeCategory(answer.name)}”. Quer que eu crie e coloque esse lançamento nela? Se sim, me diga “cria a categoria ${titleizeCategory(answer.name)}”.`,
        reply_kind: "question",
      };
    }
    category = await createUserCategory(sb, user_id, answer.name, entry.type);
  }
  if (!category) {
    return {
      handled: true,
      reply: "Não consegui organizar essa categoria agora. Pode tentar de novo em instantes?",
      reply_kind: "info",
    };
  }

  const ctx: ToolContext = { sb, user_id, conversation_id, user_text: args.user_text };
  const draft = await draft_transaction_update(ctx, {
    transaction_id: entry.transaction_id,
    patch: { category: category.id },
    scope: "one",
  });
  if (!draft.ok) {
    return {
      handled: true,
      reply: "Não consegui alterar a categoria desse lançamento agora. Pode tentar de novo em instantes?",
      reply_kind: "info",
    };
  }
  const draftId = String((draft as any).result?.draft_id ?? "");
  const confirmed = await confirm_pending_action(ctx, { id: draftId });
  if (!confirmed.ok) {
    return {
      handled: true,
      reply: "Preparei a mudança de categoria, mas não consegui concluir. Pode tentar de novo?",
      reply_kind: "info",
    };
  }

  // Prova de escrita: sem leitura confirmando, não existe recibo de sucesso.
  const { data: proof } = await sb.from("transactions")
    .select("category_id").eq("id", entry.transaction_id).eq("user_id", user_id).maybeSingle();
  if (String((proof as any)?.category_id ?? "") !== category.id) {
    return {
      handled: true,
      reply: "Tentei salvar a categoria, mas não consegui confirmar a gravação. Nada foi alterado — quer tentar de novo?",
      reply_kind: "info",
    };
  }

  const what = entry.description ? `“${entry.description}”` : "esse lançamento";
  return {
    handled: true,
    reply: `Pronto, ${what} agora está em ${category.name}. ✅`,
    reply_kind: "receipt",
    transaction_id: entry.transaction_id,
    category_id: category.id,
  };
}
