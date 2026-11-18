import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EntryList } from "@/components/ticket/EntryList";
import { ENTRY_PAGE, newestFirst } from "@/lib/ticket/entryOrder";
import type { BenefitEntryRow } from "@/lib/db/benefitWallet";

vi.mock("@/components/ticket/EntrySheet", () => ({ isEditableBenefitEntry: () => true }));

const mk = (n: number, date: string, created = "2026-11-12T10:00:00Z"): BenefitEntryRow =>
  ({ id: `e${n}`, kind: "spend", amount: n, occurred_on: date, merchant: `Loja ${n}`, note: null, created_at: created, source: "manual" }) as BenefitEntryRow;

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const money = (v: number) => `R$ ${v}`;
const renderList = (entries: BenefitEntryRow[]) =>
  render(<EntryList entries={entries} onEdit={vi.fn()} onRemove={vi.fn()} removing={false} money={money} day={day} />);

describe("lançamentos do Ticket: nada some por ser antigo", () => {
  it("mais recente primeiro; no mesmo dia, o último registrado vem antes", () => {
    const out = newestFirst([mk(1, "2026-11-10"), mk(2, "2026-11-12", "2026-11-12T09:00:00Z"), mk(3, "2026-11-12", "2026-11-12T18:00:00Z")]);
    expect(out.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });
  it("mostra mais do que os 12 de antes e não corta lançamentos de datas anteriores", () => {
    // 30 lançamentos: 18 a partir de 12/11 e 12 anteriores (de 31/10 a 11/11)
    const recent = Array.from({ length: 18 }, (_, i) => mk(i + 1, "2026-11-12", `2026-11-12T${String(i).padStart(2, "0")}:00:00Z`));
    const older = Array.from({ length: 12 }, (_, i) => mk(100 + i, `2026-11-${String(11 - (i % 11)).padStart(2, "0")}`));
    renderList([...older, ...recent]);
    expect(screen.getAllByLabelText("Excluir lançamento")).toHaveLength(ENTRY_PAGE);
    expect(screen.getByTestId("ticket-entries-count").textContent).toBe(`${ENTRY_PAGE} de 30`);
    // "Ver mais" chega até os antigos
    fireEvent.click(screen.getByRole("button", { name: /Ver mais/ }));
    expect(screen.getAllByLabelText("Excluir lançamento")).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /Ver mais/ })).toBeNull();
    expect(screen.getByTestId("ticket-entries-count").textContent).toBe("30 lançamentos");
    const section = screen.getByTestId("ticket-entries");
    expect(within(section).getAllByText("11/11").length).toBeGreaterThan(0);
  });
  it("com poucos lançamentos mostra todos e não oferece 'Ver mais'", () => {
    renderList([mk(1, "2026-11-01"), mk(2, "2026-11-12")]);
    expect(screen.getAllByLabelText("Excluir lançamento")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Ver mais/ })).toBeNull();
    expect(screen.getByTestId("ticket-entries-count").textContent).toBe("2 lançamentos");
  });
  it("sem lançamentos não mostra a seção", () => {
    const { container } = renderList([]);
    expect(container.textContent).toBe("");
  });
});
