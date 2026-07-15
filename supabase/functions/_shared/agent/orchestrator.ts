// Server-side orchestrator. The single entry point called by:
//   - whatsapp-webhook (real inbound), and
//   - agent-run (admin simulator).
// The LLM path is optional; when unavailable we use the deterministic
// interpreter and still exercise the full draft → confirm pipeline.

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { interpret, type ParsedIntent, todaySaoPaulo } from "../../../../src/lib/agent/parser.ts";

export type OrchestratorInput = {
  user_id: string;
  conversation_id: string;
  inbound_message_id: string;
  text: string;
  source: "whatsapp" | "simulator";
  to_phone: string;
};

export type OrchestratorResult = {
  reply: string;
  reply_kind: "receipt" | "draft" | "question" | "info" | "unlinked" | "cancelled" | "expired";
  draft_id?: string;
  result?: unknown;
};

const NUM_BR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findPending(sb: SupabaseClient, conversation_id: string) {
  const { data } = await sb.from("pending_confirmations")
    .select("id, kind, payload, summary_text, status, expires_at, result_snapshot")
    .eq("conversation_id", conversation_id)
    .eq("status", "pending")
    .maybeSingle();
  return data ?? null;
}

async function resolveAccount(sb: SupabaseClient, user_id: string, hint?: string) {
  const { data: accs } = await sb.from("accounts")
    .select("id, name")
    .eq("user_id", user_id).eq("active", true);
  const list = accs ?? [];
  if (list.length === 0) return { accounts: [], match: null };
  if (list.length === 1) return { accounts: list, match: list[0] };
  if (hint) {
    const h = hint.toLowerCase();
    const m = list.find(a => (a.name as string).toLowerCase().includes(h) || h.includes((a.name as string).toLowerCase()));
    if (m) return { accounts: list, match: m };
  }
  return { accounts: list, match: null };
}

async function resolveCategory(sb: SupabaseClient, user_id: string, type: "expense"|"income", hint?: string) {
  const q = sb.from("categories").select("id, name, type").in("type", [type, "both"] as any);
  const { data: personal } = await q.eq("user_id", user_id);
  const { data: global } = await sb.from("categories").select("id, name, type").is("user_id", null).in("type", [type, "both"] as any);
  const list = [...(personal ?? []), ...(global ?? [])];
  if (list.length === 0) return null;
  if (hint) {
    const h = hint.toLowerCase();
    const m = list.find(c => (c.name as string).toLowerCase().includes(h) || h.includes((c.name as string).toLowerCase()));
    if (m) return m;
  }
  return null;
}

async function enqueueReply(
  sb: SupabaseClient,
  args: { user_id: string; to_phone: string; body: string; idempotency_key: string; inbound_message_id: string; source: "whatsapp"|"simulator" }
) {
  await sb.from("outbound_messages").insert({
    user_id: args.user_id,
    to_phone: args.to_phone,
    body: args.body,
    kind: "agent",
    channel: args.source === "simulator" ? "simulator" : "whatsapp",
    idempotency_key: args.idempotency_key,
    inbound_message_id: args.inbound_message_id,
    status: args.source === "simulator" ? "sent" : "queued",
  });
}

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const sb = service();

  // 1. Dedupe by inbound_message_id: if we already produced a reply for it, return it.
  const { data: existing } = await sb.from("outbound_messages")
    .select("body")
    .eq("inbound_message_id", input.inbound_message_id)
    .maybeSingle();
  if (existing) return { reply: existing.body as string, reply_kind: "info" };

  const idem = `run:${input.inbound_message_id}`;
  const intent: ParsedIntent = interpret(input.text);

  // 2. Pre-LLM intercept: CONFIRMAR / CANCELAR when a draft is pending
  const pending = await findPending(sb, input.conversation_id);
  if (intent.kind === "confirm") {
    if (!pending) {
      const body = "Não encontrei nada pendente para confirmar. Me conte a operação primeiro (ex.: “gastei 42,90 no almoço hoje”).";
      await enqueueReply(sb, { ...input, body, idempotency_key: idem });
      return { reply: body, reply_kind: "info" };
    }
    const { data: exec } = await sb.rpc("agent_execute_confirmation", {
      p_confirmation_id: pending.id, p_source_message_id: input.inbound_message_id,
    });
    const okExec = exec as { ok: boolean; result?: any; error?: string; idempotent?: boolean } | null;
    let body: string;
    if (okExec?.ok) {
      body = okExec.idempotent
        ? "Essa operação já havia sido confirmada. Está tudo certo por aqui. ✅"
        : buildReceipt(pending.kind as string, okExec.result);
    } else {
      body = okExec?.error === "expired"
        ? "Este pedido expirou. Envie de novo, por favor."
        : "Não consegui concluir a operação. Vamos tentar de novo?";
    }
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "receipt", draft_id: pending.id, result: okExec?.result };
  }
  if (intent.kind === "cancel") {
    if (pending) await sb.from("pending_confirmations").update({ status: "cancelled" }).eq("id", pending.id);
    const body = "Combinado, cancelei este pedido. Se mudar de ideia, é só me contar de novo. 🙂";
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "cancelled" };
  }

  // 3. Queries
  if (intent.kind === "query") {
    const body = await handleQuery(sb, input.user_id, intent);
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "info" };
  }

  // 4. Transaction draft
  if (intent.kind === "transaction") {
    const { accounts, match: acc } = await resolveAccount(sb, input.user_id, intent.account_hint);
    if (accounts.length === 0) {
      const body = "Antes de registrar, cadastre pelo menos uma conta em Contas 📒.";
      await enqueueReply(sb, { ...input, body, idempotency_key: idem });
      return { reply: body, reply_kind: "info" };
    }
    if (!acc) {
      const opts = accounts.map(a => `• ${a.name}`).join("\n");
      const body = `Em qual conta eu registro?\n${opts}\nResponda com o nome.`;
      await enqueueReply(sb, { ...input, body, idempotency_key: idem });
      return { reply: body, reply_kind: "question" };
    }
    const cat = await resolveCategory(sb, input.user_id, intent.type, intent.category_hint);
    const payload = {
      type: intent.type,
      amount: intent.amount,
      account_id: acc.id,
      category_id: cat?.id ?? null,
      occurred_at: intent.occurred_at,
      description: intent.description ?? null,
    };
    const summary = `${intent.type === "income" ? "Receita" : "Despesa"} de ${NUM_BR.format(intent.amount)} em ${acc.name}${cat ? ` (${(cat as any).name})` : ""}${intent.description ? ` — ${intent.description}` : ""} em ${intent.occurred_at}.`;
    const { data: id } = await sb.rpc("agent_upsert_draft", {
      p_user_id: input.user_id,
      p_conversation_id: input.conversation_id,
      p_kind: "transaction",
      p_payload: payload,
      p_summary: summary,
      p_ttl_minutes: 15,
    });
    const body = `${summary}\nResponda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.`;
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "draft", draft_id: id as string };
  }

  // 5. Transfer draft
  if (intent.kind === "transfer") {
    const { data: accs } = await sb.from("accounts").select("id, name").eq("user_id", input.user_id).eq("active", true);
    const list = accs ?? [];
    if (list.length < 2) {
      const body = "Preciso de pelo menos duas contas para registrar uma transferência.";
      await enqueueReply(sb, { ...input, body, idempotency_key: idem });
      return { reply: body, reply_kind: "info" };
    }
    const from = intent.from_hint ? list.find(a => (a.name as string).toLowerCase().includes(intent.from_hint!)) : null;
    const to = intent.to_hint ? list.find(a => (a.name as string).toLowerCase().includes(intent.to_hint!)) : null;
    if (!from || !to || from.id === to.id) {
      const opts = list.map(a => `• ${a.name}`).join("\n");
      const body = `De qual conta para qual? Escreva no formato “transferir 100 de X para Y”.\nSuas contas:\n${opts}`;
      await enqueueReply(sb, { ...input, body, idempotency_key: idem });
      return { reply: body, reply_kind: "question" };
    }
    const summary = `Transferência de ${NUM_BR.format(intent.amount)} de ${from.name} para ${to.name} em ${intent.occurred_at}.`;
    const { data: id } = await sb.rpc("agent_upsert_draft", {
      p_user_id: input.user_id,
      p_conversation_id: input.conversation_id,
      p_kind: "transfer",
      p_payload: { from_account_id: from.id, to_account_id: to.id, amount: intent.amount, occurred_at: intent.occurred_at },
      p_summary: summary, p_ttl_minutes: 15,
    });
    const body = `${summary}\nResponda *CONFIRMAR* ou *CANCELAR*.`;
    await enqueueReply(sb, { ...input, body, idempotency_key: idem });
    return { reply: body, reply_kind: "draft", draft_id: id as string };
  }

  // 6. Fallback
  const body = "Ainda estou aprendendo. Você pode me contar assim: “gastei 42,90 no almoço hoje no Nubank”, “recebi 3000 salário”, “transferir 100 de Nubank para Itaú”.";
  await enqueueReply(sb, { ...input, body, idempotency_key: idem });
  return { reply: body, reply_kind: "info" };
}

async function handleQuery(sb: SupabaseClient, user_id: string, q: Extract<ParsedIntent, { kind: "query" }>) {
  const today = todaySaoPaulo();
  const monthStart = today.slice(0, 8) + "01";
  if (q.topic === "summary") {
    const { data } = await sb.from("transactions")
      .select("type, amount").eq("user_id", user_id).gte("occurred_at", monthStart);
    const rows = (data ?? []) as { type: string; amount: number | string }[];
    const inc = rows.filter(r => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
    const exp = rows.filter(r => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
    return `Neste mês: entradas ${NUM_BR.format(inc)}, saídas ${NUM_BR.format(exp)}, saldo do período ${NUM_BR.format(inc - exp)}.`;
  }
  if (q.topic === "recent") {
    const { data } = await sb.from("transactions")
      .select("type, amount, occurred_at, description")
      .eq("user_id", user_id).order("occurred_at", { ascending: false }).limit(5);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) return "Ainda não há lançamentos por aqui.";
    return "Seus últimos lançamentos:\n" + rows.map(r =>
      `• ${r.occurred_at} · ${r.type === "expense" ? "-" : "+"}${NUM_BR.format(Number(r.amount))}${r.description ? ` · ${r.description}` : ""}`,
    ).join("\n");
  }
  if (q.topic === "before_spending" && q.amount) {
    const { data } = await sb.from("transactions")
      .select("type, amount").eq("user_id", user_id).gte("occurred_at", monthStart);
    const rows = (data ?? []) as { type: string; amount: number | string }[];
    const inc = rows.filter(r => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
    const exp = rows.filter(r => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
    const livre = inc - exp;
    return `Se você gastar ${NUM_BR.format(q.amount)} hoje, o saldo estimado do mês fica em ${NUM_BR.format(livre - q.amount)}.\nEstimativa baseada apenas em receitas e despesas confirmadas do mês; não inclui gastos fixos futuros nem investimentos.`;
  }
  return "Certo. Me conte com mais detalhes o que você quer consultar.";
}

function buildReceipt(kind: string, result: any): string {
  if (kind === "transaction") {
    const t = result?.type === "income" ? "Receita" : "Despesa";
    return `${t} registrada: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  }
  if (kind === "transfer") return `Transferência registrada: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "goal") return `Meta criada: ${result?.name}. ✅`;
  if (kind === "goal_contribution") return `Aporte registrado: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "debt") return `Dívida registrada: ${result?.name}. ✅`;
  return "Pronto, registrei. ✅";
}
