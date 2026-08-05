import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260805030000_nino_financial_situation_core_v1.sql";
const sql = readFileSync(migrationPath, "utf8");
const agentCore = readFileSync("supabase/functions/_shared/agent/core/AgentCore.ts", "utf8");

describe("Nino Financial Situation Core v1", () => {
  it("materializa o domínio situação -> evidência -> ação -> diagnóstico", () => {
    expect(sql).toContain("create table if not exists public.financial_situations");
    expect(sql).toContain("create table if not exists public.financial_situation_evidence");
    expect(sql).toContain("create table if not exists public.financial_situation_actions");
    expect(sql).toContain("create table if not exists public.nino_diagnosis_snapshots");
    expect(sql).toContain("create table if not exists public.financial_situation_feedback");
  });

  it("mantém uma projeção de compatibilidade sem usar os motores legados como verdade", () => {
    expect(sql).toContain("source='financial_diagnosis'");
    expect(sql).toContain("superseded_by_diagnosis_core_v1");
    expect(sql).toContain("rename to nino_legacy_rebuild_items");
    expect(sql).toContain("create or replace function public.nino_rebuild_items");
  });

  it("exclui movimentos não comparáveis do consumo", () => {
    const occurrences = sql.match(/coalesce\(movement_kind,'transaction'\)='transaction'/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(6);
    expect(sql).toContain("pagamentos de fatura, transferências, dívidas e investimentos ficam fora");
  });

  it("transforma comerciantes em evidência da categoria, não no highlight principal", () => {
    expect(sql).toContain("category_contribution_pct");
    expect(sql).toContain("top_merchants");
    expect(sql).toContain("Os maiores lançamentos da categoria são evidências da mudança");
  });

  it("separa pendências operacionais do diagnóstico principal", () => {
    expect(sql).toContain("situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern')");
    expect(sql).toContain("then 'operational'");
    expect(sql).toContain("possíveis duplicidades para revisar");
  });

  it("conecta a mesma situação financeira às conversas do App e WhatsApp", () => {
    expect(sql).toContain("nino_diagnosis_context_for_user");
    expect(agentCore).toContain('sb.rpc("nino_diagnosis_context_for_user"');
    expect(agentCore).toContain("DIAGNÓSTICO FINANCEIRO CANÔNICO DO NINO");
    expect(agentCore).toContain("não invente causas");
  });

  it("liga antecipações e comunicação ao diagnóstico", () => {
    expect(sql).toContain("nino_project_diagnosis_communications");
    expect(sql).toContain("diagnosis_snapshot_id");
    expect(sql).toContain("logical_dedup_key");
    expect(sql).toContain("v_communication_mode='full'");
    expect(sql).toContain("else 'app'");
  });

  it("inclui backtest, shadow/active/legacy e rollback", () => {
    expect(sql).toContain("rollout_mode in ('shadow','active','legacy')");
    expect(sql).toContain("communication_mode in ('disabled','app_only','full')");
    expect(sql).toContain("set rollout_mode='active', communication_mode='app_only'");
    expect(sql).toContain("nino_diagnosis_backtest");
    expect(sql).toContain("nino_diagnosis_rollback");
    expect(sql).toContain("nino_legacy_intelligence_tick");
    expect(sql).toContain("my_nino_refresh_legacy");
    expect(sql).toContain("my_nino_duplicate_decision_legacy");
    expect(sql).toContain("trg_nino_guard_legacy_surface_write");
    expect(sql).toContain("trg_nino_guard_legacy_proactive_write");
  });


  it("preserva snapshots e decisões de ação para auditoria", () => {
    expect(sql).toContain("nino_guard_diagnosis_snapshot_immutable");
    expect(sql).toContain("nino_diagnosis_snapshot_is_immutable");
    expect(sql).toContain("status in ('accepted','in_progress','done','dismissed')");
    expect(sql).not.toContain("delete from public.financial_situation_actions where situation_id=v_id and status='proposed'");
  });

  it("impede vazamento de estado presente nos backtests", () => {
    expect((sql.match(/if _run_mode <> 'backtest' then/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("window_end<=_as_of and created_at::date<=_as_of");
    expect(sql).toContain("created_at::date<=_as_of");
  });

  it("expõe um contrato canônico versionado", () => {
    expect(sql).toContain("my_nino_diagnosis_context");
    expect(sql).toContain("nino_diagnosis_contract.v1");
    expect(sql).toContain("primary_situation");
    expect(sql).toContain("supporting_situations");
    expect(sql).toContain("operational_tasks");
    expect(sql).toContain("snapshot_payload");
    expect(sql).toContain("financial_situation_feedback");
    expect(sql).toContain("create or replace function public.my_nino_duplicate_decision");
  });
});
