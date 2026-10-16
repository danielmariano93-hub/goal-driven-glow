import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MapaIndicator, MapaReading } from "@/lib/engine/mapaContracts";
import { MAPA_CONTRACT } from "@/lib/engine/mapaContracts";
import { indicatorText, reasonsText, REASON_CODES_FOR_TEST } from "@/lib/mapa/indicatorText";

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
      ind({ id: "futuro.resgates_sem_destino", pillar: "futuro", value: 6820.86, unit: "brl", inputs: { resgates_90d: 9000, usados_em_divida: 2000 } }),
    ];
    for (const i of all) {
      const t = indicatorText(i);
      expect(t.value).not.toMatch(/NaN|undefined|null/);
      expect(`${t.title} ${t.value} ${t.explain}`.toLowerCase()).not.toMatch(/\bnota\b|\bscore\b|\/\s*10/);
    }
    expect(indicatorText(all[0]).explain).toContain("Faltou R$ 1.500");
    expect(indicatorText(all[2]).value).toBe("0,1 mês");
    expect(indicatorText(all[2]).explain).toContain("gastos totais");
    expect(indicatorText(all[4]).explain).toContain("2 dívidas em atraso");
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
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/ui/feedback", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const table = (rows: unknown[]) => {
    const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, then: (r: any) => r({ data: rows, error: null }), upsert: (v: unknown) => { upserts.push(v); return Promise.resolve({ error: null }); } };
    return q;
  };
  const tables: Record<string, unknown[]> = {
    categories: [{ id: "c1", name: "Moradia" }, { id: "c2", name: "Lazer" }], category_essential_flags: [], debts: [], investments: [],
  };
  return { supabase: { rpc: async () => ({ data: flag, error: null }), from: (t: string) => table(tables[t] ?? []), functions: { invoke: (...a: unknown[]) => invoke(...a) } } };
});

const reading = (indicators: MapaIndicator[]): MapaReading => ({
  contract: MAPA_CONTRACT, as_of: "2026-10-16", indicators, recommendation: null, questions_due: [],
  data_quality: {} as MapaReading["data_quality"], income: {} as MapaReading["income"], structural: {} as MapaReading["structural"],
});

async function mount() {
  const { MapaSaude } = await import("@/components/mapa/MapaSaude");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MapaSaude /></MemoryRouter></QueryClientProvider>);
}

describe("MapaSaude", () => {
  beforeEach(() => { flag = true; invoke.mockReset(); upserts.length = 0; });

  it("sem acesso: não renderiza nada nem chama o servidor", async () => {
    flag = false;
    const { container } = await mount();
    await new Promise((r) => setTimeout(r, 30));
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("com acesso: mostra os pilares, expande 'de onde vem' e oferece a captura guiada", async () => {
    invoke.mockResolvedValue({ data: { ok: true, mapa: reading([
      ind({ id: "seguranca.meses_cobertos", pillar: "seguranca", value: 0.07, unit: "meses", status: "critico", reasons: ["essential_flag_missing"], inputs: { base: "gastos_totais" }, needs: { kind: "capture", code: "essencial_categoria" } }),
      ind({ id: "dividas.custo_medio", pillar: "dividas", value: null, status: "sem_dados", confidence: "insuficiente", reasons: ["taxa_ou_periodo_ausente"], needs: { kind: "capture", code: "debt_rate" } }),
    ]) }, error: null });
    await mount();
    expect(await screen.findByText("Quantos meses seu dinheiro cobre")).toBeInTheDocument();
    expect(screen.getByText("Precisa de cuidado")).toBeInTheDocument();
    expect(screen.getByText("Sem dados")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Quantos meses seu dinheiro cobre"));
    expect(screen.getByText(/ainda não marcou o que é essencial/)).toBeInTheDocument();
    // captura guiada de essenciais
    expect(await screen.findByText(/Quais destes gastos você não consegue cortar/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Moradia" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect((upserts[0] as Array<{ category_id: string; essential: boolean }>).map((r) => [r.category_id, r.essential])).toEqual([["c1", true], ["c2", false]]);
  });

  it("erro do servidor: mensagem calma, sem quebrar a página", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("x") });
    await mount();
    expect(await screen.findByText(/Não consegui montar a leitura agora/, {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
