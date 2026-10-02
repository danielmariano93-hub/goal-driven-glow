// Central de comando do admin: tipos do RPC admin_v4_command_center, regras de
// "o que precisa de ação agora" e formatadores. Tudo puro para ser testável.

export type CcTotals = {
  turns: number; turns_prev: number;
  users: number; users_prev: number;
  err_rate: number; err_rate_prev: number;
  p50: number | null; p95: number | null; p50_prev: number | null; p95_prev: number | null;
  tin: number; tout: number; tok_prev: number;
  cost: number; cost_prev: number;
  llm_share: number; fallback_rate: number;
};
export type CcDaily = { day: string; turns: number; errors: number; p50: number | null; p95: number | null; tokens_in: number; tokens_out: number; cost_usd: number; users: number };
export type CcPath = { path: string; turns: number; p95: number | null; error_rate: number };
export type CcModel = {
  model: string; turns: number; p50: number | null; p95: number | null; tokens: number; cost_usd: number; error_rate: number;
  /** Quantas vezes foi o primeiro modelo tentado. */
  attempts: number;
  /** Em quantas dessas o Nino precisou trocar de modelo. */
  failed_first: number;
  escalated: number;
  first_try_failure_rate: number | null;
};
export type CcChannel = { channel: string; turns: number; p95: number | null; error_rate: number };
export type CcError = { reason: string; n: number; last_at: string; sample: string | null };
export type CcMessaging = {
  total: number; sent: number; delivered: number; failed: number; stuck_queue: number;
  daily: Array<{ day: string; sent: number; delivered: number; failed: number }>;
  fail_reasons: Array<{ reason: string; n: number }>;
};
export type CommandCenterData = {
  from: string; to: string; granularity: "hour" | "day"; window_days: number; generated_at: string; cost_note: string;
  totals: CcTotals; daily: CcDaily[]; by_path: CcPath[]; by_model: CcModel[]; by_channel: CcChannel[];
  top_errors: CcError[]; messaging: CcMessaging;
};

export type AttentionItem = {
  key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  /** Rota do admin onde a pessoa age. */
  to?: string;
};

export const LIMITS = {
  /** Abaixo disso a amostra não sustenta alarme de taxa. */
  minTurnsForRates: 20,
  errorRateWarn: 0.1,
  errorRateCritical: 0.25,
  p95WarnMs: 10_000,
  p95CriticalMs: 20_000,
  fallbackWarn: 0.1,
  latencyWorsePct: 40,
  costWorsePct: 50,
} as const;

/** Variação percentual; null quando não há base. */
export function pctDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
export const formatPct = pct;
/** "openai/gpt-oss-120b" → "gpt-oss-120b". */
export const modelName = (id: string) => id.replace(/^[^/]+\//, "");

/** Converte datas do filtro (dia civil de São Paulo) em instantes para o RPC. */
export function rangeToInstants(range: { from: string; to: string }, now: Date = new Date()): { p_from: string; p_to: string } {
  const start = new Date(`${range.from}T00:00:00-03:00`);
  const endOfDay = new Date(`${range.to}T23:59:59.999-03:00`);
  const end = endOfDay.getTime() > now.getTime() ? now : endOfDay;
  return { p_from: start.toISOString(), p_to: end.toISOString() };
}
export const formatMs = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(v)} ms`);
export const formatInt = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
export const formatCompact = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v));
export const formatUsd = (v: number | null | undefined) =>
  v == null ? "—" : v < 1 ? `US$ ${v.toFixed(4).replace(".", ",")}` : `US$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

const ERROR_LABEL: Record<string, string> = {
  semantic_unsupported: "Pergunta fora do que o Nino consegue consultar",
  contract_fulfillment_blocked: "Resposta barrada por não bater com os dados",
  conversation_brain_gateway_429: "Provedor de IA limitou as chamadas (429)",
  conversation_brain_gateway_413: "Mensagem grande demais para o provedor",
  semantic_contract_failed_closed: "Interpretação da pergunta falhou",
  conversation_brain_contract_invalid: "Resposta do modelo fora do formato",
  semantic_gate_blocked: "Resposta bloqueada pelos gates de verdade",
  needs_description: "Lançamento sem descrição",
  account_not_found: "Conta não encontrada ao registrar",
};
export const errorLabel = (reason: string) => ERROR_LABEL[reason] ?? reason.replace(/_/g, " ");

const PATH_LABEL: Record<string, string> = {
  llm: "Conversa com IA",
  deterministic_tool: "Consulta direta",
  deterministic_fallback: "Plano B (sem IA)",
  fast_log: "Registro rápido",
  confirmation_fast_path: "Confirmação rápida",
  structured_entry_fast_path: "Lançamento estruturado",
};
export const pathLabel = (path: string) => PATH_LABEL[path] ?? path.replace(/_/g, " ");

export type OpsService = {
  job_key: string;
  last_run_at: string | null;
  next_run_at: string | null;
  last_ok: boolean | null;
  processed: number;
  failed: number;
  last_error_code: string | null;
};

const STALE_MS = 24 * 3_600_000;

export function serviceState(s: OpsService, now: number = Date.now()): "ok" | "stale" | "failing" {
  if (!s.last_run_at) return "stale";
  const age = now - Date.parse(s.last_run_at);
  if (Number.isFinite(age) && age > STALE_MS) return "stale";
  if (s.last_ok === false || s.failed > 0) return "failing";
  return "ok";
}

/** Rotinas do sistema (cron/workers) que pararam ou estão falhando. */
export function servicesAttention(services: OpsService[], label: (key: string) => string, now: number = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of services) {
    const st = serviceState(s, now);
    if (st === "ok") continue;
    const hours = s.last_run_at ? Math.round((now - Date.parse(s.last_run_at)) / 3_600_000) : null;
    items.push({
      key: `service_${s.job_key}`,
      severity: st === "stale" ? "critical" : "warning",
      title: st === "stale"
        ? `${label(s.job_key)} sem execução ${hours == null ? "comprovada" : `há ${hours} h`}`
        : `${label(s.job_key)} falhou na última execução`,
      detail: s.last_error_code ? `Erro: ${s.last_error_code}.` : st === "stale" ? "A rotina pode ter parado. Verifique o agendamento." : `${s.failed} item(ns) com falha.`,
    });
  }
  return items;
}

/** O que exige ação agora, do mais grave ao menos grave. Nunca devolve ruído. */
export function buildAttention(data: CommandCenterData, extra: AttentionItem[] = []): AttentionItem[] {
  const out: AttentionItem[] = [];
  const t = data.totals;
  const enough = t.turns >= LIMITS.minTurnsForRates;

  if (enough && t.err_rate >= LIMITS.errorRateWarn) {
    const worst = data.top_errors[0];
    out.push({
      key: "error_rate",
      severity: t.err_rate >= LIMITS.errorRateCritical ? "critical" : "warning",
      title: `${pct(t.err_rate)} das conversas falharam`,
      detail: worst
        ? `Maior causa: ${errorLabel(worst.reason)} (${worst.n}). Antes eram ${pct(t.err_rate_prev)}.`
        : `Antes eram ${pct(t.err_rate_prev)}.`,
      to: "/admin/nino-ia?aba=custo",
    });
  }
  const modelBad = data.by_model.find((m) => m.attempts >= 15 && (m.first_try_failure_rate ?? 0) >= 0.15);
  if (modelBad) {
    out.push({
      key: "model_error",
      severity: "warning",
      title: `${modelName(modelBad.model)} falha de primeira em ${pct(modelBad.first_try_failure_rate ?? 0)} das tentativas`,
      detail: `${modelBad.failed_first} de ${modelBad.attempts} vezes o Nino precisou trocar de modelo. Vale revisar o modelo principal.`,
      to: "/admin/nino-ia?aba=modelos",
    });
  }
  if (t.p95 != null && t.p95 >= LIMITS.p95WarnMs) {
    out.push({
      key: "latency_p95",
      severity: t.p95 >= LIMITS.p95CriticalMs ? "critical" : "warning",
      title: `As 5% mais lentas passam de ${formatMs(t.p95)}`,
      detail: `A mediana é ${formatMs(t.p50)}. Veja qual caminho ou modelo está puxando o tempo.`,
      to: "/admin/nino-ia?aba=custo",
    });
  } else {
    const worse = pctDelta(t.p50, t.p50_prev);
    if (enough && worse != null && worse >= LIMITS.latencyWorsePct) {
      out.push({
        key: "latency_trend",
        severity: "info",
        title: `A resposta ficou ${Math.round(worse)}% mais lenta`,
        detail: `Mediana foi de ${formatMs(t.p50_prev)} para ${formatMs(t.p50)}.`,
        to: "/admin/nino-ia?aba=custo",
      });
    }
  }
  if (enough && t.fallback_rate >= LIMITS.fallbackWarn) {
    out.push({
      key: "fallback",
      severity: "warning",
      title: `${pct(t.fallback_rate)} das respostas caíram no plano B`,
      detail: "O modelo principal não conseguiu responder e o Nino usou a resposta sem IA.",
      to: "/admin/nino-ia?aba=modelos",
    });
  }
  const costWorse = pctDelta(t.cost, t.cost_prev);
  if (costWorse != null && costWorse >= LIMITS.costWorsePct && t.cost >= 0.5) {
    out.push({
      key: "cost",
      severity: "info",
      title: `Custo estimado subiu ${Math.round(costWorse)}%`,
      detail: `De ${formatUsd(t.cost_prev)} para ${formatUsd(t.cost)} no período.`,
      to: "/admin/nino-ia?aba=custo",
    });
  }
  const m = data.messaging;
  if (m.failed > 0) {
    const share = m.total > 0 ? m.failed / m.total : 0;
    out.push({
      key: "delivery_failed",
      severity: share >= 0.1 ? "critical" : "warning",
      title: `${m.failed} mensagen${m.failed === 1 ? "" : "s"} não ${m.failed === 1 ? "foi entregue" : "foram entregues"}`,
      detail: m.fail_reasons[0] ? `Motivo mais comum: ${m.fail_reasons[0].reason}.` : "Veja o motivo na central de mensagens.",
      to: "/admin/comunicacoes?aba=mensagens",
    });
  }
  if (m.stuck_queue > 0) {
    out.push({
      key: "stuck_queue",
      severity: "critical",
      title: `${m.stuck_queue} mensagen${m.stuck_queue === 1 ? "" : "s"} parada${m.stuck_queue === 1 ? "" : "s"} na fila há mais de 15 min`,
      detail: "O envio pode estar travado. Verifique o canal do WhatsApp.",
      to: "/admin/comunicacoes?aba=mensagens",
    });
  }
  out.push(...extra);
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
