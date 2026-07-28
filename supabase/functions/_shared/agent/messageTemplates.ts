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

const DEFAULTS: Record<string, string> = {
  invite: "Oi, {{participant_name}}! 👋 {{owner_name}} incluiu você na divisão “{{title}}”{{split_context_sentence}}. Sua parte ficou em {{amount}}.{{due_sentence}}{{pix_sentence}}{{link_sentence}}",
  reminder: "Oi, {{participant_name}}! Passando com um lembrete leve: ainda faltam {{amount}} da sua parte em “{{title}}”{{split_context_sentence}}.{{due_sentence}}{{pix_sentence}}{{link_sentence}} Se você já pagou, pode desconsiderar e avisar quem criou o rolê 💛",
  due_soon: "Oi, {{participant_name}}! Sua parte de {{amount}} em “{{title}}”{{split_context_sentence}} vence em breve.{{due_sentence}}{{pix_sentence}}{{link_sentence}}",
  due_today: "Oi, {{participant_name}}! Sua parte de {{amount}} em “{{title}}”{{split_context_sentence}} vence hoje.{{pix_sentence}}{{link_sentence}} Se você já pagou, avise quem criou o rolê para atualizar por lá 💛",
  overdue: "Oi, {{participant_name}}. Sua parte de {{amount}} em “{{title}}”{{split_context_sentence}} ainda aparece em aberto. Se você já pagou, avise quem criou o rolê para atualizar por lá 💛{{pix_sentence}}{{link_sentence}}",
  payment_confirmation: "Tudo certo, {{participant_name}}! Seu pagamento em “{{title}}” foi registrado. Obrigado por organizar esse rolê com a gente 🙌",
  completed: "Rolê fechado! 🎉 Todo mundo acertou a divisão “{{title}}”.",
  goal_invite: "Oi, {{participant_name}}! 👋 {{owner_name}} convidou você para a meta conjunta “{{title}}” (objetivo: {{amount}}).{{link_sentence}} Bora juntos?",
  goal_invite_followup: "Oi, {{participant_name}}! Só passando pra lembrar do convite da meta “{{title}}” com {{owner_name}}.{{link_sentence}} Se não quiser participar, é só ignorar 💛",
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
export function buildLinkSentence(input: {
  isRegistered: boolean;
  appLink: string | null;
  signupLink: string | null;
}): string {
  if (input.isRegistered && input.appLink) return ` Abra no app: ${input.appLink}`;
  if (!input.isRegistered && input.signupLink) return ` Cadastre-se em segundos: ${input.signupLink}`;
  return "";
}

