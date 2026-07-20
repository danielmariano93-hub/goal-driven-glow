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
  invite: "Oi, {{participant_name}}! 👋 {{owner_name}} incluiu você na divisão “{{title}}”. Sua parte ficou em {{amount}}.{{due_sentence}}{{pix_sentence}} Quando pagar, avise quem criou o rolê para dar baixa por lá.",
  reminder: "Oi, {{participant_name}}! Passando com um lembrete leve: ainda faltam {{amount}} da sua parte em “{{title}}”.{{due_sentence}}{{pix_sentence}} Se você já pagou, pode desconsiderar e avisar quem criou o rolê 💛",
  due_soon: "Oi, {{participant_name}}! Sua parte de {{amount}} em “{{title}}” vence em breve.{{due_sentence}}{{pix_sentence}}",
  overdue: "Oi, {{participant_name}}. Sua parte de {{amount}} em “{{title}}” ainda aparece em aberto. Se você já pagou, avise quem criou o rolê para atualizar por lá 💛{{pix_sentence}}",
  payment_confirmation: "Tudo certo, {{participant_name}}! Seu pagamento em “{{title}}” foi registrado. Obrigado por organizar esse rolê com a gente 🙌",
  completed: "Rolê fechado! 🎉 Todo mundo acertou a divisão “{{title}}”.",
};

// Mapeia o kind curto para as chaves de contexts.* administráveis.
const CONTEXT_KEYS: Record<string, string> = {
  invite: "split_invite",
  reminder: "split_reminder",
  due_soon: "split_due_soon",
  overdue: "split_overdue",
  payment_confirmation: "split_payment_confirmation",
  completed: "split_completed",
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
