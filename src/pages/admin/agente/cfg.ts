export type StructuredCfg = {
  name: string;
  objective: string;
  tone: string;
  do: string[];
  dont: string[];
  welcome: string;
  fallback: string;
  proactive: boolean;
  formality: string;
  emoji_style: string;
  address_style: string;
  signature: string;
  preferred_words: string[];
  forbidden_words: string[];
  templates: Record<string, string>;
};

export const DEFAULT_CFG: StructuredCfg = {
  name: "",
  objective: "Ajudar o usuário a organizar a vida financeira com respeito e clareza.",
  tone: "humano, encorajador, direto",
  do: ["Confirmar antes de gravar qualquer alteração financeira"],
  dont: ["Inventar valores, saldos ou datas"],
  welcome: "Oi! Sou o assistente do MeuNino. Como posso ajudar?",
  fallback: "Não entendi ainda. Pode reformular?",
  proactive: false,
  formality: "informal e respeitoso",
  emoji_style: "moderado",
  address_style: "você",
  signature: "",
  preferred_words: [],
  forbidden_words: [],
  templates: {},
};

export function normalizeCfg(cfg: unknown): StructuredCfg {
  const c = (cfg ?? {}) as Partial<StructuredCfg> & Record<string, unknown>;
  return {
    name: String(c.name ?? DEFAULT_CFG.name),
    objective: String(c.objective ?? DEFAULT_CFG.objective),
    tone: String(c.tone ?? DEFAULT_CFG.tone),
    do: Array.isArray(c.do) ? c.do.map(String) : DEFAULT_CFG.do,
    dont: Array.isArray(c.dont) ? c.dont.map(String) : DEFAULT_CFG.dont,
    welcome: String(c.welcome ?? DEFAULT_CFG.welcome),
    fallback: String(c.fallback ?? DEFAULT_CFG.fallback),
    proactive: Boolean(c.proactive ?? false),
    formality: String(c.formality ?? DEFAULT_CFG.formality),
    emoji_style: String(c.emoji_style ?? DEFAULT_CFG.emoji_style),
    address_style: String(c.address_style ?? DEFAULT_CFG.address_style),
    signature: String(c.signature ?? DEFAULT_CFG.signature),
    preferred_words: Array.isArray(c.preferred_words) ? (c.preferred_words as unknown[]).map(String) : [],
    forbidden_words: Array.isArray(c.forbidden_words) ? (c.forbidden_words as unknown[]).map(String) : [],
    templates: typeof c.templates === "object" && c.templates ? c.templates as Record<string, string> : {},
  };
}

const PREVIEW_VARS: Record<string, string> = {
  participant_name: "Lucas",
  owner_name: "Daniel",
  title: "Fakku",
  amount: "R$ 19,95",
  due_date: "22/07",
  due_sentence: " O combinado é pagar até 22/07.",
  pix_key: "daniel@nocontrole.ia",
  pix_sentence: " Pix: daniel@nocontrole.ia.",
};

export function renderPreview(template: string, cfg: StructuredCfg): string {
  const raw = template?.trim() || "(usando texto padrão do MeuNino)";
  let out = raw.replace(/\{\{([a-z_]+)\}\}/g, (_m, k: string) => PREVIEW_VARS[k] ?? "");
  out = out.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
  const sig = cfg.signature?.trim();
  const name = cfg.name?.trim();
  if (sig) out += `\n\n${sig}`;
  else if (name) out += `\n\n— ${name}`;
  return out;
}
