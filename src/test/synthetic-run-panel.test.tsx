import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ saved: vi.fn(), enqueued: vi.fn(), state: null as any }));
vi.mock("@/lib/admin/qualidade", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin/qualidade")>()),
  useSyntheticState: () => ({ data: h.state, isError: false }),
  useSaveSyntheticSettings: () => ({ mutate: h.saved, isPending: false }),
  useEnqueueRun: () => ({ mutate: h.enqueued, isPending: false, data: null, isError: false }),
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SyntheticRunPanel } from "@/components/admin/SyntheticRunPanel";

const weekly = { enabled: false, every_hours: 24, tpm: 120000, lanes: 2, last_enqueued_at: null, schedule_kind: "weekly", schedule_dow: 0, schedule_hour: 3, sample_size: 120, token_cap: 800000, report_whatsapp: true };

describe("painel da rodada: semanal com relatório", () => {
  beforeEach(() => { h.saved.mockClear(); h.enqueued.mockClear(); h.state = { settings: weekly, active: null, recent: [] }; });

  it("mostra domingo às 3h por padrão e salva a agenda com sorteio, limite de custo e relatório", () => {
    render(<SyntheticRunPanel />);
    expect((screen.getByLabelText("Dia da semana") as HTMLSelectElement).value).toBe("0");
    expect((screen.getByLabelText("Hora") as HTMLSelectElement).value).toBe("3");
    expect((screen.getByLabelText("Conversas sorteadas") as HTMLInputElement).value).toBe("120");
    fireEvent.click(screen.getByLabelText("Rodar sozinho"));
    fireEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]);
    expect(h.saved).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, schedule_kind: "weekly", schedule_dow: 0, schedule_hour: 3, sample_size: 120, token_cap: 800000, report_whatsapp: true }));
  });
  it("a frase explica quando roda", () => {
    h.state = { settings: { ...weekly, enabled: true, last_enqueued_at: "2026-11-15T06:01:00Z" }, active: null, recent: [] };
    render(<SyntheticRunPanel />);
    expect(screen.getByTestId("schedule-sentence").textContent).toMatch(/Toda domingo às 3h \(horário de Brasília\), sorteando 120 conversas\./);
  });
  it("trocar para 'a cada tantas horas' mostra o intervalo e esconde o sorteio", () => {
    render(<SyntheticRunPanel />);
    fireEvent.change(screen.getByDisplayValue("Toda semana (sorteando conversas)"), { target: { value: "interval" } });
    expect(screen.queryByLabelText("Conversas sorteadas")).toBeNull();
    expect(screen.getByText("A cada")).toBeTruthy();
  });
  it("'Rodar agora' pede o relatório no WhatsApp por padrão e dá para desmarcar", () => {
    render(<SyntheticRunPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Rodar agora/ }));
    expect(h.enqueued).toHaveBeenLastCalledWith(expect.objectContaining({ report: true }));
    fireEvent.click(screen.getByLabelText("Mandar o relatório no WhatsApp ao terminar"));
    fireEvent.click(screen.getByRole("button", { name: /Rodar agora/ }));
    expect(h.enqueued).toHaveBeenLastCalledWith(expect.objectContaining({ report: false }));
  });
  it("antes da migração (sem as colunas novas) o painel abre no modo por intervalo", () => {
    h.state = { settings: { enabled: false, every_hours: 24, tpm: 120000, lanes: 2, last_enqueued_at: null }, active: null, recent: [] };
    render(<SyntheticRunPanel />);
    expect(screen.getByDisplayValue("A cada tantas horas (bateria completa)")).toBeTruthy();
  });
});
