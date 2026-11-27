import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TicketView } from "@/components/ticket/TicketView";
import type { BenefitEntryRow, OwnFoodRow } from "@/lib/db/benefitWallet";

const wallet = { monthly_credit: 1000, credit_day: 27, carries_over: true } as never;
const ent = (id: string, occurred_on: string, amount: number, kind: BenefitEntryRow["kind"] = "spend", merchant: string | null = "Hirota"): BenefitEntryRow =>
  ({ id, kind, amount, occurred_on, merchant, created_at: `${occurred_on}T12:00:00Z`, note: null, source: "manual" });
const entries: BenefitEntryRow[] = [
  ent("c1", "2026-09-25", 1000, "credit", null), ent("r1", "2026-09-25", 1000, "balance_reading", null),
  ...Array.from({ length: 30 }, (_, i) => ent(`s${i}`, `2026-10-${String(i + 1).padStart(2, "0")}`.replace("2026-10-31", "2026-10-30"), 20)),
  ent("c2", "2026-10-27", 1000, "credit", null), ent("w1", "2026-11-04", 80, "spend", "Restaurante A"), ent("w2", "2026-11-12", 30),
];
const own: OwnFoodRow[] = [{ id: "o1", occurred_at: "2026-11-04", amount: 40, merchant: "Restaurante A" }];
const props = { wallet, entries, own, ownReady: true, today: "2026-11-20", onAdd: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), removing: false };

window.scrollTo = vi.fn() as never;

describe("Ticket em três abas", () => {
  it("Resumo mostra saldo, próxima recarga, limite/margem/autonomia e desempenho", () => {
    render(<TicketView {...props} />);
    expect(screen.getByTestId("ticket-hero").textContent).toContain("Próxima recarga prevista em 27/11");
    expect(screen.getByTestId("ticket-daily-kpis").textContent).toMatch(/Limite diário.*Margem diária.*Autonomia/);
    expect(screen.getByTestId("ticket-performance")).toBeTruthy();
    expect(screen.queryByTestId("ticket-statement")).toBeNull();
  });
  it("simulador atualiza o texto e volta à previsão", () => {
    render(<TicketView {...props} />);
    fireEvent.change(screen.getByLabelText("Gasto diário simulado em reais"), { target: { value: "100" } });
    expect(screen.getByTestId("ticket-sim-result").textContent).toMatch(/100,00\/dia/);
    fireEvent.click(screen.getByText("Voltar à previsão"));
    expect(screen.queryByTestId("ticket-sim-result")).toBeNull();
  });
  it("Análises: tocar no dia atualiza o detalhe e o 'Ver lançamentos' abre o Extrato filtrado", () => {
    render(<TicketView {...props} initialTab="analises" />);
    fireEvent.click(screen.getByRole("button", { name: /^Quarta-feira: média/ }));
    expect(screen.getByTestId("weekday-avg-detail").textContent).toContain("Quarta-feira");
    fireEvent.click(screen.getByRole("button", { name: /^Sábado: média/ }));
    expect(screen.getByTestId("weekday-avg-detail").textContent).not.toContain("Quarta-feira");
    fireEvent.click(screen.getByText("Ver lançamentos de sábados"));
    expect(screen.getByTestId("ticket-statement")).toBeTruthy();
    expect(screen.getByText("Sábado")).toBeTruthy();
  });
  it("Extrato: excluir pede confirmação; recarga não entra no consumo", () => {
    render(<TicketView {...props} initialTab="extrato" />);
    fireEvent.click(screen.getByRole("button", { name: "Ciclo anterior" }));
    expect(within(screen.getByTestId("ticket-statement-totals")).getByText("R$ 1.000,00")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Excluir lançamento")[0]);
    expect(props.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });
});
