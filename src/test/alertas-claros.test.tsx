import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { failureExplained, jobProblemText, messageKindLabel } from "@/lib/admin/plainLanguage";
import { buildAttention, servicesAttention } from "@/lib/admin/commandCenter";

const retry = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/admin/messageCenter", () => ({
  fetchMessages: async () => [
    { id: "m1", created_at: "2026-11-02T13:19:00Z", kind: "split_payment_confirmation", last_error: "ack_stalled_no_delivery", recipient: "+55 11 9****-1234" },
  ],
  reprocessMessage: (id: string) => retry(id),
}));

describe("linguagem simples dos avisos", () => {
  it("o motivo técnico vira explicação, com o que significa e o que fazer", () => {
    const e = failureExplained("ack_stalled_no_delivery");
    expect(e.what).toMatch(/nunca confirmou que ela chegou ao celular/);
    expect(e.means).toMatch(/Não indica falha do Nino/);
    expect(e.todo).toMatch(/Tentar de novo/);
    expect(failureExplained("algo_novo").what).toMatch(/algo novo/);
  });
  it("tipo de mensagem em português", () => {
    expect(messageKindLabel("split_payment_confirmation")).toBe("Confirmação de pagamento de uma divisão de conta");
    expect(messageKindLabel("tipo_desconhecido")).toBe("tipo desconhecido");
  });
  it("rotina sem registro não vira 'urgente: parou'; diz o que ela faz e o que muda se parar", () => {
    const t = jobProblemText("Limpeza de eventos antigos", "product_events_prune", null, false);
    expect(t.title).toBe("A rotina “Limpeza de eventos antigos” ainda não registrou nenhuma execução");
    expect(t.detail).toMatch(/Apaga, uma vez por dia/);
    expect(t.detail).toMatch(/não necessariamente parada/);
    expect(t.title + t.detail).not.toMatch(/verifique o agendamento|execução comprovada/i);
  });
  it("rotina parada há horas e rotina que falhou têm textos próprios", () => {
    expect(jobProblemText("Envios", "whatsapp-send", 30, false).title).toMatch(/não roda há 30 h/);
    expect(jobProblemText("Envios", "whatsapp-send", 2, true, "timeout_x").detail).toMatch(/timeout x/);
  });
  it("o alerta de mensagens não entregues explica e abre o detalhe no lugar (sem mandar para outra tela)", () => {
    const data: any = {
      totals: { turns: 0, err_rate: 0, p95: null, p50: null, p50_prev: null, cost: 0, cost_prev: 0, fallback_rate: 0 },
      by_model: [], top_errors: [], daily: [], by_channel: [], by_path: [], window_days: 7,
      messaging: { total: 640, sent: 600, delivered: 166, failed: 2, stuck_queue: 0, daily: [], fail_reasons: [{ reason: "ack_stalled_no_delivery", n: 2 }] },
    };
    const item = buildAttention(data).find((i) => i.key === "delivery_failed")!;
    expect(item.title).toBe("2 mensagens do Nino não chegaram ao celular");
    expect(item.detail).not.toMatch(/ack_stalled/);
    expect(item.expand).toBe("undelivered");
    expect(item.to).toBeUndefined();
  });
  it("serviços: texto novo no alerta de rotina", () => {
    const items = servicesAttention([{ job_key: "product_events_prune", last_run_at: null, next_run_at: null, last_ok: null, processed: 0, failed: 0, last_error_code: null }], () => "Limpeza de eventos antigos");
    expect(items[0].detail).toMatch(/Apaga, uma vez por dia/);
  });
});

describe("mensagens não entregues, no próprio alerta", () => {
  it("mostra o que aconteceu, o que fazer e pede o reenvio", async () => {
    const { UndeliveredMessages } = await import("@/components/admin/UndeliveredMessages");
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><UndeliveredMessages /></MemoryRouter></QueryClientProvider>);
    const box = await screen.findByTestId("undelivered-messages");
    expect(box).toHaveTextContent("Confirmação de pagamento de uma divisão de conta");
    expect(box).toHaveTextContent("O que aconteceu:");
    expect(box).toHaveTextContent("O que fazer:");
    screen.getByText("Tentar de novo").click();
    await waitFor(() => expect(retry).toHaveBeenCalledWith("m1"));
  });
});

describe("frequência da checagem do WhatsApp e lugar do bloco", () => {
  const edge = readFileSync("supabase/functions/ops-alerts-tick/index.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261106160000_alertas_claros.sql", "utf8");
  it("a checagem de rede respeita o intervalo configurado (padrão 12 h) e só acelera com aviso aberto", () => {
    expect(sql).toMatch(/waha_check_hours integer not null default 12/);
    expect(sql).toMatch(/between 1 and 168/);
    expect(edge).toMatch(/Boolean\(state\.open\) \|\| !last \|\| Date\.now\(\) - last >= hours \* 3_600_000/);
    expect(edge).toContain('rpc("ops_waha_check_mark")');
  });
  it("as checagens baratas de banco seguem a cada ciclo; só a de rede é espaçada", () => {
    expect(edge).toMatch(/rpc\("ops_alerts_evaluate"\)/);
    expect(edge.indexOf("ops_alerts_evaluate")).toBeLessThan(edge.indexOf("ops_waha_check_state"));
  });
  it("a limpeza de eventos grava o registro de execução (fim do falso 'urgente')", () => {
    expect(sql).toMatch(/insert into public\.job_heartbeats[\s\S]*product_events_prune/);
  });
  it("o bloco de configuração dos avisos saiu da home e foi para Configurações", () => {
    const home = readFileSync("src/pages/admin/CentralDeComando.tsx", "utf8");
    const cfg = readFileSync("src/pages/admin/Configuracoes.tsx", "utf8");
    expect(home).not.toContain("<OpsAlertsPanel");
    expect(cfg).toContain("<OpsAlertsPanel />");
  });
});
