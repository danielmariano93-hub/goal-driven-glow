// `nino_confirmation.v1` — fixtures A–J do fast path de confirmação,
// parser bancário fail-closed, budgets de rota e regressões de correção.
import { describe, it, expect } from "vitest";
import {
  classifyConfirmationAct, normalizeConfirmationText, isStrongConfirmationAct,
} from "../../supabase/functions/_shared/agent/core/ConfirmationVocabulary.ts";
import { parseBankNotification } from "../../supabase/functions/_shared/agent/core/BankNotificationParser.ts";
import { budgetFor, isZeroLlmRoute, BACKEND_LATENCY_TARGETS } from "../../supabase/functions/_shared/agent/core/TurnBudget.ts";
import { resolvePendingState, runConfirmationFastPath, isFalseCapabilityDenial } from "../../supabase/functions/_shared/agent/core/ConfirmationFastPath.ts";
import { isSemanticReadEligible } from "../../supabase/functions/_shared/agent/core/SemanticRouting.ts";
import { applyMessageContract, renderWhatsappMessage } from "../../supabase/functions/_shared/agent/core/MessageContract.ts";
import { interpret } from "../../supabase/functions/_shared/agent/parser.ts";

// ---------------------------------------------------------------- fake client
type Row = {
  id: string; kind: string; payload: unknown; summary_text: string;
  status: string; expires_at: string; user_id: string; conversation_id: string;
};

function fakeSb(rows: Row[], hooks: { onRpc?: (name: string) => unknown } = {}) {
  const state = { rows, rpcCalls: [] as string[] };
  const client: any = {
    from(_table: string) {
      const q: any = {
        _mode: "select", _filters: {} as Record<string, unknown>, _patch: null as any,
        select() { return q; },
        update(patch: any) { q._mode = "update"; q._patch = patch; return q; },
        eq(col: string, val: unknown) { q._filters[col] = val; return q; },
        gt(col: string, val: unknown) { q._filters[`gt:${col}`] = val; return q; },
        order() { return q; },
        limit() { return q; },
        maybeSingle() { return Promise.resolve({ data: q._run()[0] ?? null, error: null }); },
        then(resolve: any) { return Promise.resolve({ data: q._run(), error: null }).then(resolve); },
        _run() {
          let out = state.rows.filter((r) =>
            Object.entries(q._filters).every(([col, val]) => {
              if (col.startsWith("gt:")) {
                const key = col.slice(3) as keyof Row;
                return new Date(String(r[key])).getTime() > new Date(String(val)).getTime();
              }
              return (r as any)[col] === val;
            })
          );
          if (q._mode === "update") {
            out = out.map((r) => Object.assign(r, q._patch));
          }
          return out;
        },
      };
      return q;
    },
    rpc(name: string, _args: unknown) {
      state.rpcCalls.push(name);
      const out = hooks.onRpc ? hooks.onRpc(name) : { ok: true, result: { transaction_id: "tx-1" } };
      return Promise.resolve({ data: out, error: null });
    },
    _state: state,
  };
  return client;
}

const future = () => new Date(Date.now() + 600_000).toISOString();
const past = () => new Date(Date.now() - 600_000).toISOString();
const pending = (over: Partial<Row> = {}): Row => ({
  id: "p1", kind: "transaction", payload: { type: "expense", amount: 6 },
  summary_text: "Despesa de R$ 6,00", status: "pending", expires_at: future(),
  user_id: "u1", conversation_id: "c1", ...over,
});

// ------------------------------------------------------------------ A) vocab
describe("A) vocabulário de confirmação", () => {
  it("reconhece salvar/registra/lança como confirmação", () => {
    for (const t of ["Salvar", "salva isso", "pode salvar", "registra", "lança", "confirma", "sim", "ok", "👍"]) {
      expect(classifyConfirmationAct(t)).toBe("confirm");
    }
  });
  it("reconhece cancelamento e negação explícita de escrita", () => {
    for (const t of ["cancela", "não", "não salva", "esquece", "não era isso", "❌"]) {
      expect(classifyConfirmationAct(t)).toBe("cancel");
    }
  });
  it("não confunde leitura com confirmação", () => {
    for (const t of ["pode me dizer quanto gastei", "qual meu saldo", "quanto sobrou esse mês"]) {
      expect(classifyConfirmationAct(t)).toBe("unrelated");
    }
  });
  it("marca hesitação como ambígua", () => {
    expect(classifyConfirmationAct("acho que sim")).toBe("ambiguous");
  });
  it("normaliza acento, emoji e pontuação", () => {
    expect(normalizeConfirmationText("Não!! 👍")).toContain("nao");
    expect(isStrongConfirmationAct("SALVAR.")).toBe(true);
  });
  it("parser compartilha o mesmo vocabulário", () => {
    expect(interpret("salvar").kind).toBe("confirm");
    expect(interpret("registra").kind).toBe("confirm");
    expect(interpret("não salva").kind).toBe("cancel");
    expect(interpret("gastei 42,90 no almoço").kind).toBe("transaction");
  });
});

// ------------------------------------------------------- B–E) estados pending
describe("B–E) estados da pendência", () => {
  it("B) rascunho fresco: confirma e executa uma vez", async () => {
    const sb = fakeSb([pending()]);
    const out = await runConfirmationFastPath(sb, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-1", text: "Salvar",
    });
    expect(out.handled).toBe(true);
    expect(out.llm_calls).toBe(0);
    expect(sb._state.rpcCalls).toEqual(["agent_execute_transaction_confirmation_v2"]);
  });

  it("C) expirado: resposta específica, sem análise", async () => {
    const sb = fakeSb([pending({ expires_at: past() })]);
    const { state } = await resolvePendingState(sb, "c1", "u1");
    expect(state).toBe("expired");
    const out = await runConfirmationFastPath(sb, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-2", text: "salvar",
    });
    expect(out.reply_kind).toBe("expired");
    expect(out.reply).toMatch(/expirou/i);
    expect(sb._state.rpcCalls).toEqual([]);
  });

  it("D) já confirmado: não confirma de novo", async () => {
    const sb = fakeSb([pending({ status: "confirmed" })]);
    const out = await runConfirmationFastPath(sb, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-3", text: "salvar",
    });
    expect(out.pending_state).toBe("confirmed");
    expect(out.reply).toMatch(/já está salvo/i);
    expect(sb._state.rpcCalls).toEqual([]);
  });

  it("E) cancelado responde; sem rascunho algum o turno segue no pipeline", async () => {
    const cancelled = fakeSb([pending({ status: "cancelled" })]);
    const a = await runConfirmationFastPath(cancelled, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-4", text: "salvar",
    });
    expect(a.pending_state).toBe("cancelled");
    expect(a.handled).toBe(true);
    const none = fakeSb([]);
    const b = await runConfirmationFastPath(none, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-5", text: "salvar",
    });
    expect(b.pending_state).toBe("none");
    expect(b.handled).toBe(false);
    expect(b.reply).not.toBe(a.reply);
  });

  it("E2) 'sim'/'tudo certo' sem pendência não vira beco sem saída", async () => {
    for (const text of ["sim", "pode", "tudo certo", "beleza", "não"]) {
      const out = await runConfirmationFastPath(fakeSb([]), {
        user_id: "u1", conversation_id: "c1", inbound_message_id: "in-x", text,
      });
      expect(out.handled).toBe(false);
      expect(out.reply).toBe("");
    }
  });

  it("E3) rascunho antigo já resolvido não sequestra um 'sim' de conversa", async () => {
    const old = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const out = await runConfirmationFastPath(
      fakeSb([pending({ status: "confirmed", expires_at: old })]),
      { user_id: "u1", conversation_id: "c1", inbound_message_id: "in-6", text: "pode" },
    );
    expect(out.handled).toBe(false);
  });

});

// ------------------------------------------------------- F) corrida/idempotência
describe("F) idempotência", () => {
  it("dois inbounds diferentes confirmando a mesma pendência", async () => {
    let calls = 0;
    const sb = fakeSb([pending()], {
      onRpc: () => {
        calls += 1;
        return calls === 1
          ? { ok: true, result: { transaction_id: "tx-1" } }
          : { ok: true, idempotent: true, result: { transaction_id: "tx-1" } };
      },
    });
    const [r1, r2] = await Promise.all([
      runConfirmationFastPath(sb, { user_id: "u1", conversation_id: "c1", inbound_message_id: "in-a", text: "Salvar" }),
      runConfirmationFastPath(sb, { user_id: "u1", conversation_id: "c1", inbound_message_id: "in-b", text: "Sim" }),
    ]);
    expect(r1.handled && r2.handled).toBe(true);
    expect(calls).toBeLessThanOrEqual(2);
    expect(r1.reply_kind === "receipt" || r2.reply_kind === "receipt").toBe(true);
  });

  it("cancelar duas vezes responde de forma idempotente", async () => {
    const sb = fakeSb([pending()]);
    const first = await runConfirmationFastPath(sb, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-c", text: "cancela",
    });
    expect(first.reply_kind).toBe("cancelled");
    const again = await runConfirmationFastPath(sb, {
      user_id: "u1", conversation_id: "c1", inbound_message_id: "in-d", text: "cancela",
    });
    expect(again.pending_state).toBe("cancelled");
    expect(sb._state.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------- G) parser bancário
describe("G) parser de notificação bancária", () => {
  it("saída concluída é rascunhável", () => {
    const ev = parseBankNotification("Você fez um Pix de R$ 6,00 para Padaria Central em 10/09/2026.");
    expect(ev.event_class).toBe("completed_outflow");
    expect(ev.draftable).toBe(true);
    expect(ev.amount).toBeCloseTo(6);
  });
  it("entrada concluída é rascunhável como receita", () => {
    const ev = parseBankNotification("Você recebeu um Pix de R$ 1.200,00 de Lucas Silva hoje.");
    expect(ev.event_class).toBe("completed_inflow");
    expect(ev.draftable).toBe(true);
  });
  it("fail-closed nos casos não concluídos", () => {
    const negatives = [
      "Pix agendado de R$ 90,00 para amanhã",
      "Compra recusada no valor de R$ 42,00",
      "Transação cancelada de R$ 30,00",
      "Estorno de R$ 20,00 recebido",
      "Devolução de R$ 15,00 processada",
      "Pagamento de fatura do cartão no valor de R$ 500,00",
      "Transferência entre suas contas de R$ 100,00",
      "Sua transação está em processamento",
    ];
    for (const t of negatives) {
      expect(parseBankNotification(t).draftable, t).toBe(false);
    }
  });
  it("não inventa conta sem evidência única", () => {
    const ev = parseBankNotification("Pix de R$ 10,00 enviado para João");
    expect(ev.account_hint ?? null).toBeNull();
  });
});

// ------------------------------------------------------ H) budgets e latência
describe("H) budgets de rota", () => {
  it("confirmação e lançamento estruturado são rotas de zero LLM", () => {
    expect(isZeroLlmRoute("confirmation")).toBe(true);
    expect(isZeroLlmRoute("structured_entry")).toBe(true);
    expect(budgetFor("confirmation").max_llm_calls).toBe(0);
    expect(budgetFor("financial_analysis").max_llm_calls).toBeGreaterThan(0);
  });
  it("metas de backend estão separadas da latência do provedor", () => {
    expect(BACKEND_LATENCY_TARGETS.confirmation_fast_path).toEqual({ p50: 1000, p95: 2000 });
    expect(BACKEND_LATENCY_TARGETS.structured_entry_fast_path).toEqual({ p50: 2000, p95: 3000 });
  });
});

// ------------------------------------------- I) roteamento e negação falsa
describe("I) roteamento protegido", () => {
  it("confirmação com pendência nunca é leitura semântica", () => {
    expect(isSemanticReadEligible({
      capability_name: "financial_read", acts: ["read"] as any, has_clarification: false,
      has_pending_confirmation: true, confirmation_act: "confirm",
    })).toBe(false);
  });
  it("negação falsa de capability é detectada", () => {
    expect(isFalseCapabilityDenial({
      reply: "Não consigo confirmar por aqui, finalize pelo app.",
      has_pending: true, executor_available: true, executor_called: false, executor_failed: false,
    })).toBe(true);
    expect(isFalseCapabilityDenial({
      reply: "Não consigo salvar agora, o registro falhou.",
      has_pending: true, executor_available: true, executor_called: true, executor_failed: true,
    })).toBe(false);
  });
});

// -------------------------------------------- J) regressões de comunicação
describe("J) regressões", () => {
  it("alerta no app mantém título; WhatsApp suprime quando coberto", () => {
    const title = "Banco Pan vence hoje";
    const body = "Banco Pan vence hoje: R$ 480,00.";
    expect(applyMessageContract(title, body).title).toBe(title);
    expect(renderWhatsappMessage(title, body).message).not.toMatch(/^\*Banco Pan vence hoje\*\n\n\*?Banco Pan/);
  });
});
