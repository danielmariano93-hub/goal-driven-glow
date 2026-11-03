import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

let rows: Array<Record<string, unknown>> = [];
const saved: Array<Record<string, unknown>> = [];
vi.mock("@/lib/emotions/useEmotionMonth", () => ({
  useEmotionMonth: () => ({ data: rows, isLoading: false }),
  useSaveRetroCheckin: () => ({ isPending: false, mutateAsync: async (input: Record<string, unknown>) => { saved.push(input); } }),
}));

import { EmotionMonthCalendar } from "@/components/emotions/EmotionMonthCalendar";
import { buildMonthCalendar, monthBounds, monthSummary, retroOccurredAt, saoPauloDay, shiftMonth } from "@/lib/emotions/history";

const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe("grade do mês", () => {
  it("novembro/2026: 30 dias, semanas completas de domingo a sábado", () => {
    const weeks = buildMonthCalendar([], "2026-11", "2026-11-03");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((c) => c.inMonth).length).toBe(30);
    expect(weeks[0]![0]!.inMonth).toBe(true); // 01/11/2026 é domingo
    expect(weeks.flat().find((c) => c.date === "2026-11-04")!.future).toBe(true);
    expect(weeks.flat().find((c) => c.date === "2026-11-03")!.isToday).toBe(true);
  });
  it("marca a emoção do dia (a última do dia) e conta dias registrados", () => {
    const weeks = buildMonthCalendar([
      { occurred_at: "2026-11-01T15:00:00-03:00", emotion_key: "ansioso" },
      { occurred_at: "2026-11-01T22:00:00-03:00", emotion_key: "tranquilo" },
      { occurred_at: "2026-11-03T10:00:00-03:00", emotion_key: "atento" },
    ], "2026-11", "2026-11-03");
    expect(weeks.flat().find((c) => c.date === "2026-11-01")!.emotion!.key).toBe("tranquilo");
    expect(monthSummary(weeks, "2026-11-03")).toEqual({ registered: 2, elapsed: 3 });
  });
  it("navegação e limites de mês", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthBounds("2028-02").last).toBe("2028-02-29");
  });
  it("registro retroativo cai no dia certo de São Paulo (meio-dia)", () => {
    expect(saoPauloDay(retroOccurredAt("2026-10-15"))).toBe("2026-10-15");
  });
});

describe("calendário no app", () => {
  it("dia sem registro abre o editor e salva um registro retroativo naquele dia", async () => {
    rows = [];
    saved.length = 0;
    render(wrap(<EmotionMonthCalendar />));
    const today = saoPauloDay(new Date());
    const day = Number(today.slice(8, 10));
    // escolhe um dia já passado do mês, se existir; senão hoje
    const target = day > 1 ? day - 1 : day;
    const cell = screen.getAllByRole("button").find((b) => /sem registro/.test(b.getAttribute("aria-label") ?? "") && b.textContent?.startsWith(String(target)))!;
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole("button", { name: /Ansioso/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect((saved[0]!.emotion as { key: string }).key).toBe("ansioso");
    expect(saved[0]!.existingId).toBeNull();
  });
  it("dia futuro não é editável", () => {
    rows = [];
    render(wrap(<EmotionMonthCalendar />));
    const future = screen.queryAllByRole("button").filter((b) => /ainda não chegou/.test(b.getAttribute("aria-label") ?? ""));
    expect(future.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("calendário acompanha o período da Home", () => {
  it("com month=mês passado mostra aquele mês, completo, sem dia bloqueado", () => {
    rows = [];
    render(wrap(<EmotionMonthCalendar month="2026-10" />));
    expect(screen.getByText(/outubro de 2026/i)).toBeTruthy();
    // outubro/2026 tem 31 dias, todos já passados → 31 botões de dia, nenhum bloqueado
    const days = screen.getAllByRole("button").filter((b) => /sem registro|:/.test(b.getAttribute("aria-label") ?? ""));
    expect(days.length).toBe(31);
    expect(days.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });
  it("dias que ainda não chegaram não aparecem", () => {
    rows = [];
    render(wrap(<EmotionMonthCalendar />));
    expect(screen.queryAllByRole("button").filter((b) => /ainda não chegou/.test(b.getAttribute("aria-label") ?? "")).length).toBe(0);
  });
  it("o cartão do check-in troca para o modo 'como você estava em <mês>' quando o período já fechou", () => {
    const src = readFileSync("src/components/home/EmotionalCheckinCard.tsx", "utf8");
    expect(src).toContain("checkin-past-month");
    expect(src).toContain("Como você estava em");
    const idx = readFileSync("src/pages/Index.tsx", "utf8");
    expect(idx).toContain("<EmotionalCheckinCard month={periodRange.end.slice(0, 7)} />");
  });
});
