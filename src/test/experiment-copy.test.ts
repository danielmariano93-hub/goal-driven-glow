import { describe, expect, it } from "vitest";
import { currentReviewWeekStart, evidenceItems, experimentCopy, progressLabel, reviewAlreadyCounted, EXPERIMENT_COPY, type ExperimentEvent } from "@/lib/behavioral/experimentCopy";

const ev = (over: Partial<ExperimentEvent>): ExperimentEvent => ({
  id: "e1", experiment_id: "x", value: 1, source: "auto", ref_type: "transaction", ref_key: "t1",
  label: "Aporte em investimento", note: "Aplicação CDB", created_at: "2026-10-01T10:00:00Z", ...over,
});

describe("experimentCopy", () => {
  it("todo modelo tem o que é, o que conta e como é medido", () => {
    for (const [slug, c] of Object.entries(EXPERIMENT_COPY)) {
      expect(c.what.length, slug).toBeGreaterThan(20);
      expect(c.counts.length, slug).toBeGreaterThan(0);
      expect(c.measured.length, slug).toBeGreaterThan(10);
    }
  });
  it("slug desconhecido cai num texto seguro", () => {
    expect(experimentCopy("nao-existe").what).toBeTruthy();
  });
  it("progresso usa a unidade certa", () => {
    expect(progressLabel("small-wealth-moves", 2, 4)).toBe("2 de 4 ações");
    expect(progressLabel("weekly-money-review", 1, 4)).toBe("1 de 4 semanas revisadas");
    expect(progressLabel("reduce-spend-10pct", 12.4, 10)).toBe("12% de redução observada");
  });
});

describe("evidenceItems", () => {
  it("lista o que contou, mais recente primeiro, com a origem", () => {
    const items = evidenceItems("small-wealth-moves", [
      ev({ id: "a", created_at: "2026-10-01T10:00:00Z" }),
      ev({ id: "b", source: "linked", label: "Ação de patrimônio", created_at: "2026-10-02T10:00:00Z", ref_key: "t2" }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(items[0]).toMatchObject({ sourceLabel: "Vinculado por você", counts: true, removable: true });
    expect(items[1]).toMatchObject({ sourceLabel: "Detectado pelo Nino", removable: false });
  });
  it("marcação manual antiga em experimento com detecção não conta", () => {
    const [item] = evidenceItems("weekly-money-review", [ev({ source: "manual", ref_type: null, ref_key: null, label: null, note: null })]);
    expect(item.counts).toBe(false);
    expect(item.detail).toMatch(/não soma/i);
  });
  it("no experimento de pausa o registro manual conta e pode ser desfeito", () => {
    const [item] = evidenceItems("pause-before-buying", [ev({ source: "manual", ref_type: null, ref_key: null, label: null, note: "A vontade passou" })]);
    expect(item).toMatchObject({ counts: true, removable: true, detail: "A vontade passou" });
  });
  it("eventos removidos ou zerados somem", () => {
    expect(evidenceItems("small-wealth-moves", [ev({ source: "removed", value: 0 })])).toEqual([]);
  });
});

describe("revisão semanal", () => {
  it("a semana do experimento começa no dia do início e anda de 7 em 7", () => {
    expect(currentReviewWeekStart("2026-09-20T15:00:00Z", new Date("2026-09-22T12:00:00Z"))).toBe("2026-09-20");
    expect(currentReviewWeekStart("2026-09-20T15:00:00Z", new Date("2026-10-01T12:00:00Z"))).toBe("2026-09-27");
  });
  it("sabe se a semana atual já contou", () => {
    const week = ev({ ref_type: "week", ref_key: "2026-09-27", source: "auto" });
    expect(reviewAlreadyCounted("2026-09-20T15:00:00Z", [week], new Date("2026-10-01T12:00:00Z"))).toBe(true);
    expect(reviewAlreadyCounted("2026-09-20T15:00:00Z", [week], new Date("2026-10-05T12:00:00Z"))).toBe(false);
  });
});
