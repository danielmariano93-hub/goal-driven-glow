import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  OVERLAP_DAYS, dropAlreadySeen, loadSeenExternalIds, resolveExtractionWindow,
} from "../../supabase/functions/_shared/openfinance/incremental";

const item = (id: string) => ({ external_id: `pluggy:${id}`, bank_reference: `pluggy:${id}` }) as any;

describe("Open Finance incremental — janela", () => {
  it("sem cursor: começa no dia 1 do mês atual", () => {
    expect(resolveExtractionWindow({ to: "2026-10-13", cursor: null })).toEqual({ from: "2026-10-01", reason: "month_start" });
  });
  it("com cursor: começa poucos dias antes dele, não no dia 1", () => {
    const w = resolveExtractionWindow({ to: "2026-10-13", cursor: "2026-10-12" });
    expect(w.reason).toBe("cursor");
    expect(w.from).toBe("2026-10-07");
    expect(OVERLAP_DAYS).toBe(5);
  });
  it("cursor no futuro ou inválido é ignorado", () => {
    expect(resolveExtractionWindow({ to: "2026-10-13", cursor: "2026-11-01" }).reason).toBe("month_start");
    expect(resolveExtractionWindow({ to: "2026-10-13", cursor: "ontem" }).reason).toBe("month_start");
  });
  it("days explícito vence o cursor", () => {
    expect(resolveExtractionWindow({ to: "2026-10-13", cursor: "2026-10-12", explicitDays: 30 })).toEqual({ from: "2026-09-13", reason: "explicit_days" });
  });
});

describe("Open Finance incremental — já visto não volta", () => {
  it("remove itens cujo id já passou por extração", () => {
    const r = dropAlreadySeen([item("a"), item("b"), item("c")], new Set(["pluggy:b"]));
    expect(r.kept.map((i) => i.external_id)).toEqual(["pluggy:a", "pluggy:c"]);
    expect(r.dropped).toBe(1);
  });
  it("lote descartado (documento cancelado) libera os itens para voltar", async () => {
    const tables: Record<string, any[]> = {
      extracted_items: [
        { bank_reference: "pluggy:a", status: "ignored", document_id: "d1" },
        { bank_reference: "pluggy:b", status: "ignored", document_id: "d2" },
        { bank_reference: "pluggy:c", status: "needs_review", document_id: "d1" },
      ],
      document_imports: [{ id: "d1", status: "partially_confirmed" }, { id: "d2", status: "canceled" }],
    };
    const sb = {
      from: (t: string) => {
        const q: any = { rows: tables[t] };
        q.select = () => q; q.eq = () => q;
        q.in = (col: string, vals: string[]) => { q.rows = q.rows.filter((r: any) => vals.includes(r[col])); return q; };
        q.then = (res: any) => res({ data: q.rows, error: null });
        return q;
      },
    };
    const seen = await loadSeenExternalIds(sb, "u", ["pluggy:a", "pluggy:b", "pluggy:c"]);
    expect([...seen].sort()).toEqual(["pluggy:a", "pluggy:c"]);
    const onlyIgnored = await loadSeenExternalIds(sb, "u", ["pluggy:a", "pluggy:b", "pluggy:c"], ["ignored"]);
    expect([...onlyIgnored]).toEqual(["pluggy:a"]);
  });
});

describe("Open Finance incremental — contrato da função", () => {
  const fn = readFileSync("supabase/functions/openfinance-sync/index.ts", "utf8");
  it("usa o cursor por conta e só o avança depois de gravar os lotes", () => {
    expect(fn).toContain("extracted_through");
    expect(fn.indexOf("stageBatch(")).toBeLessThan(fn.indexOf("update({ extracted_through"));
    expect(fn).toContain("loadSeenExternalIds");
  });
  it("migração cria a coluna do cursor", () => {
    expect(readFileSync("supabase/migrations/20261013110000_open_finance_incremental_cursor.sql", "utf8")).toContain("extracted_through date");
  });
});
