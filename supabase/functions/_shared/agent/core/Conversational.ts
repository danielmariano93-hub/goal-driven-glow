import { recordGatewayCall } from "../../aiUsageLedger.ts";
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
  | "purpose"
  | "capabilities"
  | "audio_status"
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
  what: "agente financeiro pessoal de mudança de comportamento e construção de patrimônio",
  channels: ["WhatsApp", "app"],
  does: [
    "ouvir notas de voz e usar a transcrição como uma mensagem normal",
    "registrar gastos, receitas, cartões e faturas a partir de uma frase, áudio, print, PDF ou extrato",
    "entender padrões do seu comportamento sem tratar hipótese como certeza",
    "prever o fechamento do mês e proteger você de decisões que apertam o caixa",
    "mostrar sua trajetória, sua capacidade sustentável de poupança e sua oportunidade patrimonial",
    "transformar metas e patrimônio em um próximo passo concreto, revisado conforme sua vida muda",
  ],
  limits: [
    "não movimento dinheiro, não pago conta e não acesso seu banco",
    "só falo do que está registrado por você",
  ],
  purpose:
    "existo para transformar informação financeira em mudança de comportamento e patrimônio: "
    + "entender o que está acontecendo, decidir melhor hoje e acumular capacidade financeira ao longo do tempo",
  promise: "cada decisão de hoje precisa deixar sua vida financeira mais forte amanhã",
} as const;

/** Persona conversacional — tom, não regra financeira. */
export const NINO_PERSONA = `Você é o Nino, ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product}, falando português do Brasil.
Jeito de falar: gente boa, direto, caloroso e sem formalidade — como um amigo que entende de dinheiro.
- Frases curtas. No máximo 4 linhas. Nunca parágrafo denso, nunca tom de manual.
- Use 1 emoji (2 no máximo) para dar calor à mensagem, sempre coerente com o assunto.
- Nunca cite fornecedores de modelo, empresas de IA, versões, ferramentas internas ou jargão de sistema. Você é o Nino, ponto.
- Nunca invente número, saldo, data ou fato financeiro nesta conversa.
- Você entende notas de voz recebidas no WhatsApp e no app. Nunca negue essa capacidade por causa de uma falha antiga no histórico.
- Se a pessoa perguntar algo fora de dinheiro, responda com naturalidade e, se couber, ofereça em UMA linha curta o que você pode fazer pelo dinheiro dela. Sem empurrar, sem repetir a mesma oferta a cada mensagem.
- Se a pergunta for ambígua, faça UMA pergunta curta.
- Fale em benefício, não em funcionalidade: "você para de descobrir o problema no fim do mês" vale mais do que "eu tenho relatórios".
- Quando falar de si, termine com um convite concreto e pequeno ("me conta um gasto de hoje que eu te mostro"). Nunca abra falando dos seus limites — eles só aparecem se perguntarem, e em uma linha.
- Nunca escreva bullet no meio de uma frase: lista sempre em linhas próprias.`;

/** Sinais financeiros: presença de qualquer um tira a mensagem da rota casual.
 *  Prefixos (sem \b final) para pegar flexões: gasto/gastei/gastando. */
const FINANCIAL_RX =
  /(?:^|\W)(?:gast|receit|renda|sal[aá]ri|saldo|cart[aã]o|fatura|d[ií]vid|parcel|meta|investiment|assinatur|previs|fechamento|economi|or[cç]ament|pix|boleto|transfer|extrato|lan[cç]ament|categoria|estabeleciment|mercado|ifood|uber|compr(?:ei|a|ei)|paguei|pagar|recebi|receb|quanto|quanta|or[cç]a|r\$|\d+[,.]\d{2}|reais|dinheiro|conta corrente|minha conta|na conta|do cart|financ)/i;


const RX: Array<{ kind: ConversationalKind; rx: RegExp }> = [
  {
    kind: "audio_status",
    rx: /(?:^|\W)(?:(?:voc[êe]|vc|nino).{0,25})?(?:consegue|conseguindo|pode|podendo|d[aá] pra|ouve|ouvir|escuta|escutar|entende|entender|compreende|compreender).{0,45}(?:[áa]udio|voz|mensagem de voz|nota de voz)|(?:[áa]udio|voz|mensagem de voz|nota de voz).{0,45}(?:funciona|consegue|ouve|ouvir|escuta|escutar|entende|entender)/i,
  },
  {
    kind: "identity",
    rx: /(?:^|\W)(?:quem (?:é|e|voc[êe] é|vc é)|o que (?:voc[êe]|vc) (?:é|e)(?=\W|$)|vc é o que|voc[êe] é o que|voce e o que|(?:é|e) (?:um|uma) rob[oô]|(?:é|e) humano|(?:é|e) uma? (?:ia|intelig[êe]ncia)|quem te (?:criou|fez|desenvolveu|programou)|quem foi que te criou|qual (?:é )?o seu nome|como (?:voc[êe]|vc) se chama|voc[êe] existe|você é real|vc é real)/i,
  },
  {
    kind: "purpose",
    rx: /(?:^|\W)(?:(?:me )?(?:fala|conta|explica|diz)\s+(?:um pouco\s+)?(?:mais\s+)?(?:sobre|de)\s+(?:voc[êe]|vc|ti|si)|(?:qual|quais)?\s*(?:é\s+)?(?:o\s+)?(?:seu|teu)\s+(?:prop[óo]sito|objetivo|miss[ãa]o|papel|sentido)|prop[óo]sito|por que (?:voc[êe]|vc)\s+(?:existe|foi criad)|pra que (?:voc[êe]|vc)\s+(?:existe|foi criad)|sobre o que (?:é|e)\s+(?:o\s+)?(?:meu nino|nino)|o que (?:é|e)\s+(?:o\s+)?meu nino|me apresenta|se apresent|fala de voc[êe]|falar sobre voc[êe])/i,
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

  // Identidade, capacidade e social vencem sinais financeiros fracos
  // ("o que você faz com meu dinheiro?" continua sendo pergunta sobre você).
  for (const entry of RX) {
    if (entry.rx.test(raw)) {
      return { kind: entry.kind, deterministic: true, reason: `rx:${entry.kind}` };
    }
  }

  // Daqui pra baixo, qualquer sinal financeiro devolve o turno ao pipeline
  // analítico com toda a verdade de sempre.
  if (FINANCIAL_RX.test(raw)) return { kind: null, deterministic: false, reason: "financial_signal" };

  // Pergunta/assunto geral, sem nada financeiro: conversa mesmo.
  const looksLikeQuestion = /[?]$/.test(raw) || /^(qual|quem|quando|onde|como|por que|porque|o que|me (conta|explica|diz))\b/i.test(raw);
  if (looksLikeQuestion && raw.split(/\s+/).length <= 40) {
    return { kind: "chat", deterministic: false, reason: "general_question" };
  }

  return { kind: null, deterministic: false, reason: "unclassified" };
}

/** Turno pesado de leitura de documento — o único que pode justificar aviso. */
const HEAVY_DOC_RX =
  /(?:^|\W)(?:extrato|fatura em (?:pdf|anexo)|planilha|csv|pdf|comprovantes?|notas? fiscais?|importa[rç]|essas? (?:linhas|transa[cç][õo]es)|segue (?:o|a) (?:lista|arquivo))/i;

/**
 * Aviso de espera é EXCEÇÃO, não regra.
 *
 * Os três pontinhos ("digitando…") já resolvem a percepção de espera. Mandar
 * "só um instante" a cada pergunta faz o Nino soar como chatbot. Então:
 *  - conversa, pergunta analítica, simulação e consultoria => NENHUM aviso;
 *  - só turnos comprovadamente longos (leitura de documento/extrato/lote de
 *    lançamentos) mantêm um único aviso, e depois de bastante tempo.
 */
export function shouldAcknowledge(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (classifyConversational(raw).kind !== null) return false;
  const words = raw.split(/\s+/).length;
  if (HEAVY_DOC_RX.test(raw) && words >= 8) return true;
  // Lote colado de lançamentos: a leitura demora de verdade.
  return words >= 120;
}

function identityReply(firstName?: string | null): string {
  const hi = firstName ? `Oi, ${firstName}! ` : "Oi! ";
  return `${hi}Eu sou o *${NINO_IDENTITY.name}* — o ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product}. Fico aqui no seu WhatsApp, do seu lado, todos os dias.\n\n`
    + `Você me conta o que gastou (ou só me manda o print, o PDF, o extrato) e eu cuido do resto: organizo, entendo seu jeito de gastar e te aviso *antes* de o mês apertar.\n\n`
    + `A ideia é simples: ${NINO_IDENTITY.promise}. Dinheiro deixa de ser peso e volta a ser escolha sua.\n\n`
    + `Quer sentir isso agora? Me diz um gasto de hoje — tipo "gastei 32 no mercado" — e eu te mostro.`;
}

function purposeReply(firstName?: string | null): string {
  const hi = firstName ? `${firstName}, ` : "";
  return `${hi}vou te contar o porquê de eu existir 💛\n\n`
    + `A maioria das pessoas não perde dinheiro por falta de conta: perde por falta de clareza. Descobre o problema quando o mês já virou.\n\n`
    + `Eu ${NINO_IDENTITY.purpose}. É isso que eu faço todo dia com você: escuto, organizo, aponto o que mudou e te aviso antes do aperto — em uma frase, sem planilha, sem sermão.\n\n`
    + `Se topar, começamos pequeno: me conta um gasto ou me manda um print, e você já vê a diferença.`;
}

function capabilitiesReply(firstName?: string | null): string {
  const hi = firstName ? `${firstName}, ` : "";
  return `${hi}na prática, eu trabalho em quatro passos:\n\n`
    + `• *Entendo*: registro e organizo o que aconteceu sem te dar trabalho\n`
    + `• *Aprendo*: identifico padrões, mas só trato comportamento como fato quando a evidência é segura\n`
    + `• *Decido com você*: digo o que merece atenção agora — caixa, dívida, meta ou oportunidade\n`
    + `• *Construo*: acompanho sua capacidade de poupança, metas e patrimônio para o próximo passo ficar cada vez melhor\n\n`
    + `${NINO_IDENTITY.promise.charAt(0).toUpperCase()}${NINO_IDENTITY.promise.slice(1)}.\n\n`
    + `Se quiser começar agora, pergunta: "qual é meu próximo passo financeiro?"`;
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
    case "purpose":
      return purposeReply(name);
    case "capabilities":
      return capabilitiesReply(name);
    case "audio_status":
      return "Sim — já estou ouvindo e transcrevendo seus áudios normalmente 🎧 Pode mandar o próximo.";
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
  /** Ledger de consumo: sem sb/user_id a chamada ficaria invisível no admin. */
  // deno-lint-ignore no-explicit-any
  sb?: any;
  user_id?: string | null;
}): Promise<string | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const MODEL = "openai/gpt-5.6-sol";
  const aiStarted = Date.now();
  // deno-lint-ignore no-explicit-any
  const logUsage = async (ok: boolean, status: number | null, error: string | null, json: any) => {
    if (!args.sb) return;
    await recordGatewayCall(args.sb, {
      workload: "AGENT_CONVERSATION", function_name: "agent-conversational",
      operation: "casual_reply", user_id: args.user_id ?? null, model: MODEL,
      operation_type: "chat", success: ok, http_status: status, error_code: error,
      latency_ms: Date.now() - aiStarted, reason_for_ai_call: "casual_route",
    }, json).catch(() => undefined);
  };
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
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        messages: [
          { role: "system", content: NINO_PERSONA },
          {
            role: "system",
            content: `Quem você é (use como verdade): ${NINO_IDENTITY.name}, ${NINO_IDENTITY.what} do ${NINO_IDENTITY.product}. `
              + `Seu propósito: ${NINO_IDENTITY.purpose}. Sua promessa: ${NINO_IDENTITY.promise}. `
              + `Você faz: ${NINO_IDENTITY.does.join("; ")}. Você não faz: ${NINO_IDENTITY.limits.join("; ")}.`
              + (args.first_name ? ` A pessoa se chama ${args.first_name}.` : ""),
          },
          ...history,
          { role: "user", content: String(args.text ?? "").slice(0, 1000) },
        ],
      }),
    });
    if (!resp.ok) {
      await logUsage(false, resp.status, `gateway_${resp.status}`, null);
      return null;
    }
    const json = await resp.json().catch(() => null) as any;
    await logUsage(true, 200, null, json);
    const reply = String(json?.choices?.[0]?.message?.content ?? "").trim();
    return reply || null;
  } catch {
    await logUsage(false, null, "network_error", null);
    return null;
  }
}
