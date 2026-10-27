// Lembretes e cobranças agrupados: a mesma pessoa (mesmo telefone), do mesmo dono, com parcelas do mesmo tipo
// e do mesmo vencimento em mais de um rolê recebe UMA mensagem, em vez de uma por parcela.
// Vale só para due_soon, due_today e overdue. Convite e confirmação de pagamento continuam individuais.
// deno-lint-ignore-file no-explicit-any

export const GROUPABLE_KINDS = ["due_soon", "due_today", "overdue"] as const;
export type GroupableKind = (typeof GROUPABLE_KINDS)[number];
export const MAX_GROUPED_ITEMS = 5;

export type GroupedItem = {
  title: string;
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
  splitTotal: number | null;
  participantsCount: number | null;
  pixKey: string | null;
};

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));

function shortDate(iso: string, today: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

const WORDS = ["", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
const countWord = (n: number) => WORDS[n] || String(n);

function installmentText(item: GroupedItem): string {
  return item.totalInstallments > 1 ? `${item.installmentNumber}ª parcela de ${item.totalInstallments}` : "parte única";
}

export function buildGroupedReminderMessage(input: {
  kind: GroupableKind;
  participantName: string;
  ownerName: string;
  dueDate: string;
  today: string;
  daysOverdue?: number;
  items: GroupedItem[];
}): { title: string; text: string } {
  const { kind, ownerName, dueDate, today, items } = input;
  const name = input.participantName.trim() || "tudo bem";
  const n = items.length;
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const when = shortDate(dueDate, today);
  const shown = items.slice(0, MAX_GROUPED_ITEMS);
  const extra = n - shown.length;
  const detailed = kind !== "overdue";

  const lines = shown.map((i) => {
    if (!detailed) return `• *${i.title}* · ${installmentText(i)} · *${fmtBRL(i.amount)}*`;
    const ctx = i.splitTotal != null && i.participantsCount
      ? ` (rolê de ${fmtBRL(i.splitTotal)}, ${i.participantsCount} ${i.participantsCount === 1 ? "pessoa" : "pessoas"})`
      : "";
    return `• *${i.title}*${ctx}\n  ${installmentText(i)} · *${fmtBRL(i.amount)}*`;
  });
  if (extra > 0) lines.push(`• e mais ${extra} ${extra === 1 ? "parcela" : "parcelas"}`);

  const pixes = [...new Set(items.map((i) => (i.pixKey ?? "").trim()).filter(Boolean))];
  const pix = pixes.length === 1 ? `\n\nPix: ${pixes[0]}` : pixes.length > 1 ? `\n\nPix: ${pixes.join(" · ")}` : "";

  let title: string;
  let head: string;
  let foot = "";
  if (kind === "due_today") {
    title = `💸 *Vence hoje — ${n} parcelas com ${ownerName}*`;
    head = `Oi, ${name}! Hoje, *${when}*, vencem ${countWord(n)} parcelas das suas divisões com ${ownerName}, somando *${fmtBRL(total)}*:`;
  } else if (kind === "due_soon") {
    title = `💸 *Vence amanhã — ${n} parcelas com ${ownerName}*`;
    head = `Oi, ${name}! Amanhã, *${when}*, vencem ${countWord(n)} parcelas das suas divisões com ${ownerName}, somando *${fmtBRL(total)}*:`;
  } else {
    const days = Math.max(1, input.daysOverdue ?? 1);
    title = "💸 *Um lembrete amigo*";
    head = `Oi, ${name}! Passando pra lembrar que estas parcelas com ${ownerName} venceram em *${when}* e estão em aberto há *${days} ${days === 1 ? "dia" : "dias"}*, somando *${fmtBRL(total)}*:`;
    foot = "\n\nSe já pagou, é só me responder por aqui que eu confiro 😉";
  }
  return { title, text: `${title}\n\n${head}\n\n${lines.join("\n")}${pix}${foot}` };
}

export type GroupJob = { id: string; kind: string; installment_id: string | null; shared_expense_id: string; participant_id: string };
export type ReminderGroup = { key: string; kind: GroupableKind; dueDate: string; phone: string; ownerUserId: string; jobs: GroupJob[] };

/**
 * Agrupa jobs já reivindicados (claim) por dono + telefone + tipo + vencimento. Só vira grupo quando há 2 ou mais rolês
 * diferentes. O primeiro job do grupo (na ordem do claim) é o líder. Retorna jobId -> grupo.
 */
export async function planReminderGroups(sb: any, jobs: GroupJob[]): Promise<Map<string, ReminderGroup>> {
  const out = new Map<string, ReminderGroup>();
  const candidates = jobs.filter((j) => (GROUPABLE_KINDS as readonly string[]).includes(j.kind) && j.installment_id);
  if (candidates.length < 2) return out;

  const { data: recv, error: recvErr } = await sb.from("split_receivables_v1")
    .select("installment_id,due_date,owner_user_id")
    .in("installment_id", candidates.map((j) => j.installment_id));
  if (recvErr) throw new Error(`group_receivables:${recvErr.message}`);
  const { data: parts, error: partErr } = await sb.from("shared_expense_participants")
    .select("id,phone_e164")
    .in("id", candidates.map((j) => j.participant_id));
  if (partErr) throw new Error(`group_participants:${partErr.message}`);

  const recvBy = new Map<string, { due_date: string | null; owner_user_id: string | null }>(
    ((recv ?? []) as any[]).map((r) => [String(r.installment_id), r]));
  const phoneBy = new Map<string, string>(((parts ?? []) as any[]).map((p) => [String(p.id), String(p.phone_e164 ?? "")]));

  const buckets = new Map<string, ReminderGroup>();
  for (const job of candidates) {
    const r = recvBy.get(String(job.installment_id));
    const phone = phoneBy.get(job.participant_id) ?? "";
    if (!r?.due_date || !r.owner_user_id || !phone) continue;
    const key = `${r.owner_user_id}|${phone}|${job.kind}|${String(r.due_date).slice(0, 10)}`;
    const bucket = buckets.get(key) ?? {
      key, kind: job.kind as GroupableKind, dueDate: String(r.due_date).slice(0, 10), phone, ownerUserId: String(r.owner_user_id), jobs: [],
    };
    bucket.jobs.push(job);
    buckets.set(key, bucket);
  }
  for (const g of buckets.values()) {
    if (new Set(g.jobs.map((j) => j.shared_expense_id)).size < 2) continue;
    for (const j of g.jobs) out.set(j.id, g);
  }
  return out;
}

type Deps = {
  today: string;
  daysBetween: (from: string, to: string) => number;
  ownerName: (ownerUserId: string) => Promise<string>;
  splitContext: (expenseId: string) => Promise<{ participantsCount: number; totalAmount: number }>;
};

export type GroupResult = {
  /** Jobs que já foram resolvidos (enviados em grupo ou descartados); o laço principal não deve processá-los de novo. */
  finalized: string[];
  enqueued: number;
  appDelivered: number;
  skipped: number;
  outboundIds: string[];
};

/**
 * Valida cada parcela do grupo no momento do envio (como no caminho individual). Com 2+ válidas, enfileira UMA
 * mensagem. Com menos de 2, devolve só os descartados e deixa a válida para o caminho individual.
 */
export async function dispatchGroupedReminder(sb: any, group: ReminderGroup, deps: Deps): Promise<GroupResult> {
  const result: GroupResult = { finalized: [], enqueued: 0, appDelivered: 0, skipped: 0, outboundIds: [] };
  type Member = { job: GroupJob; participant: any; expense: any; row: any };
  const valid: Member[] = [];

  const drop = async (job: GroupJob, reason: string) => {
    await sb.from("reminder_jobs").update({ status: "skipped", cancel_reason: reason, last_error: reason, lease_expires_at: null }).eq("id", job.id);
    result.finalized.push(job.id);
    result.skipped++;
  };

  for (const job of group.jobs) {
    const { data: participant } = await sb.from("shared_expense_participants")
      .select("id,name,phone_e164,status,opt_out_at,reminders_paused_at,linked_user_id,reminder_count")
      .eq("id", job.participant_id).single();
    const { data: expense } = await sb.from("shared_expenses")
      .select("title,pix_key,owner_user_id,status,deleted_at").eq("id", job.shared_expense_id).single();
    const { data: row } = await sb.from("split_receivables_v1")
      .select("installment_id,installment_number,total_installments,balance_due,settlement_status,due_date")
      .eq("installment_id", job.installment_id).maybeSingle();
    if (!participant || !expense) { await drop(job, "split_not_found"); continue; }
    if (!["pending", "partial", "notified"].includes(String(participant.status))) { await drop(job, "participant_settled"); continue; }
    if (String(expense.status) === "cancelled" || expense.deleted_at || String(expense.status) === "settled") { await drop(job, "split_closed"); continue; }
    if (participant.reminders_paused_at) { await drop(job, "participant_reminders_paused"); continue; }
    if (participant.opt_out_at) { await drop(job, "opted_out"); continue; }
    if (!row) { await drop(job, "installment_missing"); continue; }
    if (row.settlement_status === "cancelled") { await drop(job, "cancelled"); continue; }
    if (row.settlement_status === "paid") { await drop(job, "already_paid"); continue; }
    if (Math.max(0, Number(row.balance_due ?? 0)) <= 0) { await drop(job, "no_balance_due"); continue; }
    valid.push({ job, participant, expense, row });
  }

  if (new Set(valid.map((m) => m.job.shared_expense_id)).size < 2) return result;

  const ownerName = await deps.ownerName(group.ownerUserId);
  const items: GroupedItem[] = [];
  for (const m of valid) {
    const ctx = await deps.splitContext(String(m.job.shared_expense_id));
    items.push({
      title: String(m.expense.title ?? "seu rolê"),
      installmentNumber: Number(m.row.installment_number ?? 1),
      totalInstallments: Number(m.row.total_installments ?? 1),
      amount: Math.max(0, Number(m.row.balance_due ?? 0)),
      splitTotal: ctx.totalAmount,
      participantsCount: ctx.participantsCount,
      pixKey: m.expense.pix_key ?? null,
    });
  }
  const daysOverdue = group.kind === "overdue" ? Math.max(1, deps.daysBetween(group.dueDate, deps.today)) : undefined;
  const leader = valid[0];
  const { title, text } = buildGroupedReminderMessage({
    kind: group.kind, participantName: String(leader.participant.name ?? ""), ownerName, dueDate: group.dueDate, today: deps.today, daysOverdue, items,
  });

  const jobIds = valid.map((m) => m.job.id).sort();
  const idempotencyKey = `split:group:${group.kind}:${group.phone}:${group.dueDate}:${jobIds.map((id) => id.slice(0, 8)).join("-")}`;
  let outboundId: string | null = null;
  const { data: outbound, error: outboundError } = await sb.from("outbound_messages").insert({
    channel: "whatsapp",
    user_id: group.ownerUserId,
    to_phone: group.phone,
    body: text,
    status: "queued",
    kind: `split_${group.kind}`,
    idempotency_key: idempotencyKey,
    context_type: "shared_expense",
    context_id: leader.job.shared_expense_id,
    participant_id: leader.job.participant_id,
    metadata: {
      job_id: leader.job.id,
      origin: "split_reminder_v2",
      template: group.kind,
      grouped: true,
      group_size: valid.length,
      group_job_ids: jobIds,
      group_expense_ids: valid.map((m) => m.job.shared_expense_id),
      message_preview: text.slice(0, 900),
    },
    surface: "whatsapp",
    feature: "split_reminder",
  }).select("id").single();
  if (outboundError) {
    const duplicate = String(outboundError.code) === "23505" || String(outboundError.message).toLowerCase().includes("duplicate");
    if (!duplicate) throw new Error(`outbound:${outboundError.message}`);
    const { data: existing } = await sb.from("outbound_messages").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
    outboundId = existing?.id ?? null;
    if (!outboundId) throw new Error("outbound_duplicate_without_row");
  } else {
    outboundId = outbound.id;
  }
  result.outboundIds.push(outboundId as string);
  result.enqueued++;

  for (const m of valid) {
    if (m.participant.linked_user_id) {
      const { error } = await sb.from("notifications").upsert({
        user_id: m.participant.linked_user_id,
        type: "split_reminder",
        title: title.replace(/\*/g, "").replace(/^💸\s*/, ""),
        body: text,
        action_url: `/app/divisao-do-role/${String(m.job.shared_expense_id)}`,
        dedup_key: `split-job:${m.job.id}:app`,
      }, { onConflict: "user_id,dedup_key" });
      // A mensagem já está na fila: falha do aviso no app não pode desfazer o agrupamento (evita envio em duplicidade).
      if (error) console.error(JSON.stringify({ event: "split_group_notification_failed", error: String(error.message).slice(0, 160) }));
      else result.appDelivered++;
    }
    await sb.from("reminder_jobs").update({ status: "enqueued", outbound_message_id: outboundId, last_error: null, lease_expires_at: null }).eq("id", m.job.id);
    await sb.from("shared_expense_participants").update({
      last_reminded_at: new Date().toISOString(),
      reminder_count: Number(m.participant.reminder_count ?? 0) + 1,
    }).eq("id", m.participant.id);
    await sb.from("shared_expense_events").insert({
      shared_expense_id: m.job.shared_expense_id,
      owner_user_id: group.ownerUserId,
      participant_id: m.job.participant_id,
      event_type: "message_enqueued",
      payload: { kind: group.kind, job_id: m.job.id, outbound_message_id: outboundId, grouped: true, group_size: valid.length, worker: "v2" },
    });
    result.finalized.push(m.job.id);
  }
  return result;
}
