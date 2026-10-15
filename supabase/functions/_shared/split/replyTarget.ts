// split_reply_target.v1 — de que a pessoa está falando quando responde no WhatsApp?
//
// Quem recebe cobrança de rolê pode ser, ao mesmo tempo, usuário do Nino. Antes, o fato de ter conta
// fazia a resposta à cobrança cair no agente comum (sem saber da cobrança) e o comprovante ir para o Assessor.
// Aqui a decisão é determinística e conservadora:
//   • resposta citando uma cobrança, ou comprovante/relato logo depois de uma cobrança → pipeline do rolê;
//   • mensagem curta e ambígua ("chega", "para") com mais de um assunto aberto → PERGUNTA, nunca adivinha;
//   • caso contrário, segue o fluxo normal.
import { detectParticipantIntent } from "./participantPipeline.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const norm = (t: string) => t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

export type RecentOutbound = { kind: string; created_at: string; context_type?: string | null };

export type SplitReplyDecision =
  | { action: "participant_pipeline"; reason: string; text?: string }
  | { action: "clarify"; reason: string; reply: string }
  | { action: "pass"; reason: string };

const SPLIT_KIND = /^split_(overdue|due_today|due_soon|reminder|invite|support)$|^split_clarification$/;
const AMBIGUOUS_STOP = /^(chega|chega ai|chega de (msg|mensagem|mensagens)|para|pare|parou|basta|ja deu|cansei|ta bom|ok|beleza|blz|valeu)\W*$/;
const HOURS = 3_600_000;

export function isSplitKind(kind: string | null | undefined): boolean {
  return SPLIT_KIND.test(String(kind ?? ""));
}

export function splitClarifyOptionsText(firstName: string, title: string, amount: number): string {
  return `Oi, ${firstName}! Sobre a divisão “${title}” (sua parte: ${BRL.format(amount)}), não quero entender errado. Você quer dizer que:\n\n1️⃣ já paguei (me manda o comprovante)\n2️⃣ não quero mais receber esses lembretes\n3️⃣ o valor está errado\n\nÉ só responder com o número ou me contar.`;
}

export function topicClarifyText(firstName: string, title: string): string {
  return `Oi, ${firstName}! Só para eu não errar: você está falando da cobrança “${title}” ou da outra mensagem que te mandei (como você está se sentindo)?`;
}

export function decideSplitReply(args: {
  text: string;
  hasMedia: boolean;
  quotedKind: string | null;
  recent: RecentOutbound[];
  now?: Date;
  firstName: string;
  title: string;
  amount: number;
}): SplitReplyDecision {
  const now = (args.now ?? new Date()).getTime();
  const age = (r: RecentOutbound) => now - new Date(r.created_at).getTime();
  const strong = isSplitKind(args.quotedKind);
  const recentSplit = args.recent.filter((r) => isSplitKind(r.kind) && age(r) <= 24 * HOURS);
  const clarification = args.recent.find((r) => r.kind === "split_clarification" && age(r) <= 6 * HOURS);
  const text = norm(args.text ?? "");

  // Resposta à pergunta de esclarecimento: 1 / 2 / 3.
  if (clarification && /^[123]\W*$/.test(text)) {
    const map: Record<string, string> = { "1": "já paguei", "2": "para de mandar", "3": "quanto devo" };
    return { action: "participant_pipeline", reason: "clarification_answer", text: map[text.charAt(0)] };
  }

  if (!strong && recentSplit.length === 0) return { action: "pass", reason: "no_split_context" };

  if (args.hasMedia) return { action: "participant_pipeline", reason: strong ? "receipt_quoted_split" : "receipt_after_split_reminder" };

  const intent = detectParticipantIntent(args.text ?? "", false);
  if (intent !== "other") return { action: "participant_pipeline", reason: `intent_${intent}` };

  if (AMBIGUOUS_STOP.test(text) && text.length <= 24) {
    if (strong) return { action: "clarify", reason: "ambiguous_stop_on_split", reply: splitClarifyOptionsText(args.firstName, args.title, args.amount) };
    const competing = args.recent.some((r) => !isSplitKind(r.kind) && ["proactive", "agent", "due_reminder"].includes(r.kind) && age(r) <= 3 * HOURS);
    if (competing) return { action: "clarify", reason: "ambiguous_between_topics", reply: topicClarifyText(args.firstName, args.title) };
  }
  return { action: "pass", reason: strong ? "quoted_split_free_text" : "recent_split_free_text" };
}
