import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockedIndicators } from "@/components/hb/LockedIndicators";

describe("indicadores que ainda juntam dados", () => {
  it("diz o que é cada um e quanto falta", () => {
    render(<LockedIndicators items={[
      { key: "c", title: "Constância", what: "Quanto dos seus hábitos diários você fez.", have: 3, need: 7, unit: "dias fechados" },
      { key: "r", title: "Recomeços", what: "Voltou no dia seguinte?", condition: "Aparece quando houver dias não feitos para analisar." },
    ]} />);
    expect(screen.getByText("Aparecem quando houver dados")).toBeTruthy();
    expect(screen.getByText("Constância")).toBeTruthy();
    expect(screen.getByText("3 de 7 dias fechados")).toBeTruthy();
    expect(screen.getByText(/Aparece quando houver dias não feitos/)).toBeTruthy();
  });
  it("não passa do necessário e some quando não há nada a esperar", () => {
    render(<LockedIndicators items={[{ key: "c", title: "Constância", what: "x", have: 12, need: 7, unit: "dias fechados" }]} />);
    expect(screen.getByText("7 de 7 dias fechados")).toBeTruthy();
    expect(render(<LockedIndicators items={[]} />).container.textContent).toBe("");
  });
});
