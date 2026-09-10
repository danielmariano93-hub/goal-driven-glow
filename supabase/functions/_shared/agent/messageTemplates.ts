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
  invite: "👋 *{{title}} — sua parte*\n\n{{owner_name}} incluiu você na divisão “{{title}}”{{split_context_sentence}}. Sua parte é *{{participant_total}}*{{installments_sentence}}.{{first_due_sentence}}{{installment_schedule_block}}{{pix_sentence}}{{link_sentence}}",
  reminder: "💸 *{{title}} — sua parte*\n\nOi, {{participant_name}}! Sobre a divisão “{{title}}” com {{owner_name}}: a *{{installment_label}}*, no valor de *{{amount}}*, está em aberto.{{due_sentence}}{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  due_soon: "💸 *{{title}} — vence amanhã*\n\nOi, {{participant_name}}! Na divisão “{{title}}” com {{owner_name}}, a *{{installment_label}}*, no valor de *{{amount}}*, vence em *{{due_date}}*.{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  due_today: "💸 *{{title}} — vence hoje*\n\nOi, {{participant_name}}! Na divisão “{{title}}” com {{owner_name}}, a *{{installment_label}}*, no valor de *{{amount}}*, vence hoje, *{{due_date}}*.{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  overdue: "⚠️ *{{title}} — parcela em atraso*\n\nOi, {{participant_name}}! Na divisão “{{title}}” com {{owner_name}}, a *{{installment_label}}*, no valor de *{{amount}}*, com vencimento em *{{due_date}}*, ainda consta como pendente.{{partial_sentence}}{{remaining_sentence}}{{pix_sentence}}{{link_sentence}}",
  payment_confirmation: "✅ *Pagamento registrado*\n\nRecebemos a sua *{{installment_label}}* em “{{title}}”, {{participant_name}}.{{remaining_sentence}}",
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

export function renderMessageTemplate(
  kind: string,
  persona: MessagePersona | null | undefined,
  values: Record<string, string>,
): string {
  const raw = pickTemplate(kind, persona);
  let rendered = raw.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
  rendered = rendered.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
  const signature = persona?.signature?.trim();
  const name = persona?.name?.trim();
  if (signature) rendered += `\n\n${signature}`;
  else if (name) rendered += `\n\n— ${name}`;
  return rendered.slice(0, 1800);
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


