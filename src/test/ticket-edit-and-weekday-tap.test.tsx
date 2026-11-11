import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WeekdayBars } from "@/components/ticket/WeekdayBars";
import { weekdayPattern, type BenefitEntry } from "@/lib/engine/benefitWallet";

const editMutate = vi.fn();
const addMutate = vi.fn();
vi.mock("@/lib/db/benefitWallet", () => ({
  useAddBenefitEntry: () => ({ mutate: addMutate, isPending: false }),
  useEditBenefitEntry: () => ({ mutate: editMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EntrySheet, isEditableBenefitEntry } from "@/components/ticket/EntrySheet";

const e = (id: string, occurred_on: string, amount: number): BenefitEntry => ({ id, kind: "spend", amount, occurred_on, merchant: "Mercado" } as never);
// 2026-11-02 é segunda; 04/11 é quarta.
const entries = [e("1", "2026-11-02", 30), e("2", "2026-11-03", 60), e("3", "2026-11-04", 73.36), e("4", "2026-11-04", 50), e("5", "2026-10-28", 20)];
const pattern = weekdayPattern(entries, "2026-11-05");

describe("Quando eu gasto: tocar numa barra mostra o valor daquele dia", () => {
  it("o pico vem selecionado, com o valor total e a média daquele dia", () => {
    render(<WeekdayBars pattern={pattern} />);
    const detail = screen.getByTestId("weekday-detail");
    expect(detail.textContent).toMatch(/Quarta: R\$\s?[\d.]+,\d{2} no total \(\d+%\) · média de R\$\s?[\d.]+,\d{2} por dia/);
  });
  it("tocar em outra barra troca o valor mostrado; sem gasto diz isso", () => {
    render(<WeekdayBars pattern={pattern} />);
    fireEvent.click(screen.getByRole("button", { name: /^terça:/ }));
    expect(screen.getByTestId("weekday-detail").textContent).toMatch(/Terça: R\$\s?60,00 no total/);
    fireEvent.click(screen.getByRole("button", { name: /^sábado: sem gastos/ }));
    expect(screen.getByTestId("weekday-detail").textContent).toMatch(/Sábado: sem gastos no período/);
  });
  it("cada barra é um botão com o valor no nome acessível e estado pressionado", () => {
    render(<WeekdayBars pattern={pattern} />);
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(7);
    expect(screen.getByRole("button", { name: /^quarta:/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^terça:/ }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("corrigir um lançamento do Ticket", () => {
  beforeEach(() => { editMutate.mockClear(); addMutate.mockClear(); });
  const original = { id: "x1", kind: "spend", amount: 14.49, occurred_on: "2026-11-04", merchant: "Souk4u", note: null, created_at: "2026-11-04T12:00:00Z", source: "manual" } as never;

  it("abre com os valores atuais e sem trocar o tipo", () => {
    render(<EntrySheet open onOpenChange={() => {}} walletId="w1" today="2026-11-05" entry={original} />);
    expect(screen.getByText("Corrigir lançamento")).toBeTruthy();
    expect((screen.getByLabelText("Quanto você gastou?") as HTMLInputElement).value).toBe("14,49");
    expect((screen.getByLabelText(/Onde\?/) as HTMLInputElement).value).toBe("Souk4u");
    expect(screen.queryByRole("tab")).toBeNull();
  });
  it("salvar chama a correção (não cria lançamento novo) com valor, dia e lugar", async () => {
    render(<EntrySheet open onOpenChange={() => {}} walletId="w1" today="2026-11-05" entry={original} />);
    fireEvent.change(screen.getByLabelText("Quanto você gastou?"), { target: { value: "15,90" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar correção" }));
    await waitFor(() => expect(editMutate).toHaveBeenCalledTimes(1));
    expect(editMutate.mock.calls[0]![0]).toMatchObject({ amount: 15.9, occurred_on: "2026-11-04", merchant: "Souk4u" });
    expect(addMutate).not.toHaveBeenCalled();
  });
  it("sem 'entry' continua sendo o registro novo", async () => {
    render(<EntrySheet open onOpenChange={() => {}} walletId="w1" today="2026-11-05" />);
    expect(screen.getByText("Registrar no Ticket")).toBeTruthy();
    expect(screen.getAllByRole("tab").length).toBe(3);
  });
  it("só crédito, gasto e saldo informado podem ser corrigidos (ajuste não)", () => {
    expect(isEditableBenefitEntry({ kind: "spend" })).toBe(true);
    expect(isEditableBenefitEntry({ kind: "credit" })).toBe(true);
    expect(isEditableBenefitEntry({ kind: "balance_reading" })).toBe(true);
    expect(isEditableBenefitEntry({ kind: "adjustment" })).toBe(false);
  });
});

describe("registrar gasto no Ticket", () => {
  beforeEach(() => { editMutate.mockClear(); addMutate.mockClear(); });
  it("aberto pelo botão Registrar gasto, já vem na aba Gastei e salva como gasto", async () => {
    render(<EntrySheet open onOpenChange={() => {}} walletId="w1" today="2026-11-05" initialMode="spend" />);
    expect(screen.getByRole("tab", { name: "Gastei" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByLabelText("Quanto você gastou?"), { target: { value: "38,90" } });
    fireEvent.change(screen.getByLabelText(/Onde\?/), { target: { value: "Mercado" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar gasto" }));
    await waitFor(() => expect(addMutate).toHaveBeenCalledTimes(1));
    expect(addMutate.mock.calls[0]![0]).toMatchObject({ wallet_id: "w1", kind: "spend", amount: 38.9, merchant: "Mercado", occurred_on: "2026-11-05" });
  });
  it("sem initialMode abre em Saldo agora (comportamento antigo)", () => {
    render(<EntrySheet open onOpenChange={() => {}} walletId="w1" today="2026-11-05" />);
    expect(screen.getByRole("tab", { name: "Saldo agora" }).getAttribute("aria-selected")).toBe("true");
  });
});
