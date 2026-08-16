// Conversational (`nino_brain.v2`) — camada CONVERSAR não-financeira.
//
// Perguntas corriqueiras ("o que você é?", "bom dia", "obrigado", "qual a
// capital da França") não têm número, não têm período e não têm motor. Antes
// elas entravam no pipeline financeiro inteiro (capability + contrato analítico
// + validador de verdade) e saíam duras, genéricas e lentas.
//
// Aqui elas ganham rota própria:
//  - identidade/capacidade/saudação/agradecimento => resposta determinística
//    a partir do card canônico do Nino (nunca inventa, nunca cita fornecedor);
//  - conversa geral => uma única chamada ao modelo com APENAS a persona,
//    sem ferramentas e sem regras analíticas (rápido e humano).
// deno-lint-ignore-file no-explicit-any

export type ConversationalKind =
  | "identity"
  | "capabilities"
  | "greeting"
  | "farewell"
  | "thanks"
  | "howareyou"
  | "chat";

export type ConversationalClassification = {
  kind: ConversationalKind | null;
  /** Rota determinística (sem modelo) quando true. */
  deterministic: boolean;
  reason: string;
};

/** Card canônico de identidade — única fonte de verdade sobre o que o Nino é. */
export const NINO_IDENTITY = {
  name: "Nino",
  product: "Meu Nino",
  what: "assistente financeiro pessoal",
  channels: ["WhatsApp", "app"],
  does: [
    "registrar gastos, receitas, cartões e faturas a partir de uma frase, print, PDF ou extrato",
    "responder quanto você gastou, onde, com quem e o que mudou no seu comportamento",
    "prever o fechamento do mês, acompanhar metas, dívidas e assinaturas",
    "avisar antes de um aperto de caixa e ajudar a decidir uma compra",
  ],
  limits: [
    "não movimento dinheiro, não pago conta e não acesso seu banco",
    "só falo do que está registrado por você",
  ],
} as const;

/** Persona conversacional — tom, não regra financeira. */
export const NINO_PERSONA = `Você é o Nino, ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product}, falando português do Brasil.
Jeito de falar: gente boa, direto, caloroso e sem formalidade — como um amigo que entende de dinheiro.
- Frases curtas. No máximo 4 linhas. Nunca parágrafo denso, nunca tom de manual.
- No máximo 1 emoji, e só quando ajuda de verdade.
- Nunca cite fornecedores de modelo, empresas de IA, versões, ferramentas internas ou jargão de sistema. Você é o Nino, ponto.
- Nunca invente número, saldo, data ou fato financeiro nesta conversa.
- Se a pessoa perguntar algo fora de dinheiro, responda com naturalidade e, se couber, ofereça em UMA linha curta o que você pode fazer pelo dinheiro dela. Sem empurrar, sem repetir a mesma oferta a cada mensagem.
- Se a pergunta for ambígua, faça UMA pergunta curta.`;

/** Sinais financeiros: presença de qualquer um tira a mensagem da rota casual. */
const FINANCIAL_RX =
  /\b(gast|gastei|receit|renda|sal[aá]rio|saldo|conta|cart[aã]o|fatura|d[ií]vida|parcel|meta|investiment|assinatur|previs[aã]o|fechamento|economi|or[cç]ament|pix|boleto|transfer|extrato|lan[cç]ament|categoria|estabeleciment|mercado|ifood|uber|comprei|paguei|recebi|quanto|r\$|\d+[,.]\d{2}|reais)\b/i;

const RX: Array<{ kind: ConversationalKind; rx: RegExp }> = [
  {
    kind: "identity",
    rx: /(?:^|\W)(?:quem (?:é|e|voc[êe] é|vc é)|o que (?:voc[êe]|vc) (?:é|e)(?=\W|$)|vc é o que|voc[êe] é o que|voce e o que|(?:é|e) (?:um|uma) rob[oô]|(?:é|e) humano|(?:é|e) uma? (?:ia|intelig[êe]ncia)|quem te (?:criou|fez|desenvolveu|programou)|quem foi que te criou|qual (?:é )?o seu nome|como (?:voc[êe]|vc) se chama|voc[êe] existe|você é real|vc é real)/i,
  },
  {
    kind: "capabilities",
    rx: /(?:^|\W)(?:o que (?:voc[êe]|vc) (?:faz|consegue|sabe|pode)|no que (?:voc[êe]|vc) (?:me )?ajuda|como (?:voc[êe]|vc) (?:funciona|me ajuda|pode me ajudar)|como (?:te )?us(?:o|ar)|pra que (?:voc[êe]|vc) serve|quais (?:são )?suas (?:fun[cç][õo]es|habilidades)|me ajuda com o qu[êe]|o que d[aá] pra fazer (?:aqui|com voc[êe]))/i,
  },
  { kind: "thanks", rx: /^(?:muito )?(?:obrigad[oa]|valeu|vlw|brigad[oa]|agrade[cç]o|top|show|perfeito|maravilha|isso a[íi]|👍|❤️|💛)\W*$/i },
  { kind: "farewell", rx: /^(?:tchau|at[ée] (?:mais|logo|amanh[ãa])|falou|fui|bom descanso|abra[çc]o)\W*$/i },
  { kind: "greeting", rx: /^(?:oi+|ol[áa]|e a[íi]|eae|opa|hey|hello|bom dia|boa tarde|boa noite|fala|salve|tudo bem\??|tudo certo\??)(?:[\s,!.]*(?:nino|nino\.ia|meu nino))?\W*$/i },
  { kind: "howareyou", rx: /(?:^|\W)(?:como (?:voc[êe]|vc) (?:est[áa]|ta|tá)|tudo (?:bem|certo) (?:com )?(?:voc[êe]|vc)|como vai (?:voc[êe]|vc))/i },
];


/**
 * Classifica a mensagem como conversa não-financeira. Conservador de
 * propósito: qualquer sinal financeiro devolve `null` e o turno segue pelo
 * pipeline analítico com toda a verdade de sempre.
 */
export function classifyConversational(text: string): ConversationalClassification {
  const raw = String(text ?? "").trim();
  if (!raw) return { kind: null, deterministic: false, reason: "empty" };
  if (raw.length > 320) return { kind: null, deterministic: false, reason: "too_long" };
  if (FINANCIAL_RX.test(raw)) return { kind: null, deterministic: false, reason: "financial_signal" };

  for (const entry of RX) {
    if (entry.rx.test(raw)) {
      return { kind: entry.kind, deterministic: true, reason: `rx:${entry.kind}` };
    }
  }

  // Pergunta/assunto geral, sem nada financeiro: conversa mesmo.
  const looksLikeQuestion = /[?]$/.test(raw) || /^(qual|quem|quando|onde|como|por que|porque|o que|me (conta|explica|diz))\b/i.test(raw);
  if (looksLikeQuestion && raw.split(/\s+/).length <= 40) {
    return { kind: "chat", deterministic: false, reason: "general_question" };
  }
  return { kind: null, deterministic: false, reason: "unclassified" };
}

/** O aviso de espera só existe quando o turno realmente pode demorar. */
export function shouldAcknowledge(text: string): boolean {
  const c = classifyConversational(text);
  return c.kind === null;
}

function identityReply(firstName?: string | null): string {
  const hi = firstName ? `Oi, ${firstName}! ` : "Oi! ";
  return `${hi}Eu sou o ${NINO_IDENTITY.name}, seu ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product} — falo com você aqui no ${NINO_IDENTITY.channels[0]} e no ${NINO_IDENTITY.channels[1]}.\n\n`
    + `Na prática: você me conta o que gastou (ou me manda o print, o PDF, o extrato) e eu organizo, entendo seus padrões e te aviso antes de o mês apertar.\n\n`
    + `O que eu não faço: ${NINO_IDENTITY.limits[0]} — o controle continua todo seu.`;
}

function capabilitiesReply(firstName?: string | null): string {
  const hi = firstName ? `${firstName}, ` : "";
  return `${hi}posso te ajudar assim 👇\n\n`
    + `• Registrar na hora: "gastei 32 no mercado" — ou me manda o print/PDF e eu leio tudo\n`
    + `• Responder de verdade: quanto, onde, com quem e o que mudou nos seus gastos\n`
    + `• Olhar pra frente: fechamento do mês, metas, dívidas e assinaturas\n`
    + `• Avaliar uma compra antes de você decidir\n\n`
    + `Quer começar por qual?`;
}

/** Resposta determinística para as intenções sociais e de identidade. */
export function deterministicConversationalReply(
  kind: ConversationalKind,
  ctx?: { first_name?: string | null; hour?: number },
): string | null {
  const name = ctx?.first_name?.trim() || null;
  switch (kind) {
    case "identity":
      return identityReply(name);
    case "capabilities":
      return capabilitiesReply(name);
    case "greeting": {
      const hour = ctx?.hour ?? 12;
      const period = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
      return `${period}${name ? `, ${name}` : ""}! Tudo bem por aqui 💛 Me conta: quer registrar algo ou dar uma olhada em como o mês está indo?`;
    }
    case "thanks":
      return "Por nada! Tô aqui sempre que precisar.";
    case "farewell":
      return "Até logo! Qualquer coisa, me chama por aqui.";
    case "howareyou":
      return `Tudo ótimo por aqui${name ? `, ${name}` : ""} — pronto pra te ajudar com o dinheiro. E você, como está?`;
    default:
      return null;
  }
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Conversa geral: uma única chamada, sem ferramentas, com prompt curto (só a
 * persona). Rápida por construção. Devolve `null` quando não dá pra responder
 * assim — nesse caso o turno segue o caminho normal.
 */
export async function generateConversationalReply(args: {
  text: string;
  history?: Array<{ role: string; content: string }>;
  first_name?: string | null;
  model?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 12_000);
  try {
    const history = (args.history ?? []).slice(-6)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 600) }));
    const resp = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-function",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: args.model ?? "google/gemini-3.6-flash",
        temperature: 0.6,
        messages: [
          { role: "system", content: NINO_PERSONA },
          {
            role: "system",
            content: `Quem você é (use como verdade): ${NINO_IDENTITY.name}, ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product}. `
              + `Você faz: ${NINO_IDENTITY.does.join("; ")}. Você não faz: ${NINO_IDENTITY.limits.join("; ")}.`
              + (args.first_name ? ` A pessoa se chama ${args.first_name}.` : ""),
          },
          ...history,
          { role: "user", content: String(args.text ?? "").slice(0, 1000) },
        ],
      }),
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null) as any;
    const reply = String(json?.choices?.[0]?.message?.content ?? "").trim();
    return reply || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
