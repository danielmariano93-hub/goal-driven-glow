import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseSummaryIntent } from "../../supabase/functions/_shared/summaries/intents";
import { buildWeeklySummary } from "../../supabase/functions/_shared/summaries/weekly";
import { buildMonthlySummary } from "../../supabase/functions/_shared/summaries/monthly";
import { renderSummaryPdf } from "../../supabase/functions/_shared/summaries/render";
import { weeklyInput, monthlyInput } from "./fixtures/summaryFixtures";

// O pipeline importa o motor do servidor; aqui só as funções puras dele.
const pipeline = () => import("../../supabase/functions/_shared/summaries/pipeline");

describe("pedidos e comandos pelo WhatsApp", () => {
  const today = "2026-11-26"; // quinta-feira
  it.each([
    ["me manda meu resumo financeiro", { kind: "request", type: "monthly", month: "2026-11", label: "current" }],
    ["resumo da semana", { kind: "request", type: "weekly", weekStart: "2026-11-23", label: "current" }],
    ["quero o resumo da última semana", { kind: "request", type: "weekly", weekStart: "2026-11-16", label: "previous" }],
    ["fechamento de outubro", { kind: "request", type: "monthly", month: "2026-10", label: "closed" }],
    ["resumo de dezembro", { kind: "request", type: "monthly", month: "2025-12", label: "closed" }],
    ["me manda o resumo do mês passado", { kind: "request", type: "monthly", month: "2026-10", label: "closed" }],
    ["reenvie", { kind: "resend" }],
    ["reenvia o resumo", { kind: "resend" }],
  ])("%s", (text, expected) => {
    expect(parseSummaryIntent(text, today)).toMatchObject(expected);
  });
  it("ambíguo pergunta uma vez", () => {
    expect(parseSummaryIntent("resumo", today)?.kind).toBe("clarify");
  });
  it("preferências", () => {
    expect(parseSummaryIntent("pare de enviar resumos", today)).toMatchObject({ kind: "prefs", weekly: false, monthly: false });
    expect(parseSummaryIntent("desative semanal", today)).toMatchObject({ kind: "prefs", weekly: false });
    expect(parseSummaryIntent("ative mensal", today)).toMatchObject({ kind: "prefs", monthly: true });
    expect(parseSummaryIntent("ative o resumo mensal", today)).toMatchObject({ kind: "prefs", monthly: true });
    expect(parseSummaryIntent("mude para 9h", today)).toMatchObject({ kind: "prefs", hour: 9 });
    expect(parseSummaryIntent("muda o horário dos resumos para as 23h", today)?.kind).toBe("clarify");
  });
  it("não rouba conversa comum nem perguntas analíticas", () => {
    for (const t of ["gastei 30 no mercado", "quanto gastei esse mês?", "manda o relatório de gastos com mercado", "obrigado", "qual meu saldo?", "comparar outubro com setembro"]) {
      expect(parseSummaryIntent(t, today)).toBeNull();
    }
  });
});

describe("transporte do PDF (WAHA de teste)", () => {
  const calls: Array<{ url: string; body: any }> = [];
  beforeAll(() => {
    vi.stubGlobal("Deno", { env: { get: (k: string) => ({ WAHA_API_URL: "https://waha.test", WAHA_API_KEY: "chave-teste", WAHA_SESSION: "nino-teste", WAHA_WEBHOOK_SECRET: "segredo" } as Record<string, string>)[k] } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "true_5511999999999@c.us_ABC123" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }));
  });
  afterEach(() => { calls.length = 0; });

  it("envia o PDF como documento com nome, tipo e legenda sem números sensíveis", async () => {
    const { wahaProvider } = await import("../../supabase/functions/_shared/messaging/waha");
    const { captionFor, fileNameFor } = await pipeline();
    const dto = buildWeeklySummary(weeklyInput());
    const pdf = await renderSummaryPdf(dto);
    expect(pdf.pages).toBe(1);
    const r = await wahaProvider.sendFile!("+55 11 99999-9999", { url: "https://storage.test/signed/abc.pdf?token=curto", mimetype: "application/pdf", filename: fileNameFor(dto) }, captionFor(dto));
    expect(r.provider_message_id).toBe("true_5511999999999@c.us_ABC123");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://waha.test/api/sendFile");
    expect(calls[0].body).toEqual({
      session: "nino-teste", chatId: "5511999999999@c.us",
      file: { mimetype: "application/pdf", filename: "Nino-resumo-semana-2026-11-16.pdf", url: "https://storage.test/signed/abc.pdf?token=curto" },
      caption: "Seu resumo financeiro de 16 a 22/11 está pronto. Segue o PDF.",
    });
    expect(calls[0].body.caption).not.toMatch(/R\$|http/);
  });

  it("legendas do mensal (fechado e parcial)", async () => {
    const { captionFor, fileNameFor } = await pipeline();
    const closed = buildMonthlySummary(monthlyInput());
    expect(captionFor(closed)).toBe("Seu fechamento de outubro está pronto. Segue o PDF.");
    expect(fileNameFor(closed)).toBe("Nino-resumo-2026-10.pdf");
    const partial = buildMonthlySummary(monthlyInput({ month: "2026-11", asOf: "2026-11-26" }));
    expect(captionFor(partial)).toBe("Seu resumo financeiro de novembro até 26/11 está pronto. Segue o PDF.");
    const week = buildWeeklySummary(weeklyInput({ weekStart: "2026-11-23", asOf: "2026-11-26" }));
    expect(captionFor(week)).toBe("Seu resumo financeiro da semana (23 a 26/11) está pronto. Segue o PDF.");
  });

  it("chave de deduplicação: usuário + tipo + período + canal (parcial inclui o dia do corte)", async () => {
    const { dedupeKey } = await pipeline();
    expect(dedupeKey("u1", buildWeeklySummary(weeklyInput()), "whatsapp")).toBe("u1:weekly:2026-11-16:whatsapp");
    expect(dedupeKey("u1", buildWeeklySummary(weeklyInput({ weekStart: "2026-11-23", asOf: "2026-11-26" })), "whatsapp")).toBe("u1:weekly:2026-11-23@2026-11-26:whatsapp");
  });

  it("período padrão: semana fechada anterior e mês fechado anterior", async () => {
    const { defaultPeriod } = await pipeline();
    expect(defaultPeriod("weekly", "2026-11-23")).toEqual({ type: "weekly", weekStart: "2026-11-16" });
    expect(defaultPeriod("monthly", "2026-12-02")).toEqual({ type: "monthly", month: "2026-11" });
    expect(defaultPeriod("monthly", "2027-01-02")).toEqual({ type: "monthly", month: "2026-12" });
  });
});
