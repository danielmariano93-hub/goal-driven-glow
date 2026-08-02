import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("motor único de dicas + ajuste restrito + crons observáveis", () => {
  it("o card de dicas não usa mais o motor legado local", () => {
    const card = read("src/components/home/AssistantTipCard.tsx");
    expect(card).not.toContain("buildLocalCandidates");
    expect(card).not.toContain("pickFallback");
    expect(card).not.toContain("localFallback");
  });

  it("o card de dicas é um carrossel navegável", () => {
    const card = read("src/components/home/AssistantTipCard.tsx");
    expect(card).toContain('aria-label="Próxima dica"');
    expect(card).toContain('aria-label="Dica anterior"');
    expect(card).toContain("Ver dica");
  });

  it("o botão Útil registra e sai do carrossel sem travar", () => {
    const card = read("src/components/home/AssistantTipCard.tsx");
    expect(card).toContain('sendTipFeedback(id, "acted")');
    expect(card).toContain("removeCurrent(id)");
  });

  it("insights-generate usa só o catálogo determinístico e entrega lote", () => {
    const fn = read("supabase/functions/insights-generate/index.ts");
    expect(fn).not.toContain("candidates as buildCandidates");
    expect(fn).not.toContain("pickFallback");
    expect(fn).toContain("insights_catalog.v1");
    expect(fn).toContain("BATCH_SIZE");
    expect(fn).toContain("availableToday");
    expect(fn).toContain("projectedBalance");
  });

  it("insights-generate tem modo cron com heartbeat real", () => {
    const fn = read("supabase/functions/insights-generate/index.ts");
    expect(fn).toContain("x-cron-secret");
    expect(fn).toContain("writeJobHeartbeat");
    expect(fn).toContain('jobKey: FN');
  });

  it("watchdogs aceitam o segredo enviado pelo pg_cron", () => {
    for (const file of [
      "supabase/functions/documents-cleanup/index.ts",
      "supabase/functions/whatsapp-ack-watchdog/index.ts",
    ]) {
      const fn = read(file);
      expect(fn).toContain('req.headers.get("x-cron-secret")');
      expect(fn).toContain('Deno.env.get("CRON_SECRET")');
    }
  });

  it("ajuste de fatura exige motivo, evidência e justificativa longa", () => {
    const page = read("src/pages/Cartoes.tsx");
    expect(page).toContain("ADJUSTMENT_REASONS");
    expect(page).toContain("p_reason_code: reasonCode");
    expect(page).toContain("justification.trim().length < 20");
    expect(page).toContain("cappedAdjustment");
    expect(page).toContain("adjustment_above_cap");
    expect(page).toContain("Corrigir lançamentos (recomendado)");
  });
});
