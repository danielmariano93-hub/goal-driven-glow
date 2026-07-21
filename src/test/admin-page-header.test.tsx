import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageHeader } from "@/components/admin/PageHeader";

describe("PageHeader", () => {
  it("renderiza título, descrição e ação", () => {
    render(
      <MemoryRouter>
        <PageHeader title="Meu título" description="Descrição amigável" actions={<button>Ação</button>} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Meu título" })).toBeInTheDocument();
    expect(screen.getByText("Descrição amigável")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ação" })).toBeInTheDocument();
  });

  it("renderiza breadcrumbs com links quando fornecidos", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Simulador"
          crumbs={[{ label: "Assistente", to: "/admin/agente" }, { label: "Simulador" }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Assistente" })).toHaveAttribute("href", "/admin/agente");
    expect(screen.getByRole("heading", { name: "Simulador" })).toBeInTheDocument();
  });
});
