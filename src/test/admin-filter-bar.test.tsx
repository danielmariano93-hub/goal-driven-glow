import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar, type ActiveFilter } from "@/components/admin/FilterBar";

describe("FilterBar", () => {
  it("renderiza chips ativos e chama onClear ao clicar", () => {
    const onClear = vi.fn();
    const active: ActiveFilter[] = [{ key: "status", label: "Status: enviado", onClear }];
    render(
      <FilterBar active={active}>
        <input aria-label="filtro" />
      </FilterBar>,
    );
    const chip = screen.getByRole("button", { name: /remover filtro/i });
    fireEvent.click(chip);
    expect(onClear).toHaveBeenCalled();
  });

  it("mostra 'Limpar tudo' quando há filtros ativos e handler", () => {
    const onClearAll = vi.fn();
    render(
      <FilterBar
        active={[{ key: "a", label: "A", onClear: () => {} }]}
        onClearAll={onClearAll}
      >
        <span />
      </FilterBar>,
    );
    fireEvent.click(screen.getByText("Limpar tudo"));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("não mostra área de chips quando não há filtros ativos", () => {
    render(<FilterBar><span /></FilterBar>);
    expect(screen.queryByText("Limpar tudo")).toBeNull();
  });
});
