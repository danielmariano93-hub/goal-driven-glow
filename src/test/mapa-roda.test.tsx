import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MapaIndicator } from "@/lib/engine/mapaContracts";
import { pillarState, wedgePath, wheelStates, WHEEL_SEGMENTS } from "@/lib/mapa/wheel";
import { MapaRoda } from "@/components/mapa/MapaRoda";

const win = { start: "2026-07-01", end: "2026-09-30", kind: "meses_fechados" as const, n: 3 };
const ind = (id: string, pillar: MapaIndicator["pillar"], over: Partial<MapaIndicator> = {}): MapaIndicator => ({
  id, pillar, layer: "saude", value: 1, unit: "razao", direction: "higher_better", status: "ok", confidence: "alta", window: win, evidence: ["ledger"], inputs: {}, reasons: [], formula_version: "t", ...over,
});
const nodata = (id: string, pillar: MapaIndicator["pillar"]) => ind(id, pillar, { value: null, status: "sem_dados", confidence: "insuficiente", reasons: ["x"] });

describe("estado de cada área da roda", () => {
  it("é o pior estado entre os indicadores que julgam", () => {
    expect(pillarState([ind("a.1", "equilibrio"), ind("a.2", "equilibrio", { status: "atencao" }), ind("a.3", "equilibrio", { status: "critico" })])).toBe("critico");
    expect(pillarState([ind("a.1", "equilibrio"), ind("a.2", "equilibrio", { status: "atencao" })])).toBe("atencao");
    expect(pillarState([ind("a.1", "equilibrio"), ind("a.2", "equilibrio")])).toBe("ok");
  });
  it("sem dado é cinza; indicador sem dado não pesa contra a área", () => {
    expect(pillarState([nodata("a.1", "dividas"), nodata("a.2", "dividas")])).toBe("sem_dados");
    expect(pillarState([nodata("a.1", "dividas"), ind("a.2", "dividas")])).toBe("ok");
  });
  it("descritivo (neutro) e em teste não pintam a roda: viram 'informativo'", () => {
    expect(pillarState([ind("a.1", "planejamento", { direction: "neutral" })])).toBe("informativo");
    expect(pillarState([ind("a.1", "acompanhamento", { status: "atencao", reasons: ["exploratorio"] })])).toBe("informativo");
    expect(pillarState([ind("a.1", "planejamento", { direction: "neutral" }), ind("a.2", "planejamento", { status: "atencao" })])).toBe("atencao");
  });
  it("as 8 áreas existem, na ordem horária, e bem-estar é informativo", () => {
    expect(WHEEL_SEGMENTS.map((s) => s.id)).toEqual(["equilibrio", "seguranca", "dividas", "futuro", "execucao", "planejamento", "acompanhamento", "bem_estar"]);
    expect(wheelStates([])).toMatchObject({ equilibrio: "sem_dados", bem_estar: "informativo" });
  });
  it("geometria: fatia é um caminho fechado e finito", () => {
    const d = wedgePath(160, 160, 58, 122, 2, 43);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});

describe("MapaRoda", () => {
  const inds = [
    ind("equilibrio.resultado_3m", "equilibrio", { status: "critico" }), ind("seguranca.meses_cobertos", "seguranca", { status: "atencao" }), ind("dividas.atrasos", "dividas"),
    nodata("futuro.progresso_metas", "futuro"),
  ];
  it("mostra 8 fatias com o estado certo, e a legenda diz o estado por escrito (não só por cor)", () => {
    const { container } = render(<MapaRoda indicators={inds} wellbeingText="55 de 100 (percepção)" />);
    const seg = (id: string) => container.querySelector(`[data-segment="${id}"]`)?.getAttribute("data-state");
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(8);
    expect([seg("equilibrio"), seg("seguranca"), seg("dividas"), seg("futuro"), seg("bem_estar")]).toEqual(["critico", "atencao", "ok", "sem_dados", "informativo"]);
    expect(screen.getByText(/precisa de cuidado/)).toBeInTheDocument();
    expect(screen.getByText(/55 de 100/)).toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Equilíbrio: precisa de cuidado");
    expect(screen.getByText("sem nota geral")).toBeInTheDocument();
  });
  it("a explicação responde: o que é, por que importa, para que serve e como ler (e nega a nota geral)", () => {
    render(<MapaRoda indicators={inds} />);
    expect(screen.queryByTestId("roda-explicacao")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Entenda a roda/ }));
    const t = screen.getByTestId("roda-explicacao").textContent!;
    for (const h of ["O que é", "Por que importa", "Para que serve", "Como ler"]) expect(t).toContain(h);
    expect(t).toMatch(/não existe nota geral nem média/);
    expect(t).toMatch(/Cinza tracejado/);
  });
});
