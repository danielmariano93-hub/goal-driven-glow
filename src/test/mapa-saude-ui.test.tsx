import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MapaIndicator, MapaReading } from "@/lib/engine/mapaContracts";
import { MAPA_CONTRACT } from "@/lib/engine/mapaContracts";
import { changeText, indicatorText, reasonsText, REASON_CODES_FOR_TEST } from "@/lib/mapa/indicatorText";
import { buildMapaEvidencePack } from "@/lib/engine/mapaEvidencePack";

const win = { start: "2026-07-01", end: "2026-09-30", kind: "meses_fechados" as const, n: 3 };
const ind = (over: Partial<MapaIndicator> & Pick<MapaIndicator, "id" | "pillar">): MapaIndicator => ({
  layer: "saude", value: 1, unit: "razao", direction: "higher_better", status: "ok", confidence: "alta", window: win,
  evidence: ["ledger"], inputs: {}, reasons: [], formula_version: "t.v1", ...over,
});

describe("textos do Mapa", () => {
  it("usa unidade natural e nunca fala em nota", () => {
    const all: MapaIndicator[] = [
      ind({ id: "equilibrio.resultado_3m", pillar: "equilibrio", value: -1500, unit: "brl" }),
      ind({ id: "equilibrio.taxa_poupanca_3m", pillar: "equilibrio", value: 12.3, unit: "pct" }),
      ind({ id: "seguranca.meses_cobertos", pillar: "seguranca", value: 0.07, unit: "meses", inputs: { base: "gastos_totais", meta_meses: 6 } }),
      ind({ id: "dividas.comprometimento_renda", pillar: "dividas", value: 13.2, unit: "pct" }),
      ind({ id: "dividas.atrasos", pillar: "dividas", value: 2, unit: "contagem", inputs: { valor_em_atraso: 800 } }),
      ind({ id: "futuro.patrimonio_liquido", pillar: "futuro", value: -60335, unit: "brl" }),
      ind({ id: "futuro.resgates_90d", pillar: "futuro", value: 9000, unit: "brl", direction: "neutral", inputs: { resgates_90d: 9000, coincidem_com_divida: 2000, investido_hoje: 4000 } }),
    ];
    for (const i of all) {
      const t = indicatorText(i);
      expect(t.value).not.toMatch(/NaN|undefined|null/);
      expect(`${t.title} ${t.value} ${t.explain}`.toLowerCase()).not.toMatch(/\bnota\b|\bscore\b|\/\s*10/);
    }
    expect(indicatorText(all[0]).explain).toContain("Saiu R$ 1.500 a mais do que entrou");
    expect(indicatorText(all[2]).value).toBe("0,1 mês");
    expect(indicatorText(all[2]).explain).toContain("gastos totais");
    expect(indicatorText(all[4]).explain).toContain("2 dívidas em atraso");
  });

  it("tendência: o texto concorda com o selo (queda dentro do ruído não vira 'piorando')", () => {
    const base = ind({ id: "equilibrio.tendencia", pillar: "equilibrio", unit: "brl", direction: "higher_better", inputs: { desvio_resultado: 8108, significativa: 0 } });
    const noise = indicatorText({ ...base, value: -909.88, status: "ok" });
    expect(noise.value).toBe("Sem tendência clara"); // nunca mostra "−R$ 910 por mês" com selo verde
    expect(noise.explain).toMatch(/não dá para dizer que está melhorando ou piorando/);
    const clear = { ...base, inputs: { ...base.inputs, significativa: 1 } };
    expect(indicatorText({ ...clear, value: -5000, status: "atencao" }).value).toBe("−R$ 5.000 por mês");
    expect(indicatorText({ ...clear, value: -5000, status: "atencao" }).explain).toMatch(/piorando/);
  });

  it("indicador sem dados mostra traço, nunca zero", () => {
    const t = indicatorText(ind({ id: "dividas.custo_medio", pillar: "dividas", value: null, status: "sem_dados", confidence: "insuficiente" }));
    expect(t.value).toBe("—");
  });

  it("todo código de motivo emitido pelos motores tem frase em português", () => {
    for (const code of REASON_CODES_FOR_TEST) expect(reasonsText(ind({ id: "x.y", pillar: "equilibrio", reasons: [code] }))).toHaveLength(1);
  });
});

// ---- componente -------------------------------------------------------------------------------------------------
let flag = true;
const invoke = vi.fn();
const upserts: unknown[] = [];
const inserts: Array<{ table: string; row: any }> = [];
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/ui/feedback", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const table = (rows: unknown[], table = "") => {
    const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, then: (r: any) => r({ data: rows, error: null }), upsert: (v: unknown) => { upserts.push(v); return Promise.resolve({ error: null }); }, insert: (row: unknown) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); } };
    return q;
  };
  const tables: Record<string, unknown[]> = {
    categories: [{ id: "c1", name: "Moradia" }, { id: "c2", name: "Lazer" }], category_essential_flags: [], debts: [], investments: [],
  };
  return { supabase: { rpc: async () => ({ data: flag, error: null }), from: (t: string) => table(tables[t] ?? [], t), functions: { invoke: (...a: unknown[]) => invoke(...a) } } };
});

const reading = (indicators: MapaIndicator[], questions_due: MapaReading["questions_due"] = []): MapaReading => ({
  contract: MAPA_CONTRACT, as_of: "2026-10-16", indicators, recommendation: null, questions_due,
  data_quality: {} as MapaReading["data_quality"], income: {} as MapaReading["income"], structural: {} as MapaReading["structural"],
});

async function mount() {
  const { MapaEntender } = await import("@/components/mapa/MapaEntender");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MapaEntender /></MemoryRouter></QueryClientProvider>);
}

describe("MapaEntender", () => {
  beforeEach(() => { flag = true; invoke.mockReset(); upserts.length = 0; inserts.length = 0; });

  it("sem acesso: não renderiza nada nem chama o servidor", async () => {
    flag = false;
    const { container } = await mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });

  const essentialNeed = ind({ id: "seguranca.meses_cobertos", pillar: "seguranca", value: 0.07, unit: "meses", status: "critico", reasons: ["essential_flag_missing"], inputs: { base: "gastos_totais" }, needs: { kind: "capture", code: "essencial_categoria" } });
  const rateNeed = ind({ id: "dividas.custo_medio", pillar: "dividas", value: null, status: "sem_dados", confidence: "insuficiente", reasons: ["taxa_ou_periodo_ausente"], needs: { kind: "capture", code: "debt_rate" } });

  it("com acesso: mostra pilares de saúde e hábitos, expande 'de onde vem', sem pergunta quando nada está agendado", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([essentialNeed, rateNeed, ind({ id: "execucao.aderencia", pillar: "execucao", layer: "habitos", value: 80, unit: "pct", inputs: { cumpridos: 4, periodos: 5 } }), ind({ id: "planejamento.intencionalidade", pillar: "planejamento", layer: "habitos", value: 75, unit: "pct", direction: "neutral", inputs: { planejados: 6, respondidas: 8 } }), ind({ id: "acompanhamento.calibragem_total", pillar: "acompanhamento", layer: "habitos", value: 22.5, unit: "pct", direction: "lower_better", status: "atencao", reasons: ["exploratorio"], inputs: { vies_medio_pct: -2.5 } })]) }, error: null });
    await mount();
    expect(await screen.findByText("Quantos meses seu dinheiro cobre")).toBeInTheDocument();
    expect(screen.getByText("Precisa de cuidado")).toBeInTheDocument();
    expect(screen.getByText("Metas cumpridas")).toBeInTheDocument();
    expect(screen.getByText("Informativo")).toBeInTheDocument();       // intencionalidade é descritiva
    expect(screen.getByText("Em teste")).toBeInTheDocument();          // calibragem é exploratória
    fireEvent.click(screen.getByText("Quantos meses seu dinheiro cobre"));
    expect(screen.getByText(/ainda não marcou o que é essencial/)).toBeInTheDocument();
    expect(screen.queryByText(/Quais destes gastos/)).not.toBeInTheDocument(); // nada agendado: nenhuma pergunta imposta
  });

  it("o botão de 'o que falta' abre a captura por conta própria; 'Não sei dizer' fecha sem gravar nada", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([essentialNeed]) }, error: null });
    await mount();
    fireEvent.click(await screen.findByText("Quantos meses seu dinheiro cobre"));
    fireEvent.click(screen.getByRole("button", { name: "Marcar o que é essencial" }));
    expect(await screen.findByText(/Quais destes gastos você não consegue cortar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Não sei dizer" }));
    await waitFor(() => expect(screen.queryByText(/Quais destes gastos/)).not.toBeInTheDocument());
    expect(upserts).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("pergunta agendada: grava as flags (não marcadas = não essencial) e registra a resposta no orçamento de atenção", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([essentialNeed], [{ kind: "essencial_categoria", reason: "destrava_1_indicador", priority: 11 }]) }, error: null });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Moradia" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect((upserts[0] as Array<{ category_id: string; essential: boolean }>).map((r) => [r.category_id, r.essential])).toEqual([["c1", true], ["c2", false]]);
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0]).toMatchObject({ table: "map_questions", row: { kind: "essencial_categoria", channel: "app" } });
    expect(inserts[0].row.answered_at).toBeTruthy();
  });

  it("'Pular' e 'Depois' viram linhas em map_questions (pular = skipped_at; depois = due_at no futuro)", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([essentialNeed], [{ kind: "essencial_categoria", reason: "x", priority: 11 }]) }, error: null });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Pular" }));
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0].row.skipped_at).toBeTruthy();
    expect(upserts).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Depois" }));
    await waitFor(() => expect(inserts).toHaveLength(2));
    expect(inserts[1].row.skipped_at).toBeUndefined();
    expect(Date.parse(inserts[1].row.due_at)).toBeGreaterThan(Date.now() + 86_400_000);
  });

  it("estimativa mensal: nunca mostra o gasto real e grava mês, valor e categoria", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([], [{ kind: "estimativa_mensal", reason: "calibragem_do_mes_fechado", priority: 3 }]) }, error: null });
    await mount();
    expect(await screen.findByText(/Quanto você acha que gastou em setembro/)).toBeInTheDocument();
    expect(screen.getByText(/Não mostro o valor real agora/)).toBeInTheDocument();
    const answer = screen.getByRole("button", { name: "Responder" });
    expect(answer).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quanto você gastou em setembro/), { target: { value: "4.500,50" } });
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "c1" } });
    fireEvent.click(answer);
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0].row).toMatchObject({ kind: "estimativa_mensal", payload: { month: "2026-09", estimate: 4500.5, top_category_id: "c1" } });
  });

  it("erro do servidor: mensagem calma, sem quebrar a página", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("x") });
    await mount();
    expect(await screen.findByText(/Não consegui montar a leitura agora/, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  describe("Agir e Evoluir (fase 4)", () => {
    const withRec = () => {
      const r = reading([ind({ id: "seguranca.meses_cobertos", pillar: "seguranca", value: 0.5, unit: "meses", status: "critico", inputs: { base: "essenciais", meta_meses: 6 } })]);
      r.recommendation = { id: "comportamento:criar_reserva", kind: "comportamento", indicator_ids: ["seguranca.meses_cobertos"], rationale_keys: ["reserve_low"], action: { type: "criar_reserva", deeplink: "/app/metas" }, priority_score: 2.7, guardrails: [] };
      r.data_quality = { closed_months: 6 } as MapaReading["data_quality"];
      r.structural = { essential_share_of_income: null, debt_service_ratio: null, negative_result_streak: null, structural: false };
      return r;
    };
    const serve = (mapa: MapaReading, narrative?: unknown, hashOverride?: string) => {
      const evidence = buildMapaEvidencePack(mapa);
      invoke.mockImplementation(async (_n: string, opts: { body: { action: string } }) =>
        opts.body.action === "map" ? { data: { ok: true, mapa, evidence }, error: null }
          : { data: { ok: true, narrative, hash: hashOverride ?? evidence.hash }, error: null });
      return evidence;
    };

    it("mostra UMA recomendação com o texto determinístico, a evidência e a ação", async () => {
      const ev = serve(withRec());
      await mount();
      expect(await screen.findByText(ev.deterministic.title)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Criar uma meta de reserva/ })).toHaveAttribute("href", "/app/metas");
      expect(screen.getAllByRole("link", { name: /Criar uma meta de reserva/ })).toHaveLength(1);
      expect(screen.getByText("Por que estou dizendo isso")).toBeInTheDocument();
      expect(screen.queryByText(/escrito pelo Nino com IA/)).not.toBeInTheDocument();
    });

    it("a redação da IA substitui o texto quando chega com o mesmo hash, e avisa que é IA", async () => {
      serve(withRec(), { title: "Reserva curta", body: "Seu dinheiro cobre pouco tempo.", question: "Quer criar uma meta?", source: "llm" });
      await mount();
      expect(await screen.findByText("Reserva curta")).toBeInTheDocument();
      expect(screen.getByText(/Texto escrito pelo Nino com IA/)).toBeInTheDocument();
    });

    it("narrativa de outra leitura (hash diferente) é ignorada", async () => {
      const ev = serve(withRec(), { title: "Texto velho", body: "x", question: null, source: "llm" }, "outrohash");
      await mount();
      expect(await screen.findByText(ev.deterministic.title)).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 40));
      expect(screen.queryByText("Texto velho")).not.toBeInTheDocument();
    });

    it("'Agora não' e 'Isso ajudou?' viram eventos da recomendação", async () => {
      serve(withRec());
      await mount();
      fireEvent.click(await screen.findByRole("button", { name: "Agora não" }));
      await waitFor(() => expect(inserts.some((i) => i.table === "map_recommendation_events" && i.row.event === "dismissed" && i.row.rec_id === "comportamento:criar_reserva")).toBe(true));
      fireEvent.click(screen.getByRole("button", { name: "Sim" }));
      await waitFor(() => expect(inserts.some((i) => i.row.event === "useful")).toBe(true));
    });

    it("sem recomendação, mostra a leitura de 'nada pede ação' sem botão de ação", async () => {
      const r = reading([ind({ id: "seguranca.meses_cobertos", pillar: "seguranca", value: 7, unit: "meses", inputs: { base: "essenciais", meta_meses: 6 } })]);
      r.data_quality = { closed_months: 6 } as MapaReading["data_quality"];
      serve(r);
      await mount();
      expect(await screen.findByText("Nada pede ação agora")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Agora não" })).not.toBeInTheDocument();
    });

    it("evolução: chip no indicador, detalhe com o valor anterior e seção 'O que mudou'", async () => {
      const r = withRec();
      r.indicators[0].change = { previous: 0.2, delta: 0.3, direction: "melhorou", comparable: true };
      serve(r);
      await mount();
      expect(await screen.findByText("O que mudou desde a última leitura")).toBeInTheDocument();
      expect(screen.getByText("↑ Melhorou")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Quantos meses seu dinheiro cobre"));
      expect(screen.getByText(/Melhorou desde a leitura anterior \(antes: 0,2 mês\)/)).toBeInTheDocument();
    });

    it("changeText explica por que não comparou e nunca inventa direção", () => {
      const base = ind({ id: "seguranca.meses_cobertos", pillar: "seguranca" });
      expect(changeText(base)).toBeNull();
      expect(changeText({ ...base, change: { previous: 1, delta: null, direction: "indefinido", comparable: false, not_comparable_reason: "formula_changed" } })).toMatchObject({ tone: "none", detail: expect.stringMatching(/forma de calcular mudou/) });
      expect(changeText({ ...base, change: { previous: 1, delta: 0, direction: "parecido", comparable: true } })?.tone).toBe("same");
    });
  });

  it("bem-estar percebido entra depois dos hábitos quando a página passa o cartão", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([ind({ id: "execucao.aderencia", pillar: "execucao", layer: "habitos", value: 80, unit: "pct", inputs: { cumpridos: 4, periodos: 5 } })]) }, error: null });
    const { MapaEntender } = await import("@/components/mapa/MapaEntender");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><MapaEntender bemEstar={<div>CARTAO-CFPB</div>} /></MemoryRouter></QueryClientProvider>);
    const card = await screen.findByText("CARTAO-CFPB");
    const habits = screen.getByText("Metas cumpridas");
    expect(habits.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById("pilar-bem_estar")).toContainElement(card);
    expect(document.getElementById("pilar-seguranca")).toBeNull(); // sem indicadores de segurança nesta leitura
  });
});
