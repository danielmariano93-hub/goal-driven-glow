// split_reply_target.v2 — de que a pessoa está falando quando escreve no WhatsApp?
//
// Quem recebe cobrança de rolê pode ser, ao mesmo tempo, usuário do Nino. A decisão tem duas camadas:
//   1) SINAIS EXPLÍCITOS (determinísticos, não são palpite): comando do próprio produto (atalho `!ja`),
//      resposta que CITA a cobrança, resposta à pergunta de esclarecimento que o Nino fez;
//   2) ENTENDIMENTO: para o resto, o Nino lê a mensagem com o contexto e diz a quem ela se dirige
//      (cobrança do rolê × finanças da própria pessoa). Dúvida real → pergunta. Falha do modelo → fluxo normal.
// Palavra-chave NUNCA decide o destino: "valor", "falta", "quanto" aparecem em registros de gasto e perguntas.
import type { AddresseeReader, AddresseeReading } from "./inboundAddressee.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const norm = (t: string) => t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

export type RecentOutbound = { kind: string; created_at: string; context_type?: string | null; body?: string | null };

const SPLIT_KIND = /^split_(overdue|due_today|due_soon|reminder|invite|support)$|^split_clarification$/;
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

/** Confiança mínima para o Nino agir como se a mensagem fosse sobre a cobrança. Abaixo disso, pergunta. */
export const SPLIT_ADDRESSEE_MIN_CONFIDENCE = 0.85;

export function ownOrSplitClarifyText(firstName: string, title: string, amount: number): string {
  return `Oi, ${firstName}! Só para eu não errar: sua mensagem é sobre a divisão “${title}” (sua parte: ${BRL.format(amount)}) ou sobre as suas finanças (por exemplo, registrar um gasto)?`;
}

export type SplitRouteEvidence = {
  route: "split" | "normal" | "clarify";
  /** Como a decisão foi tomada: sinal explícito, leitura do modelo, ou falha segura. */
  basis: "explicit_command" | "quoted_split" | "clarification_answer" | "no_split_context" | "understanding" | "understanding_unavailable";
  addressee?: AddresseeReading | null;
};

export type SplitReplyDecision =
  | { action: "participant_pipeline"; reason: string; text?: string; evidence: SplitRouteEvidence }
  | { action: "clarify"; reason: string; reply: string; evidence: SplitRouteEvidence }
  | { action: "pass"; reason: string; evidence: SplitRouteEvidence };

const ev = (route: SplitRouteEvidence["route"], basis: SplitRouteEvidence["basis"], addressee?: AddresseeReading | null): SplitRouteEvidence =>
  ({ route, basis, addressee: addressee ?? null });

export async function decideSplitReply(args: {
  text: string;
  hasMedia: boolean;
  quotedKind: string | null;
  recent: RecentOutbound[];
  now?: Date;
  firstName: string;
  title: string;
  amount: number;
  dueDate?: string | null;
  /** true quando a mensagem usa o comando explícito do produto (atalho de registro rápido). */
  explicitCommand?: boolean;
  /** Leitor de entendimento (modelo). Ausente ou com falha → segue o fluxo normal, nunca o do rolê. */
  readAddressee?: AddresseeReader;
}): Promise<SplitReplyDecision> {
  const now = (args.now ?? new Date()).getTime();
  const age = (r: RecentOutbound) => now - new Date(r.created_at).getTime();
  const strong = isSplitKind(args.quotedKind);
  const recentSplit = args.recent.filter((r) => isSplitKind(r.kind) && age(r) <= 24 * HOURS);
  const clarification = args.recent.find((r) => r.kind === "split_clarification" && age(r) <= 6 * HOURS);
  const text = norm(args.text ?? "");

  // 1) Sinais explícitos ------------------------------------------------------------------------
  // Comando do próprio produto vale mais que qualquer inferência: quem usa o atalho quer registrar.
  if (args.explicitCommand) return { action: "pass", reason: "explicit_command", evidence: ev("normal", "explicit_command") };

  // Resposta (1/2/3) à pergunta que o próprio Nino fez.
  if (clarification && /^[123]\W*$/.test(text)) {
    const map: Record<string, string> = { "1": "já paguei", "2": "para de mandar", "3": "quanto devo" };
    return { action: "participant_pipeline", reason: "clarification_answer", text: map[text.charAt(0)], evidence: ev("split", "clarification_answer") };
  }

  // A pessoa apontou para a cobrança (responder/citar a mensagem dela).
  if (strong) {
    if (args.hasMedia) return { action: "participant_pipeline", reason: "receipt_quoted_split", evidence: ev("split", "quoted_split") };
    return { action: "participant_pipeline", reason: "quoted_split", evidence: ev("split", "quoted_split") };
  }

  if (recentSplit.length === 0) return { action: "pass", reason: "no_split_context", evidence: ev("normal", "no_split_context") };

  // 2) Entendimento -----------------------------------------------------------------------------
  // Arquivo sem citar a cobrança: o conteúdo ainda não foi lido, então não há como saber de quem é.
  // Não adivinha: segue o fluxo normal (Assessor). Vira comprovante do rolê quando a pessoa CITA a cobrança.
  if (args.hasMedia) return { action: "pass", reason: "media_without_reference", evidence: ev("normal", "understanding_unavailable") };

  if (!args.readAddressee) return { action: "pass", reason: "understanding_unavailable", evidence: ev("normal", "understanding_unavailable") };

  const reading = await args.readAddressee({
    text: args.text ?? "",
    split: { title: args.title, pending_amount: args.amount, due_date: args.dueDate ?? null },
    conversation: [...args.recent]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .filter((r) => age(r) <= 24 * HOURS)
      .slice(0, 4)
      .map((r) => ({
        kind: r.kind,
        minutes_ago: Math.max(0, Math.round(age(r) / 60_000)),
        text: String(r.body ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
        about_split: isSplitKind(r.kind),
      })),
  });

  if (reading.source !== "llm") return { action: "pass", reason: "understanding_unavailable", evidence: ev("normal", "understanding_unavailable", reading) };
  if (reading.addressee === "own_finance" && reading.confidence >= 0.5) {
    return { action: "pass", reason: "own_finance", evidence: ev("normal", "understanding", reading) };
  }
  if (reading.addressee === "split_charge" && reading.confidence >= SPLIT_ADDRESSEE_MIN_CONFIDENCE) {
    return { action: "participant_pipeline", reason: "understood_split_charge", evidence: ev("split", "understanding", reading) };
  }
  return {
    action: "clarify", reason: "unclear_addressee",
    reply: ownOrSplitClarifyText(args.firstName, args.title, args.amount),
    evidence: ev("clarify", "understanding", reading),
  };
}
