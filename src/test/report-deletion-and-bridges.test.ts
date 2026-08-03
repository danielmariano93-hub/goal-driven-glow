import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function migrationWithDeletion(): string {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ f, body: readFileSync(resolve(dir, f), "utf8") }))
    .find((x) => x.body.includes("delete_financial_report"));
  if (!file) throw new Error("migration de exclusão de relatório não encontrada");
  return file.body;
}

describe("exclusão de relatórios inteligentes", () => {
  const sql = migrationWithDeletion();

  it("é transacional e apaga métricas, destaques e entregas", () => {
    expect(sql).toContain("DELETE FROM public.financial_report_metrics WHERE report_id = p_report_id");
    expect(sql).toContain("DELETE FROM public.financial_report_highlights WHERE report_id = p_report_id");
    expect(sql).toContain("DELETE FROM public.financial_report_deliveries WHERE report_id = p_report_id");
    expect(sql).toContain("DELETE FROM public.financial_reports WHERE id = p_report_id AND user_id = v_uid");
  });

  it("autoriza somente o dono e recusa o resto", () => {
    expect(sql).toContain("RAISE EXCEPTION 'not_authenticated'");
    expect(sql).toContain("RAISE EXCEPTION 'report_not_found'");
    expect(sql).toContain("RAISE EXCEPTION 'forbidden'");
    expect(sql).toMatch(/v_report\.user_id <> v_uid/);
  });

  it("audita a exclusão e restringe o EXECUTE", () => {
    expect(sql).toContain("INSERT INTO public.financial_report_deletions");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.delete_financial_report(uuid) FROM PUBLIC");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.delete_financial_report(uuid) TO authenticated");
  });

  it("protege as pontes persistidas com RLS por dono", () => {
    expect(sql).toContain("ALTER TABLE public.financial_cash_bridges ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.financial_net_worth_bridges ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "cash_bridges_owner"');
    expect(sql).toContain('CREATE POLICY "net_worth_bridges_owner"');
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_cash_bridges TO authenticated");
  });

  it("usa a RPC no cliente, nunca DELETE direto na tabela", () => {
    const client = read("src/lib/reports/intelligent/client.ts");
    expect(client).toContain('supabase.rpc("delete_financial_report"');
    expect(client).not.toMatch(/from\("financial_reports"\)[\s\S]{0,40}\.delete\(/);
  });

  it("exige confirmação explícita na listagem e no detalhe", () => {
    for (const page of ["src/pages/RelatoriosInteligentes.tsx", "src/pages/RelatorioInteligenteDetalhe.tsx"]) {
      const body = read(page);
      expect(body).toContain("AlertDialog");
      expect(body).toContain("Excluir este relatório?");
      expect(body).toContain("deleteReport");
    }
  });

  it("atualiza a interface imediatamente após excluir", () => {
    const list = read("src/pages/RelatoriosInteligentes.tsx");
    expect(list).toContain("filter((r) => r.id !== pendingDelete.id)");
    const detail = read("src/pages/RelatorioInteligenteDetalhe.tsx");
    expect(detail).toContain('navigate("/app/relatorios-inteligentes")');
  });

  it("mostra erro amigável quando a exclusão falha", () => {
    const list = read("src/pages/RelatoriosInteligentes.tsx");
    expect(list).toContain("Não consegui excluir esse relatório agora.");
  });
});

describe("pontes persistidas (finance_contract.v4)", () => {
  const sql = migrationWithDeletion();

  it("expõe upserts idempotentes para app e edge functions", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.upsert_cash_bridge(p_bridge jsonb)");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.upsert_net_worth_bridge(p_bridge jsonb)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.upsert_cash_bridge(jsonb) TO authenticated, service_role");
  });

  it("o backfill usa o núcleo compartilhado e é idempotente", () => {
    const fn = read("supabase/functions/finance-bridges-backfill/index.ts");
    expect(fn).toContain('from "../_shared/finance-core/index.ts"');
    expect(fn).toContain("computeCashBridge");
    expect(fn).toContain("computeNetWorthBridge");
    expect(fn).toContain("upsert_cash_bridge");
    expect(fn).toContain("upsert_net_worth_bridge");
    expect(fn).not.toMatch(/\bfrom\("transactions"\)[\s\S]{0,80}\.update\(/);
  });
});
