/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures parciais */
// Seguimento de avisos do Nino: o aviso é o assunto, a explicação nasce dos fatos gravados e o
// alerta de caixa aponta o item que realmente causa o negativo.
import { describe, expect, it } from "vitest";
import {
  explainProactiveBody, loadRecentProactive, OUTBOUND_RECEIVED_STATUSES, proactiveContextBlock, sanitizeProactiveFacts,
} from "../../supabase/functions/_shared/agent/core/ProactiveExplain";
import { guardComposedReply } from "../../supabase/functions/_shared/agent/v3/ConversationalComposerV3";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { humanizeReply } from "../../supabase/functions/_shared/agent/core/ReplyHumanizer";
import { collectFinancialSignals } from "../../supabase/functions/_shared/proactive/signals";
import { composeFinancialSituations } from "../../supabase/functions/_shared/proactive/situations";

const NOW = Date.parse("2026-10-29T12:30:00Z");

function sbWithLatest(row: any | null | any[]) {
  const rows = Array.isArray(row) ? row : row ? [row] : [];
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, in: () => q, order: () => q,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => q } as any;
}

const cashRow = {
  id: "m1", kind: "proactive", status: "delivered", created_at: "2026-10-29T12:17:10Z",
  body: "*Caixa fica negativo em 26/11*\n\nSomando o que já está agendado, o saldo projetado chega a R$ 749,23 negativo em 26/11.",
  metadata: {
    suggestion_kind: "upcoming_cash_pressure",
    evidence: {
      as_of: "2026-10-29", formula_version: "x.v9", situation_id: "abc",
      signals: [{
        key: "commitment_cluster", label: "5 compromissos de R$ 5704,38 nos próximos 10 dias", amount: 5704.38,
        evidence: { items: [{ date: "2026-10-30", name: "Aluguel", amount: 3808.02, estimated: false }], source: "agenda", item_id: "zzz" },
      }],
    },
  },
};

describe("aviso recente como assunto do seguimento", () => {
  it("só ancora quando o aviso foi a última mensagem do Nino", async () => {
    expect((await loadRecentProactive(sbWithLatest(cashRow), "u", NOW))?.suggestion_kind).toBe("upcoming_cash_pressure");
    expect(await loadRecentProactive(sbWithLatest({ ...cashRow, kind: "agent" }), "u", NOW)).toBeNull();
    expect(await loadRecentProactive(sbWithLatest(null), "u", NOW)).toBeNull();
  });

  it("só filtra por status que existem no enum do banco (msg_status)", () => {
    // Um valor inexistente faz o banco recusar a consulta inteira e o aviso nunca é achado.
    const MSG_STATUS = ["queued", "processing", "sent", "delivered", "read", "failed", "dead"];
    for (const status of OUTBOUND_RECEIVED_STATUSES) expect(MSG_STATUS).toContain(status);
  });

  it("o espelho in-app e a notificação do aviso não escondem o aviso", async () => {
    const mirror = { ...cashRow, id: "m2", kind: "agent", surface: "app_assessor", created_at: "2026-10-29T12:17:10.500Z" };
    const notification = { ...cashRow, id: "m3", kind: "notification", surface: "app_notification", created_at: "2026-10-29T12:17:11Z" };
    const found = await loadRecentProactive(sbWithLatest([notification, mirror, cashRow]), "u", NOW);
    expect(found?.id).toBe("m1");
    // resposta do Nino depois do aviso (texto diferente): o aviso deixa de ser o assunto
    const reply = { ...cashRow, id: "m4", kind: "agent", body: "Claro! Seu saldo hoje é R$ 6.172,05.", created_at: "2026-10-29T12:20:00Z" };
    expect(await loadRecentProactive(sbWithLatest([reply, cashRow]), "u", NOW)).toBeNull();
  });

  it("fatos gravados perdem ids e campos internos", () => {
    const clean: any = sanitizeProactiveFacts(cashRow.metadata.evidence);
    const text = JSON.stringify(clean);
    expect(text).not.toMatch(/situation_id|formula_version|item_id/);
    expect(text).toContain("Aluguel");
  });

  it("corpo determinístico traz o texto, os itens e o que é estimado", async () => {
    const recent = (await loadRecentProactive(sbWithLatest(cashRow), "u", NOW))!;
    const body = explainProactiveBody(recent);
    expect(body).toContain("749,23");
    expect(body).toContain("Aluguel: R$ 3.808,02");
    expect(proactiveContextBlock(recent)).toMatchObject({ is_last_nino_message: true, kind: "proactive" });
  });

  it("trava de números: valor fora do aviso/fatos é barrado; valor do aviso passa", async () => {
    const recent = (await loadRecentProactive(sbWithLatest(cashRow), "u", NOW))!;
    const input: any = {
      kind: "explain", channel: "whatsapp", user_text: "me explica melhor", history: [],
      deterministic_body: explainProactiveBody(recent),
      evidence: [{ proactive_message: { text: recent.body, facts: recent.facts } }],
    };
    const ok = guardComposedReply({ text: "O caixa chega a R$ 749,23 negativo em 26/11; o Aluguel de R$ 3.808,02 é o maior item. Quer que eu detalhe?", input });
    expect(ok.violations.filter((v) => v.startsWith("number_not_in_evidence"))).toEqual([]);
    const bad = guardComposedReply({ text: "O caixa chega a R$ 749,23 negativo e você precisa guardar R$ 1.234,56.", input });
    expect(bad.violations.join(",")).toContain("number_not_in_evidence");
  });

  it("o interpretador pode emitir explain_message e a ponte o mantém", () => {
    const spec: any = {
      version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "follow_up",
      canonical_request: "explicar o aviso", inherit_topic: false, references: [],
      tasks: [{ kind: "advisory", family: "advisory", operation: "explain_message", periods: [], scenario: null, options: [] }],
    };
    for (const extended of [true, false]) {
      const out: any = bridgeTurnSpecV3ToRuntime(spec, new Date("2026-10-29T12:00:00Z"), { extended });
      expect(out.ok).toBe(true);
      expect(out.contract.advisory_kind).toBe("explain_message");
    }
  });
});

describe("texto dos avisos", () => {
  const horizonPoint = (date: string) => ({ date, balance: -749.23, inflow: 0, outflow: 801.58, labels: ["Doação · Dizimo"] });
  const ctx = (negDate: string, asOf = "2026-10-29"): any => ({
    version: "proactive_multifinance.v1", user_id: "u", as_of: asOf, monthly_income: 8330, materiality_floor: 166,
    available_today: 6172.05, projected_month_end_available: 2235, daily_pace: 100, typical_daily_pace: 100,
    cash_horizon: [horizonPoint(negDate)], first_negative_day: horizonPoint(negDate),
    snapshot_ref: { reconciliation_id: "r", formula_version: "financial_snapshot_contract.v9" },
    domains: {
      cash: { month_start: "2026-10-01", month_end: "2026-10-31", days_remaining: 2, known_future_commitments: 5704 },
      cards: {}, goals: [], debts: [], debt_obligations: [], debt_obligations_available: true, patterns: [],
      commitments: [
        { date: "2026-10-30", name: "Aluguel", amount: 3808.02, type: "expense", source: "planned", estimated: false, payment_status: "pending" },
        { date: "2026-11-01", name: "Fatura Cartão Itaú", amount: 129.9, type: "expense", source: "card_statement", estimated: false, payment_status: "pending" },
      ],
    },
    learning: {},
  });
  const body = (negDate: string) => {
    const c = ctx(negDate);
    const s = composeFinancialSituations(collectFinancialSignals(c), c).find((x) => x.type === "cash_shortfall_ahead");
    return s?.body ?? "";
  };

  it("negativo além dos 10 dias: aponta o item da data crítica, não o bloco de 10 dias", () => {
    const text = body("2026-11-26");
    expect(text).toContain("quando vence Doação · Dizimo");
    expect(text).not.toContain("O peso vem");
  });

  it("negativo dentro dos 10 dias: o bloco de compromissos é a causa", () => {
    expect(body("2026-11-04")).toContain("O peso vem");
  });

  it("marcador de modelo não preenchido nunca chega à pessoa", () => {
    expect(humanizeReply("Entendo a dúvida, *{usuário}*. O aviso veio da parcela.")).not.toMatch(/[{}]/);
  });
});
