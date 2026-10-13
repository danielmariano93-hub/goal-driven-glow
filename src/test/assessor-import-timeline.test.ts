import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildImportCards, describeImport, sortByTime, type TimelineDocRow } from "../lib/assessor/importTimeline";

const doc = (over: Partial<TimelineDocRow>): TimelineDocRow => ({
  id: "d1", source: "app", status: "needs_review", document_kind: "statement", error: null,
  created_at: "2026-10-13T12:00:00Z", updated_at: null, statement_bank: "Itaú", period_start: "2026-09-01", period_end: "2026-09-30",
  counters: null, total: 10, confirmed: 0, ignored: 0, pending: 10, registered: 0, ...over,
});

describe("assessor — linha do tempo de importações", () => {
  it("documento parcialmente revisado continua aparecendo, com o balanço e o botão de revisar", () => {
    const card = describeImport(doc({ source: "open_finance", status: "partially_confirmed", statement_bank: null, period_start: null, period_end: null, total: 66, confirmed: 6, ignored: 7, pending: 53, registered: 6 }))!;
    expect(card.status).toBe("needs_review");
    expect(card.pending).toBe(53);
    expect(card.title).toBe("Sincronização com o banco");
    expect(card.text).toContain("Encontrei 66 lançamentos.");
    expect(card.text).toContain("6 registrados · 7 ignorados · 53 aguardando revisão");
  });

  it("tudo revisado vira resumo, sem botão", () => {
    const card = describeImport(doc({ status: "partially_confirmed", total: 12, confirmed: 10, ignored: 2, pending: 0, registered: 10 }))!;
    expect(card.status).toBe("confirmed");
    expect(card.text).toContain("Tudo revisado: 10 registrados · 2 ignorados.");
    expect(card.title).toBe("Extrato Itaú · 01/09 a 30/09");
  });

  it("documento confirmado cujos itens foram limpos mostra o que foi registrado", () => {
    const card = describeImport(doc({ status: "confirmed", total: 0, confirmed: 0, pending: 0, registered: 45 }))!;
    expect(card.text).toContain("45 registrados");
  });

  it("sincronização sem nada novo e lote descartado não poluem a conversa", () => {
    expect(describeImport(doc({ source: "open_finance", total: 0, pending: 0 }))).toBeNull();
    expect(describeImport(doc({ status: "canceled" }))).toBeNull();
  });

  it("arquivo sem lançamentos explica; ilegível e em leitura têm texto próprio", () => {
    expect(describeImport(doc({ total: 0, pending: 0 }))!.text).toContain("Não achei nenhum lançamento");
    expect(describeImport(doc({ document_kind: "illegible" }))!.text).toContain("Não consegui ler bem");
    expect(describeImport(doc({ status: "processing" }))!.text).toContain("Estou lendo");
    expect(describeImport(doc({ status: "failed" }))!.status).toBe("failed");
  });

  it("várias importações aparecem, cada uma no seu lugar cronológico entre as mensagens", () => {
    const cards = buildImportCards([
      doc({ id: "a", created_at: "2026-10-13T12:00:00Z" }),
      doc({ id: "b", created_at: "2026-10-09T12:00:00Z" }),
    ]);
    expect(cards.map((c) => c.document_id)).toEqual(["a", "b"]);
    const merged = sortByTime([
      { createdAt: "2026-10-13T12:00:00Z", id: "card-a" },
      { createdAt: "2026-10-10T08:00:00Z", id: "chat" },
      { createdAt: "2026-10-09T12:00:00Z", id: "card-b" },
    ]);
    expect(merged.map((m) => m.id)).toEqual(["card-b", "chat", "card-a"]);
  });

  it("painel usa a RPC e atualiza depois da revisão; RPC é por usuário e sem acesso anônimo", () => {
    const panel = readFileSync("src/components/assessor/AssessorPanel.tsx", "utf8");
    expect(panel).toContain("assistant_import_timeline");
    expect(panel).toContain("refreshImports()");
    expect(panel).not.toContain('.in("status", ["uploaded", "processing", "needs_review", "partial"])');
    const sql = readFileSync("supabase/migrations/20261013130000_assistant_import_timeline.sql", "utf8");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("d.user_id = auth.uid()");
    expect(sql).toContain("from public, anon");
  });
});
