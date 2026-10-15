// inbound_addressee.v1 — a mensagem é sobre a cobrança do rolê ou sobre as finanças da própria pessoa?
//
// Quem recebe cobrança de rolê pode ser, ao mesmo tempo, usuário do Nino. Decidir "para onde vai a
// mensagem" por palavra-chave ("valor", "quanto", "falta") é frágil: um registro de gasto traz "Valor: R$ 30".
// Aqui o Nino LÊ a mensagem com o contexto do que ele mesmo mandou e responde QUEM é o destinatário.
// O modelo só classifica: não responde, não calcula, não grava nada.
// deno-lint-ignore-file no-explicit-any
import { callStructuredFunction } from "../ai-structured.ts";
import { resolveAiProvider } from "../ai-runtime.ts";
import { recordAiUsage } from "../aiUsageLedger.ts";

export type Addressee = "split_charge" | "own_finance" | "unclear";

export type AddresseeReading = {
  version: "inbound_addressee.v1";
  addressee: Addressee;
  confidence: number;
  reason: string;
  source: "llm" | "unavailable";
  latency_ms: number;
  error: string | null;
};

export type AddresseeContext = {
  text: string;
  split: { title: string; pending_amount: number; due_date: string | null };
  /**
   * O que o Nino mandou por último, de QUALQUER assunto (mais recente primeiro). Respostas curtas quase sempre
   * se referem à mensagem imediatamente anterior; mostrar só a cobrança faria tudo parecer sobre ela.
   */
  conversation: Array<{ kind: string; minutes_ago: number; text: string; about_split: boolean }>;
};

export type AddresseeReader = (ctx: AddresseeContext) => Promise<AddresseeReading>;

const TOOL = {
  name: "emit_inbound_addressee",
  description: "Diz a quem se dirige a mensagem. Não responde à pessoa e não calcula valores.",
  parameters: {
    type: "object",
    properties: {
      addressee: {
        type: "string",
        enum: ["split_charge", "own_finance", "unclear"],
        description:
          "split_charge: fala da cobrança/divisão do rolê (quanto deve, vencimento, Pix, já paguei, comprovante dessa dívida, parar de cobrar). " +
          "own_finance: é sobre qualquer outro assunto com o assistente: finanças da própria pessoa (registrar gasto ou receita, saldo, metas, relatórios), " +
          "ou uma pergunta/reação a OUTRA mensagem que o assistente acabou de mandar (um aviso, um registro, uma sugestão). " +
          "unclear: pode ser qualquer um dos dois e errar custa caro.",
      },
      confidence: { type: "number", description: "0 a 1." },
      reason: { type: "string", description: "Uma frase curta, sem dados pessoais." },
    },
    required: ["addressee", "confidence", "reason"],
    additionalProperties: false,
  },
};

function systemPrompt(): string {
  return [
    "Você lê mensagens de WhatsApp em português do Brasil enviadas a um assistente de finanças pessoais.",
    "A pessoa também deve uma parte de um rolê (despesa dividida), e o assistente cobrou isso recentemente.",
    "Sua única tarefa: dizer a quem a mensagem se dirige, via emit_inbound_addressee.",
    "Regras de leitura:",
    "- A mensagem mais recente do assistente é o assunto mais provável de uma resposta ou pergunta curta. Se ela NÃO é sobre o rolê, a resposta provavelmente também não é.",
    "- A cobrança do rolê só é o assunto quando a mensagem fala dela (dívida, parcela, vencimento, Pix, pagamento) ou responde a uma mensagem sobre ela.",
    "- Se a pessoa descreve um gasto ou receita dela (valor, estabelecimento, data, conta ou cartão, mesmo em formato de formulário ou atalho do celular), é own_finance.",
    "- Se ela pede algo ao assistente (saldo, relatório, meta, categoria), é own_finance.",
    "- Se ela fala da dívida do rolê (quanto falta, quando vence, chave Pix, já paguei, comprovante, 'para de cobrar'), é split_charge.",
    "- Palavras como 'valor' e 'quanto' aparecem nos dois casos: decida pelo sentido da mensagem inteira, nunca pela palavra.",
    "- Mensagem curta e sem assunto próprio ('ok', 'chega', 'beleza'): unclear, a menos que o contexto deixe claro.",
    "- Na dúvida real entre os dois, use unclear com confiança baixa. Nunca chute.",
  ].join("\n");
}

function userPrompt(ctx: AddresseeContext): string {
  const conv = ctx.conversation.length
    ? ctx.conversation.map((m, i) => `${i === 0 ? "(mais recente) " : ""}há ${m.minutes_ago} min — ${m.about_split ? "SOBRE O ROLÊ" : "outro assunto"} [${m.kind}]: ${m.text}`).join("\n")
    : "- nenhuma";
  return [
    `Rolê em aberto: "${ctx.split.title}", parte pendente da pessoa R$ ${ctx.split.pending_amount.toFixed(2)}${ctx.split.due_date ? `, vencimento ${ctx.split.due_date}` : ""}.`,
    `Últimas mensagens do assistente para a pessoa:\n${conv}`,
    `Mensagem da pessoa agora:\n"""\n${String(ctx.text ?? "").slice(0, 800)}\n"""`,
    "Emita somente emit_inbound_addressee.",
  ].join("\n\n");
}

function unavailable(error: string, latency_ms = 0): AddresseeReading {
  return { version: "inbound_addressee.v1", addressee: "unclear", confidence: 0, reason: "", source: "unavailable", latency_ms, error };
}

export function parseAddressee(args: string): Pick<AddresseeReading, "addressee" | "confidence" | "reason"> | null {
  try {
    const p = JSON.parse(args || "{}");
    const addressee = ["split_charge", "own_finance", "unclear"].includes(p.addressee) ? p.addressee as Addressee : null;
    if (!addressee) return null;
    const confidence = Math.max(0, Math.min(1, Number(p.confidence ?? 0)));
    return { addressee, confidence: Number.isFinite(confidence) ? confidence : 0, reason: String(p.reason ?? "").slice(0, 160) };
  } catch { return null; }
}

export function makeAddresseeReader(deps: { sb?: any; user_id?: string | null; model?: string; timeoutMs?: number }): AddresseeReader {
  return async (ctx) => {
    const provider = resolveAiProvider();
    if (!provider) return unavailable("llm_not_configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5_000);
    const started = Date.now();
    try {
      const res = await callStructuredFunction({
        provider, model: deps.model ?? "openai/gpt-oss-120b", system: systemPrompt(), user: userPrompt(ctx),
        tool: TOOL, signal: controller.signal, temperature: 0, reasoning_effort: "low",
      });
      if (deps.sb) {
        await recordAiUsage(deps.sb, {
          workload: "AGENT_CONVERSATION", function_name: "whatsapp-webhook", operation: "inbound_addressee",
          user_id: deps.user_id ?? null, run_id: null, model: res.model, provider: res.provider,
          success: res.ok, http_status: res.status, error_code: res.ok ? null : (res.error_code ?? "addressee_gateway"),
          latency_ms: res.latency_ms, reason_for_ai_call: "inbound_addressee_v1",
          metadata: { provider: res.provider },
        } as any).catch(() => {});
      }
      if (!res.ok) return unavailable(res.error_code ?? "gateway_error", res.latency_ms);
      const parsed = parseAddressee(res.arguments);
      if (!parsed) return unavailable("invalid_output", res.latency_ms);
      return { version: "inbound_addressee.v1", ...parsed, source: "llm", latency_ms: res.latency_ms, error: null };
    } catch (e) {
      return unavailable(e instanceof Error ? e.message.slice(0, 100) : "addressee_failed", Date.now() - started);
    } finally {
      clearTimeout(timer);
    }
  };
}
