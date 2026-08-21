import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function src(path: string) { return readFileSync(path, "utf8"); }

const ENGINE = "supabase/functions/_shared/categorization/engine.ts";
const CATEGORY_EDGE = "supabase/functions/category-engine/index.ts";
const INGEST = "supabase/functions/assistant-ingest-document/index.ts";
const AGENT_TOOLS = "supabase/functions/_shared/agent/tools.ts";
const MCP_CREATE = "src/lib/mcp/tools/create-transaction.ts";
const PENDING = "supabase/functions/_shared/agent/core/PendingConfirmations.ts";
const MIGRATION = "supabase/migrations/20260809123000_category_truth_v2.sql";
const CONFIG = "supabase/config.toml";

describe("Category Truth V2 — source contracts", () => {
  it("usa uma versão canônica e não aceita category_type both", () => {
    const engine = src(ENGINE);
    expect(engine).toContain('CATEGORY_ENGINE_VERSION = "categorization_truth.v2"');
    expect(engine).not.toContain('row.type === "both"');
    expect(engine).toContain('const history:HistoryRow[]=[]');
    expect(engine).not.toContain('sb.from("transactions").select("description,raw_description');
  });

  it("documentos não promovem hint de máquina a escolha do usuário", () => {
    const ingest = src(INGEST);
    expect(ingest).toContain("explicit_category: null");
    expect(ingest).toContain('central.action === "auto_apply"');
    expect(ingest).not.toContain('explicit_category: ruleCategory ?? item.category_hint');
  });

  it("AgentCore só aceita categoria como explícita quando há pista literal no texto do usuário", () => {
    const agent = src(AGENT_TOOLS);
    expect(agent).toContain("function isExplicitCategoryMention");
    expect(agent).toContain("const explicitCategoryHint = isExplicitCategoryMention(ctx.user_text, args.category)");
    expect(agent).toContain("resolveCategoryId(ctx, explicitCategoryHint, args.type)");
    expect(agent).toContain("category_explicit: Boolean(cat && explicitCategoryHint)");
    expect(src(PENDING)).toContain('if (kind === "transaction") return "agent_execute_transaction_confirmation_v2"');
  });

  it("MCP não contorna o contrato de tipo nem transforma hint em verdade pessoal", () => {
    const mcp = src(MCP_CREATE);
    expect(mcp).toContain('.eq("type", type)');
    expect(mcp).toContain('category_source: categoryId ? "document_hint" : null');
    expect(mcp).not.toContain('category_source: categoryId ? "user"');
  });

  it("fila global é autenticada por cron e category-engine faz auth interna", () => {
    expect(src(CATEGORY_EDGE)).toContain('"process_queue_global"');
    expect(src(CATEGORY_EDGE)).toContain('if(!isCron)return response({error:"Não autorizado"},401)');
    const config = src(CONFIG);
    expect(config).toMatch(/\[functions\.category-engine\][\s\S]*verify_jwt\s*=\s*false/);
  });

  it("migration fecha bypasses de escrita, protege provenance e usa lease SKIP LOCKED", () => {
    const migration = src(MIGRATION);
    for (const required of [
      "category_merchant_key",
      "user_merchant_preferences",
      "merchant_global_votes",
      "merchant_global_knowledge",
      "agent_execute_transaction_confirmation_v2",
      "tg_transactions_category_audit",
      "inherit_document_category_provenance",
      "transactions_00_document_category_provenance",
      "mark_transaction_category_review",
      "enqueue_transaction_categorization_after",
      "claim_category_classification_batch",
      "FOR UPDATE OF q SKIP LOCKED",
      "enforce_transaction_category_type",
      "nino-category-truth-v2-worker",
      "category_truth_v2_cron_secret_missing",
      "g.user_id IS NULL",
      "GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.merchant_global_knowledge TO service_role",
    ]) expect(migration).toContain(required);
  });

  it("LLM fraco limpa categoria não confiável em vez de deixá-la contaminar métricas", () => {
    const edge = src(CATEGORY_EDGE);
    expect(edge).toContain('const TRUSTED_APPLIED_SOURCES=new Set(["user","personal","alias","history","global","rule"])');
    expect(edge).toContain("category_id:null,category_source:null,category_confidence:null,category_reason:null");
  });
});
