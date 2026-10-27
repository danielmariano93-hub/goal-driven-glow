export type MessagePersona = {
  name?: string | null;
  tone?: string;
  formality?: string;
  emoji_style?: string;
  address_style?: string;
  signature?: string | null;
  templates?: Record<string, string>;
  // Novo contrato administrável por contexto (tem precedência sobre templates).
  contexts?: Record<string, { template?: string; tone_override?: string | null }>;
};

// Mensagens da Divisão do Rolê usam markdown nativo do WhatsApp (*negrito*),
// falam SEMPRE de uma parcela específica e trazem o saldo real — nunca o valor
// cheio quando já houve pagamento parcial.
const DEFAULTS: Record<string, string> = {
  invite: "👋 *{{title}} — sua parte*\n\n{{owner_name}} incluiu você na divisão “{{title}}”. Sua parte é *{{participant_total}}*{{installments_sentence}}.{{first_due_sentence}}{{installment_schedule_block}}{{pix_sentence}}{{link_sentence}}",
  reminder: "💸 *{{title}} — sua parte*\n\nOi, {{participant_name}}! Sobre a divisão “{{title}}” com {{owner_name}}: a *{{installment_label}}*, no valor de *{{amount}}*, está em aberto.{{due_sentence}}{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  due_soon: "💸 *{{title}} — vence amanhã*\n\nOi, {{participant_name}}! Na divisão “{{title}}” com {{owner_name}}, a *{{installment_label}}*, no valor de *{{amount}}*, vence em *{{due_date}}*.{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  due_today: "💸 *{{title}} — vence hoje*\n\nOi, {{participant_name}}! Na divisão “{{title}}” com {{owner_name}}, a *{{installment_label}}*, no valor de *{{amount}}*, vence hoje, *{{due_date}}*.{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  overdue: "💸 *{{title}} — um lembrete amigo*\n\nOi, {{participant_name}}! Passando pra lembrar que a *{{installment_label}}* da divisão “{{title}}” com {{owner_name}}, de *{{amount}}*, venceu em *{{due_date}}* e está em aberto há *{{days_phrase}}*.{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}\n\nSe já pagou, é só me responder por aqui que eu confiro 😉",
  payment_confirmation: "✅ *Pagamento recebido!*\n\nOi, {{participant_name}}! {{confirmation_headline}}{{confirmation_schedule_block}}{{confirmation_closing}}",
  completed: "🎉 *Rolê fechado*\n\nTodo mundo acertou a divisão “{{title}}”. Obrigado!",
  goal_invite: "Oi, {{participant_name}}! 👋 {{owner_name}} convidou você para a meta conjunta “{{title}}” (objetivo: {{amount}}).{{link_sentence}} Bora juntos?",
  goal_invite_followup: "Oi, {{participant_name}}! Só passando pra lembrar do convite da meta “{{title}}” com {{owner_name}}.{{link_sentence}} Se não quiser participar, é só ignorar 💛",
  owner_digest: "Oi! Sobre o rolê “{{title}}”: {{pending_count}} {{pending_word}} ainda em aberto, somando {{amount}}.\n{{pending_list}}{{link_sentence}}",

};


// Mapeia o kind curto para as chaves de contexts.* administráveis.
const CONTEXT_KEYS: Record<string, string> = {
  invite: "split_invite",
  reminder: "split_reminder",
  due_soon: "split_due_soon",
  due_today: "split_due_today",
  overdue: "split_overdue",
  payment_confirmation: "split_payment_confirmation",
  completed: "split_completed",
  goal_invite: "goal_invite",
  goal_invite_followup: "goal_invite_followup",
  owner_digest: "split_owner_digest",

};


function pickTemplate(kind: string, persona: MessagePersona | null | undefined): string {
  const contextKey = CONTEXT_KEYS[kind] ?? kind;
  const fromContexts = persona?.contexts?.[contextKey]?.template?.trim();
  if (fromContexts) return fromContexts;
  const fromTemplates = persona?.templates?.[kind]?.trim();
  if (fromTemplates) return fromTemplates;
  return DEFAULTS[kind] || DEFAULTS.reminder;
}

function renderRaw(raw: string, persona: MessagePersona | null | undefined, values: Record<string, string>): string {
  let rendered = raw.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
  rendered = rendered.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
  const signature = persona?.signature?.trim();
  const name = persona?.name?.trim();
  if (signature) rendered += `\n\n${signature}`;
  else if (name) rendered += `\n\n— ${name}`;
  return rendered.slice(0, 1800);
}

export function renderMessageTemplate(
  kind: string,
  persona: MessagePersona | null | undefined,
  values: Record<string, string>,
): string {
  return renderRaw(pickTemplate(kind, persona), persona, values);
}

// ---------------------------------------------------------------------------
// Cobrança em atraso (split_overdue_copy.v1)
//
// Regras de produto:
//  - Sempre cordial e amigável: ninguém perde amigo por cobrança. Sem pressão, culpa, ameaça ou
//    "inadimplente"; sempre uma saída fácil (responder, combinar nova data com quem criou o rolê).
//  - TODA mensagem depois do vencimento diz há quantos dias a parcela está em atraso.
//  - Atraso de até `LATE_AFTER_DAYS` dias: uma mensagem por dia. Acima disso: até duas por dia
//    (1ª e 2ª do dia), e a 2ª nunca repete o conteúdo da 1ª.
//  - Os textos giram por dia de atraso, então dois dias seguidos também não saem iguais.
// Se o administrador definir um texto próprio para `split_overdue`, ele tem precedência.
// ---------------------------------------------------------------------------
export const OVERDUE_COPY_VERSION = "split_overdue_copy.v1";
/** Acima deste atraso (em dias) a cobrança passa a poder sair duas vezes no mesmo dia. */
export const LATE_AFTER_DAYS = 2;

const PIECES = "{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}";

/** Atraso recente (1–2 dias): uma mensagem por dia, tom de lembrete leve. */
const OVERDUE_RECENT: Array<{ id: string; text: string }> = [
  {
    id: "recent_1",
    text: `💸 *{{title}} — um lembrete amigo*\n\n{{greeting}}, {{participant_name}}! Passando pra lembrar que a *{{installment_label}}* da divisão “{{title}}” com {{owner_name}}, de *{{amount}}*, venceu em *{{due_date}}* e está em aberto há *{{days_phrase}}*.${PIECES}\n\nSe já pagou, é só me responder por aqui que eu confiro 😉`,
  },
  {
    id: "recent_2",
    text: `👋 *{{title}} — sua parte*\n\n{{greeting}}, {{participant_name}}! Tudo certo? A *{{installment_label}}* de “{{title}}” (*{{amount}}*) venceu em *{{due_date}}* e está com *{{days_phrase}}* de atraso. Acontece com todo mundo!${PIECES}\n\nQuando puder, dá uma olhadinha. Se precisar de mais um tempo, me conta que a gente combina 💛`,
  },
];

/** 1ª mensagem do dia quando o atraso já passou de 2 dias: firme, mas leve. */
const OVERDUE_FIRST_OF_DAY: Array<{ id: string; text: string }> = [
  {
    id: "first_1",
    text: `⏰ *{{title}} — {{days_phrase}} de atraso*\n\n{{greeting}}, {{participant_name}}! A *{{installment_label}}* de “{{title}}” com {{owner_name}} (*{{amount}}*) venceu em *{{due_date}}* e segue em aberto há *{{days_phrase}}*.${PIECES}\n\nSe já resolveu, me avisa por aqui que eu atualizo 🙌`,
  },
  {
    id: "first_2",
    text: `💸 *{{title}} — sua parte*\n\n{{greeting}}, {{participant_name}}! Só passando pra lembrar da *{{installment_label}}* de “{{title}}”: *{{amount}}*, vencida em *{{due_date}}* (em atraso há *{{days_phrase}}*).${PIECES}\n\nSe algo atrapalhou, me conta que a gente acha um jeito 💛`,
  },
  {
    id: "first_3",
    text: `👋 *{{title}} — um lembrete rápido*\n\n{{greeting}}, {{participant_name}}, tudo bem? A parcela de *{{amount}}* de “{{title}}” está em aberto há *{{days_phrase}}* (venceu em *{{due_date}}*).${PIECES}\n\nQualquer dúvida sobre o valor, é só chamar!`,
  },
  {
    id: "first_4",
    text: `🙂 *{{title}} — pendência de {{days_phrase}}*\n\n{{greeting}}, {{participant_name}}! Lembrando da *{{installment_label}}* de “{{title}}” com {{owner_name}}: *{{amount}}*, que venceu em *{{due_date}}* (há *{{days_phrase}}*).${PIECES}\n\nSe já pagou e eu ainda não vi, me manda um “paguei” (ou o comprovante) por aqui 😉`,
  },
];

/** 2ª mensagem do dia: reconhece que já houve uma hoje, mais curta e diferente da 1ª. */
const OVERDUE_SECOND_OF_DAY: Array<{ id: string; text: string }> = [
  {
    id: "second_1",
    text: `🌙 *{{title}} — de novo por aqui*\n\n{{participant_name}}, voltei rapidinho! 😅 A *{{installment_label}}* de “{{title}}” (*{{amount}}*) continua em aberto — são *{{days_phrase}}* de atraso.${PIECES}\n\nSe preferir, combine uma nova data direto com {{owner_name}}. O importante é não ficar pendente 💛`,
  },
  {
    id: "second_2",
    text: `🙏 *{{title}} — último lembrete de hoje*\n\n{{participant_name}}, prometo que é o último de hoje! A *{{installment_label}}* (*{{amount}}*), vencida em *{{due_date}}*, completa *{{days_phrase}}* em aberto.${PIECES}\n\nObrigado por resolver — e se rolou algum imprevisto, me conta 😉`,
  },
  {
    id: "second_3",
    text: `💬 *{{title}} — fechando o dia*\n\n{{participant_name}}, quando der, vale resolver a *{{installment_label}}* de “{{title}}”: *{{amount}}*, em atraso há *{{days_phrase}}*.${PIECES}\n\nSe já pagou, é só me responder aqui que eu confiro 🙌`,
  },
  {
    id: "second_4",
    text: `🤝 *{{title}} — sem estresse*\n\nOi de novo, {{participant_name}}! Sei que o dia corre, mas a *{{installment_label}}* de “{{title}}” (*{{amount}}*) ainda está pendente, com *{{days_phrase}}* de atraso.${PIECES}\n\nSe precisar ajustar a data, fala com {{owner_name}} ou comigo. A gente resolve 💛`,
  },
];

export function daysPhrase(days: number): string {
  const n = Math.max(1, Math.floor(days));
  return n === 1 ? "1 dia" : `${n} dias`;
}

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Escolhe o texto da cobrança em atraso.
 * @param daysOverdue dias corridos depois do vencimento (data civil de São Paulo)
 * @param seqToday    posição da mensagem no dia (1 = primeira, 2 = segunda)
 */
export function overdueVariantFor(daysOverdue: number, seqToday: number): { id: string; text: string } {
  const d = Math.max(1, Math.floor(daysOverdue));
  const pool = d <= LATE_AFTER_DAYS ? OVERDUE_RECENT : seqToday >= 2 ? OVERDUE_SECOND_OF_DAY : OVERDUE_FIRST_OF_DAY;
  return pool[d % pool.length];
}

export const OVERDUE_VARIANT_IDS = [...OVERDUE_RECENT, ...OVERDUE_FIRST_OF_DAY, ...OVERDUE_SECOND_OF_DAY].map((v) => v.id);
export const OVERDUE_VARIANT_TEXTS = [...OVERDUE_RECENT, ...OVERDUE_FIRST_OF_DAY, ...OVERDUE_SECOND_OF_DAY];

export function renderOverdueMessage(
  persona: MessagePersona | null | undefined,
  values: Record<string, string>,
  opts: { daysOverdue: number; seqToday: number; sendHour: number },
): { text: string; variant: string } {
  const merged = {
    ...values,
    days_phrase: daysPhrase(opts.daysOverdue),
    greeting: greetingForHour(opts.sendHour),
  };
  const custom = persona?.contexts?.split_overdue?.template?.trim() || persona?.templates?.overdue?.trim();
  if (custom) return { text: renderRaw(custom, persona, merged), variant: "custom" };
  const v = overdueVariantFor(opts.daysOverdue, opts.seqToday);
  return { text: renderRaw(v.text, persona, merged), variant: v.id };
}

export const DEFAULT_MESSAGE_TEMPLATES = DEFAULTS;

/**
 * Constrói a sentença de link para injetar em `{{link_sentence}}`.
 * - Se o destinatário está cadastrado, aponta para o deep link no app.
 * - Se é convidado (guest), aponta para a página de cadastro com atribuição.
 * - Se nenhum link válido puder ser construído, retorna string vazia.
 */
/** Exibe o link sem o prefixo de protocolo. O WhatsApp reconhece e abre
 *  `www.dominio.com/...` corretamente, e o texto fica mais limpo. */
export function formatLinkForMessage(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

export function buildLinkSentence(input: {
  isRegistered: boolean;
  appLink: string | null;
  signupLink: string | null;
}): string {
  if (input.isRegistered && input.appLink) return ` Abra no app: ${formatLinkForMessage(input.appLink)}`;
  if (!input.isRegistered && input.signupLink) return ` Cadastre-se em segundos: ${formatLinkForMessage(input.signupLink)}`;
  return "";
}


