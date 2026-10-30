// Regras de custo e escala (R1/R2/R6/R7 do refinamento técnico): travam, no CI, o que o F0 corrigiu.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

describe("F0: custo e escala", () => {
  it("worker do snapshot só invoca a Edge Function com usuário claimável (mesma condição do claim)", () => {
    const a = sql("20261030120000_f0a_snapshot_worker_so_com_trabalho.sql");
    expect(a).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM public\.financial_snapshot_refresh_queue/);
    expect(a).toContain("financial_dirty_periods");
    expect(a).toContain("q.locked_until IS NULL OR q.locked_until < now()");
    expect(a.indexOf("IF NOT EXISTS")).toBeLessThan(a.indexOf("net.http_post"));
    expect(a).toContain("SELECT public.finance_snapshot_worker_tick();");
  });

  it("lembretes da divisão: guarda igual à do claim, varredura a cada 5 min e batimento em repouso", () => {
    const b = sql("20261030120100_f0b_split_pipeline_so_com_lembrete_vencido.sql");
    expect(b).toContain("extract(minute FROM now())::int % 5) = 0");
    expect(b).toContain("q.scheduled_for <= now()");
    expect(b).toContain("coalesce(q.attempts, 0) < 5");
    expect(b).toContain("q.lease_expires_at < now()");
    // O painel de saúde marca "atrasado" após 30 min sem batimento: o repouso precisa gravar (no máx. a cada 10 min).
    expect(b).toContain("last_run_at > now() - interval '10 minutes'");
    expect(b.indexOf("IF NOT EXISTS (\n    SELECT 1 FROM public.reminder_jobs")).toBeLessThan(b.indexOf("net.http_post"));
  });

  it("evidência do diagnóstico não é regravada igual e a trava não usa DROP", () => {
    const c = sql("20261030120200_f0c_trava_evidencia_duplicada.sql");
    expect(c).toContain("RETURN NULL");
    expect(c).toContain("v_last.metadata IS NOT DISTINCT FROM NEW.metadata");
    expect(c).not.toMatch(/DROP\s+TRIGGER/i);
  });

  it("histórico fino do diagnóstico tem retenção diária em lote, e a compactação única não é agendada", () => {
    const d = sql("20261030120300_f0d_retencao_e_compactacao.sql");
    expect(d).toContain("interval '90 days'");
    expect(d).toContain("nino-diagnosis-retention-daily");
    expect(d).toContain("'35 4 * * *'");
    const scheduled = [...d.matchAll(/cron\.schedule\([^)]*\)/g)].map((m) => m[0]).join("\n");
    expect(scheduled).not.toContain("compact_evidence_once");
  });

  it("nenhuma migração F0 agenda rotina com frequência menor que 1 hora", () => {
    for (const f of ["20261030120000_f0a_snapshot_worker_so_com_trabalho.sql", "20261030120300_f0d_retencao_e_compactacao.sql"]) {
      for (const m of sql(f).matchAll(/cron\.schedule\('[^']+',\s*'([^']+)'/g)) expect(m[1]).not.toMatch(/^(\*|\*\/\d+) /);
    }
  });
});
