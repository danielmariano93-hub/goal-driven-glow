import { describe, it, expect } from "vitest";
import { fetchAllPages, DATA_API_PAGE } from "@/lib/db/pagedSelect";
import { findTruncatedTransactionReads } from "../../scripts/check-tx-selects.mjs";

/**
 * `paged_select.v1` — a Data API corta em 1.000 linhas em silêncio. Sem paginar,
 * o relatório somava só o começo do período (Transporte 1.603,76 em vez de
 * 2.389,99). Aqui a leitura parcial falha antes de virar número na tela.
 */
describe("paged_select.v1: leitura completa da Data API", () => {
  it("percorre todas as páginas até a última incompleta", async () => {
    const total = 2_350;
    const all = Array.from({ length: total }, (_, i) => ({ id: i }));
    const ranges: Array<[number, number]> = [];
    const rows = await fetchAllPages<{ id: number }>((from, to) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    });
    expect(rows.length).toBe(total);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("para na primeira página curta e não pede páginas extras", async () => {
    let calls = 0;
    const rows = await fetchAllPages<{ id: number }>(() => {
      calls++;
      return Promise.resolve({ data: [{ id: 1 }], error: null });
    });
    expect(calls).toBe(1);
    expect(rows.length).toBe(1);
  });

  it("propaga erro de página com a origem, sem devolver leitura parcial", async () => {
    await expect(
      fetchAllPages<{ id: number }>(
        (from) => Promise.resolve(from === 0
          ? { data: Array.from({ length: DATA_API_PAGE }, (_, i) => ({ id: i })), error: null }
          : { data: null, error: { message: "boom" } }),
        { source: "transactions" },
      ),
    ).rejects.toThrow("transactions:boom");
  });

  it("nenhuma leitura de transactions pede mais de 1.000 linhas numa tacada", () => {
    expect(findTruncatedTransactionReads()).toEqual([]);
  });
});
