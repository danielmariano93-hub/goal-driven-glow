/**
 * Verifica que a rota `/app/assessor` compartilha a MESMA instância do
 * painel usado pelo `AssessorFab` (via AssessorContext), sem renderizar
 * um segundo painel, e que ao fechar o painel a rota é substituída por
 * `/app` com `replace`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AssessorProvider, useAssessor } from "@/context/AssessorContext";
import AssessorPage from "@/pages/Assessor";

// Painel mock: renderiza um marcador estável para contagem via testing-library.
vi.mock("@/components/assessor/AssessorPanel", () => ({
  AssessorPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="assessor-panel">
      <button data-testid="close-assessor" onClick={onClose}>fechar</button>
    </div>
  ),
}));

function GlobalPanel() {
  const { isOpen, closeAssessor } = useAssessor();
  if (!isOpen) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AssessorPanel } = require("@/components/assessor/AssessorPanel");
  return <AssessorPanel onClose={closeAssessor} />;
}

function FabTrigger() {
  const { openAssessor } = useAssessor();
  return <button data-testid="fab" onClick={() => openAssessor("fab")}>fab</button>;
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pathname">{loc.pathname}</span>;
}

function TestApp({ initial }: { initial: string }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AssessorProvider>
        <FabTrigger />
        <LocationProbe />
        <Routes>
          <Route path="/app" element={<div data-testid="home" />} />
          <Route path="/app/assessor" element={<AssessorPage />} />
        </Routes>
        <GlobalPanel />
      </AssessorProvider>
    </MemoryRouter>
  );
}

describe("Assessor deep-link", () => {
  it("abre uma única instância do painel ao acessar /app/assessor", async () => {
    render(<TestApp initial="/app/assessor" />);
    const panels = await screen.findAllByTestId("assessor-panel");
    expect(panels).toHaveLength(1);
  });

  it("navega para /app com replace ao fechar o painel vindo do deep-link", async () => {
    render(<TestApp initial="/app/assessor" />);
    expect(screen.getByTestId("pathname").textContent).toBe("/app/assessor");
    await act(async () => {
      screen.getByTestId("close-assessor").click();
    });
    expect(screen.queryByTestId("assessor-panel")).toBeNull();
    expect(screen.getByTestId("pathname").textContent).toBe("/app");
  });

  it("FAB e deep-link compartilham a mesma instância (nunca dois painéis)", async () => {
    render(<TestApp initial="/app" />);
    await act(async () => { screen.getByTestId("fab").click(); });
    expect(screen.getAllByTestId("assessor-panel")).toHaveLength(1);
    // Um segundo clique não duplica.
    await act(async () => { screen.getByTestId("fab").click(); });
    expect(screen.getAllByTestId("assessor-panel")).toHaveLength(1);
  });
});
