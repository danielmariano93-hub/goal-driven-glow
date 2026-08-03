import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMMUNICATION_RPC_CONTRACT,
  COMMUNICATION_SCHEMA_CONTRACT,
} from "../../supabase/functions/_shared/intelligence/schemaContract.ts";
import {
  insightLogicalKey,
  periodReviewKey,
  suggestionLogicalKey,
} from "../../supabase/functions/_shared/intelligence/logicalDedup.ts";

const migrationsDir = `${process.cwd()}/supabase/migrations`;
const sql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(`${migrationsDir}/${file}`, "utf8"))
  .join("\n")
  .toLowerCase();

const dispatcher = readFileSync(
  `${process.cwd()}/supabase/functions/split-reminders-dispatch-v2/index.ts`,
  "utf8",
);
const heartbeats = readFileSync(`${process.cwd()}/supabase/functions/_shared/heartbeats.ts`, "utf8");

describe("comms_contract.v2 — contrato de schema", () => {
  for (const [table, columns] of Object.entries(COMMUNICATION_SCHEMA_CONTRACT)) {
    it(`declara todas as colunas usadas de ${table}`, () => {
      for (const column of columns) {
        expect(sql, `${table}.${column}`).toContain(column.toLowerCase());
      }
    });
  }

  it("declara todas as RPCs invocadas pelo código", () => {
    for (const fn of COMMUNICATION_RPC_CONTRACT) {
      expect(sql, fn).toContain(`function public.${fn}`);
    }
  });
});

describe("comms_contract.v2 — chave lógica única", () => {
  it("revisão e relatório do mesmo período colapsam na mesma chave", () => {
    const fromReport = periodReviewKey("weekly", "u1", "2026-07-27");
    const fromSuggestion = suggestionLogicalKey("u1", "advisor_review:weekly:2026-07-27");
    expect(fromSuggestion).toBe(fromReport);
  });

  it("sugestões comuns continuam separadas por usuário", () => {
    expect(suggestionLogicalKey("u1", "spending_spike:x")).toBe("proactive:u1:spending_spike:x");
    expect(suggestionLogicalKey("u2", "spending_spike:x")).not.toBe(
      suggestionLogicalKey("u1", "spending_spike:x"),
    );
  });

  it("insight carrega família na chave lógica", () => {
    expect(insightLogicalKey("u1", "categorizacao", "cat:1")).toBe("insight:u1:categorizacao:cat:1");
  });
});

describe("comms_contract.v2 — consumidor único da fila", () => {
  it("o dispatch do rolê não chama whatsapp-send por HTTP", () => {
    expect(dispatcher).not.toContain("functions/v1/whatsapp-send");
    expect(dispatcher).toContain('sb.rpc("whatsapp_send_dispatch_tick")');
  });

  it("heartbeat acumula estágios via record_job_stages", () => {
    expect(heartbeats).toContain("record_job_stages");
    expect(dispatcher).toContain("stages:");
  });
});
