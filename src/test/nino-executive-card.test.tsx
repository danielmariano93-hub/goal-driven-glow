import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { ExecutiveInsightCard, ExecutiveKpiStrip } from "@/components/nino/ExecutiveInsightCard";
import { AssessorProvider, useAssessor } from "@/context/AssessorContext";
import type { ExecutiveInsight } from "@/lib/nino/executive";

const insight: ExecutiveInsight = {
  key: "cashflow",
  kind: "cashflow",
  direction: "worse",
  severity: "critical",
  section: "agora",
  headline: "Nos últimos 3 meses você gastou R$ 14,6 mil a mais do que recebeu",
  why: "É um déficit médio de R$ 4,9 mil por mês.",
  evidence: ["Julho: entrou R$ 7,7 mil, saiu R$ 22,5 mil (-R$ 14,8 mil)"],
  action: { type: "ask", label: "Montar plano para equilibrar", prompt: "Monte um plano para eu equilibrar meus gastos", detail: null },
  impact_monthly: 4866,
  score: 130,
};

function DraftProbe() {
  const { draft, isOpen } = useAssessor();
  return <p data-testid="probe">{isOpen ? `aberto:${draft ?? ""}` : "fechado"}</p>;
}

function setup(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AssessorProvider>
          {ui}
          <DraftProbe />
        </AssessorProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("card executivo", () => {
  it("mostra conclusão, impacto, números e a ação", () => {
    setup(<ExecutiveInsightCard insight={insight} emphasis />);
    expect(screen.getByText("Crítico")).toBeTruthy();
    expect(screen.getByText(insight.headline)).toBeTruthy();
    expect(screen.getByText("≈ R$ 4,9 mil/mês")).toBeTruthy();
    expect(screen.getByText(insight.evidence[0])).toBeTruthy();
  });

  it("ação 'perguntar' abre o assessor com a pergunta pronta e registra a ação", async () => {
    setup(<ExecutiveInsightCard insight={insight} />);
    fireEvent.click(screen.getByText("Montar plano para equilibrar"));
    expect(screen.getByTestId("probe").textContent).toBe("aberto:Monte um plano para eu equilibrar meus gastos");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("nino-insights", {
      body: { action: "feedback", key: "cashflow", kind: "cashflow", feedback: "acted" },
    }));
  });

  it("KPIs do topo com tom", () => {
    setup(<ExecutiveKpiStrip kpis={[{ label: "Saldo em 3 meses", value: "-R$ 14,6 mil", hint: "entrou R$ 40,6 mil", tone: "bad" }]} />);
    expect(screen.getByText("-R$ 14,6 mil").className).toContain("text-destructive");
  });
});
